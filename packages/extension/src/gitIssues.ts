import * as vscode from "vscode";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";

const execFileAsync = promisify(execFile);
const MAXBUF = 20 * 1024 * 1024;

// git log에서 이 파일 건드린 커밋들의 #번호 추출 (최근순, 중복 제거)
export async function issueIdsForFile(fileUri: vscode.Uri): Promise<number[]> {
  const folder = vscode.workspace.getWorkspaceFolder(fileUri);
  if (!folder) throw new Error("워크스페이스 폴더 밖의 파일");
  const rel = path.relative(folder.uri.fsPath, fileUri.fsPath);
  const { stdout } = await execFileAsync(
    "git",
    ["log", "-n", "500", "--format=%s%n%b", "--", rel],
    { cwd: folder.uri.fsPath, maxBuffer: MAXBUF },
  );
  return parseIssueIds(stdout);
}

function parseIssueIds(text: string): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const m of text.matchAll(/#(\d+)/g)) {
    const id = Number(m[1]);
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

export interface GitRepo {
  name: string;
  path: string;
}

// 워크스페이스 폴더 중 git 저장소인 것만 (rev-parse로 확인)
export async function listGitRepos(): Promise<GitRepo[]> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const repos: GitRepo[] = [];
  await Promise.all(
    folders.map(async (f) => {
      try {
        await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], {
          cwd: f.uri.fsPath,
          maxBuffer: MAXBUF,
        });
        repos.push({ name: f.name, path: f.uri.fsPath });
      } catch {
        // git 저장소 아님 → 제외
      }
    }),
  );
  return repos;
}

export async function gitBranches(
  cwd: string,
): Promise<{ current: string; branches: string[] }> {
  const [cur, list] = await Promise.all([
    execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, maxBuffer: MAXBUF })
      .then((r) => r.stdout.trim())
      .catch(() => ""),
    execFileAsync("git", ["branch", "--format=%(refname:short)"], { cwd, maxBuffer: MAXBUF })
      .then((r) => r.stdout.split("\n").map((s) => s.trim()).filter(Boolean))
      .catch(() => [] as string[]),
  ]);
  const branches = list.length ? list : cur ? [cur] : [];
  return { current: cur, branches };
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  subject: string;
  body: string;
  author: string;
  dateIso: string;
  issueIds: number[];
  added: number;
  deleted: number;
  files: number;
}

// numstat 행 = "<added>\t<deleted>\t<path>" (바이너리는 "-"). 탭 구분, 로케일 무관 (shortstat 영어 정규식 대체).
const NUMSTAT = /^(\d+|-)\t(\d+|-)\t/;
export function sumNumstat(lines: string[]): { added: number; deleted: number } {
  let added = 0;
  let deleted = 0;
  for (const line of lines) {
    const m = line.match(NUMSTAT);
    if (!m) continue;
    if (m[1] !== "-") added += Number(m[1]);
    if (m[2] !== "-") deleted += Number(m[2]);
  }
  return { added, deleted };
}

// 단일 git log 호출: 레코드=%x1e, 필드=%x1f 구분 + --numstat 꼬리에서 +/- 합산
export async function gitLog(
  cwd: string,
  opts: { branch?: string; limit?: number } = {},
): Promise<GitCommit[]> {
  const args = [
    "log",
    "-n",
    String(opts.limit ?? 100),
    "--numstat",
    "--format=%x1e%H%x1f%an%x1f%aI%x1f%s%x1f%b",
  ];
  if (opts.branch) args.push(opts.branch);
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: MAXBUF }).catch(() => ({
    stdout: "",
  }));
  const out: GitCommit[] = [];
  for (const rec of stdout.split("\x1e")) {
    if (!rec.trim()) continue;
    const parts = rec.split("\x1f");
    if (parts.length < 5) continue;
    const hash = parts[0].trim();
    const author = parts[1].trim();
    const dateIso = parts[2].trim();
    const subject = parts[3].trim();
    // parts[4] = body + "\n\n<numstat 행들>". 꼬리의 연속 numstat 블록만 stat, 앞은 body.
    const lines = (parts[4] ?? "").split("\n");
    let end = lines.length;
    while (end > 0 && lines[end - 1].trim() === "") end--;
    let start = end;
    while (start > 0 && NUMSTAT.test(lines[start - 1])) start--;
    const body = lines.slice(0, start).join("\n").trim();
    const { added, deleted } = sumNumstat(lines.slice(start, end));
    out.push({
      hash,
      shortHash: hash.slice(0, 7),
      subject,
      body,
      author,
      dateIso,
      issueIds: parseIssueIds(`${subject}\n${body}`),
      added,
      deleted,
      files: end - start,
    });
  }
  return out;
}

export interface WorkingChanges {
  fileCount: number;
  added: number;
  deleted: number;
}

// 작업 중 변경 요약: porcelain 파일 수 + HEAD 대비 --numstat 합산 (로케일 무관)
export async function gitWorkingChanges(cwd: string): Promise<WorkingChanges> {
  const [porcelain, diff] = await Promise.all([
    execFileAsync("git", ["status", "--porcelain"], { cwd, maxBuffer: MAXBUF })
      .then((r) => r.stdout)
      .catch(() => ""),
    execFileAsync("git", ["diff", "HEAD", "--numstat"], { cwd, maxBuffer: MAXBUF })
      .then((r) => r.stdout)
      .catch(() => ""),
  ]);
  const fileCount = porcelain.split("\n").filter((l) => l.trim()).length;
  const { added, deleted } = sumNumstat(diff.split("\n"));
  return { fileCount, added, deleted };
}

export interface WorkingFile {
  path: string;
  status: string; // 표시용 단일 문자 M/A/D/R/?
  del: boolean; // 워킹트리 삭제 → diff 우측 빈 문서
}

// 따옴표 경로(비ASCII/공백) → C-escape 최소 해제
function unquotePorcelain(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/\\(.)/g, (_, c) => (c === "n" ? "\n" : c === "t" ? "\t" : c));
  }
  return s;
}

// 작업 중 변경 파일 목록 (porcelain). 파일 수는 gitWorkingChanges와 동일 기준.
export async function gitWorkingFiles(cwd: string): Promise<WorkingFile[]> {
  const { stdout } = await execFileAsync("git", ["status", "--porcelain"], {
    cwd,
    maxBuffer: MAXBUF,
  }).catch(() => ({ stdout: "" }));
  const files: WorkingFile[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const xy = line.slice(0, 2);
    let rest = line.slice(3);
    if (rest.includes(" -> ")) rest = rest.split(" -> ").pop() ?? rest; // 이름 변경 → 새 경로
    const p = unquotePorcelain(rest);
    const untracked = xy === "??";
    files.push({
      path: p,
      status: untracked ? "?" : xy.replace(/ /g, "")[0] ?? "M",
      del: !untracked && xy.includes("D"),
    });
  }
  return files;
}

export interface CommitFile {
  status: string;
  path: string;
}

export async function gitCommitFiles(cwd: string, hash: string): Promise<CommitFile[]> {
  const { stdout } = await execFileAsync(
    "git",
    ["show", "--name-status", "--format=", hash],
    { cwd, maxBuffer: MAXBUF },
  ).catch(() => ({ stdout: "" }));
  const files: CommitFile[] = [];
  for (const line of stdout.split("\n")) {
    const m = line.match(/^([A-Z])\d*\t(.+)$/);
    if (m) files.push({ status: m[1], path: m[2].split("\t").pop() ?? m[2] });
  }
  return files;
}

// diff 콘텐츠 프로바이더용 — 없는 쪽(추가/삭제 파일)은 빈 문자열
export async function gitShow(cwd: string, ref: string, filePath: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["show", `${ref}:${filePath}`], {
    cwd,
    maxBuffer: MAXBUF,
  }).catch(() => ({ stdout: "" }));
  return stdout;
}

// origin 원격 → 웹 base URL. 없거나 파싱 실패 시 "".
export async function gitRemoteWebUrl(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], {
    cwd,
    maxBuffer: MAXBUF,
  }).catch(() => ({ stdout: "" }));
  return normalizeRemote(stdout.trim());
}

// git@host:org/repo.git → https://host/org/repo (자격증명·.git 제거). ssh/git 스킴도 https로.
export function normalizeRemote(raw: string): string {
  if (!raw) return "";
  let s = raw.trim();
  const scp = s.match(/^[\w.-]+@([^:/]+):(.+)$/);
  if (scp) s = `https://${scp[1]}/${scp[2]}`;
  else if (/^ssh:\/\//.test(s)) s = s.replace(/^ssh:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?/, "https://$1");
  else if (/^git:\/\//.test(s)) s = s.replace(/^git:\/\//, "https://");
  s = s.replace(/^(https?:\/\/)[^/@]+@/, "$1"); // user:token@ 제거
  s = s.replace(/\.git$/, "").replace(/\/+$/, "");
  return /^https?:\/\/.+/.test(s) ? s : "";
}

// 호스트별 커밋 permalink 경로
export function commitWebUrl(base: string, sha: string): string {
  if (!base) return "";
  let host = "";
  try {
    host = new URL(base).host;
  } catch {
    return "";
  }
  if (/gitlab/i.test(host)) return `${base}/-/commit/${sha}`;
  if (/bitbucket\.org/i.test(host)) return `${base}/commits/${sha}`;
  return `${base}/commit/${sha}`; // github/gitea 등 기본
}
