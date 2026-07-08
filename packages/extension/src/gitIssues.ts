import * as vscode from "vscode";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import { readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";

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

// 워크스페이스 하위 중첩 저장소까지 탐색. .git 엔트리(디렉토리=일반, 파일=worktree/서브모듈) 존재 = 저장소.
// ponytail: 깊이 3 고정 스캔, 더 깊은 모노레포면 REPO_SCAN_DEPTH 상향 또는 설정화.
const REPO_SCAN_DEPTH = 3;

export async function listGitRepos(): Promise<GitRepo[]> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const repos: GitRepo[] = [];
  await Promise.all(folders.map((f) => scanRepos(f.uri.fsPath, f.name, repos, REPO_SCAN_DEPTH)));
  // 이름 정렬 = 부모 repo가 하위 repo보다 앞 + 로드 간 순서 안정(필터가 인덱스 기반)
  return repos.sort((a, b) => a.name.localeCompare(b.name));
}

async function scanRepos(dir: string, name: string, out: GitRepo[], depth: number): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // 접근 불가 → 무시
  }
  if (entries.some((e) => e.name === ".git")) out.push({ name, path: dir });
  if (depth === 0) return;
  await Promise.all(
    entries
      .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules")
      .map((e) => scanRepos(path.join(dir, e.name), `${name}/${e.name}`, out, depth - 1)),
  );
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
  parents: string[]; // 부모 커밋 full hash (lane 그래프용)
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
// %H/%P = full hash (lane 그래프 부모↔해시 매칭에 축약형 금지). --topo-order = 자식이 부모보다 먼저 방출(lane 알고리즘 전제).
export async function gitLog(
  cwd: string,
  opts: { branch?: string; limit?: number; all?: boolean } = {},
): Promise<GitCommit[]> {
  const args = [
    "log",
    "--topo-order",
    "-n",
    String(opts.limit ?? 100),
    "--numstat",
    "--format=%x1e%H%x1f%an%x1f%aI%x1f%s%x1f%P%x1f%b",
  ];
  if (opts.all) args.push("--all");
  else if (opts.branch) args.push(opts.branch);
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: MAXBUF }).catch(() => ({
    stdout: "",
  }));
  const out: GitCommit[] = [];
  for (const rec of stdout.split("\x1e")) {
    if (!rec.trim()) continue;
    const parts = rec.split("\x1f");
    if (parts.length < 6) continue;
    const hash = parts[0].trim();
    const author = parts[1].trim();
    const dateIso = parts[2].trim();
    const subject = parts[3].trim();
    const parents = (parts[4] ?? "").trim().split(/\s+/).filter(Boolean);
    // parts[5] = body + "\n\n<numstat 행들>". 꼬리의 연속 numstat 블록만 stat, 앞은 body.
    const lines = (parts[5] ?? "").split("\n");
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
      parents,
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
  modified: number;
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
  const lines = porcelain.split("\n").filter((l) => l.trim());
  const modified = lines.filter((l) => l.slice(0, 2).includes("M")).length;
  const { added, deleted } = sumNumstat(diff.split("\n"));
  return { fileCount: lines.length, modified, added, deleted };
}

export interface WorkingFile {
  path: string;
  status: string; // 표시용 단일 문자 M/A/D/R/?
  del: boolean; // 워킹트리 삭제 → diff 우측 빈 문서
  added: number;
  deleted: number;
}

// 따옴표 경로(비ASCII/공백) → C-escape 최소 해제
function unquotePorcelain(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/\\(.)/g, (_, c) => (c === "n" ? "\n" : c === "t" ? "\t" : c));
  }
  return s;
}

// 작업 중 변경 파일 목록 (porcelain) + 파일별 ± (HEAD 대비 numstat, untracked는 0)
export async function gitWorkingFiles(cwd: string): Promise<WorkingFile[]> {
  const [porcelain, num] = await Promise.all([
    execFileAsync("git", ["status", "--porcelain"], { cwd, maxBuffer: MAXBUF })
      .then((r) => r.stdout)
      .catch(() => ""),
    execFileAsync("git", ["diff", "HEAD", "--numstat"], { cwd, maxBuffer: MAXBUF })
      .then((r) => r.stdout)
      .catch(() => ""),
  ]);
  const stats = new Map<string, { added: number; deleted: number }>();
  for (const line of num.split("\n")) {
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (m) {
      const p = unquotePorcelain(m[3].split("\t").pop() ?? m[3]);
      stats.set(p, { added: m[1] === "-" ? 0 : Number(m[1]), deleted: m[2] === "-" ? 0 : Number(m[2]) });
    }
  }
  const files: WorkingFile[] = [];
  for (const line of porcelain.split("\n")) {
    if (!line.trim()) continue;
    const xy = line.slice(0, 2);
    let rest = line.slice(3);
    if (rest.includes(" -> ")) rest = rest.split(" -> ").pop() ?? rest; // 이름 변경 → 새 경로
    const p = unquotePorcelain(rest);
    const untracked = xy === "??";
    const s = stats.get(p) ?? { added: 0, deleted: 0 };
    files.push({
      path: p,
      status: untracked ? "?" : xy.replace(/ /g, "")[0] ?? "M",
      del: !untracked && xy.includes("D"),
      added: s.added,
      deleted: s.deleted,
    });
  }
  return files;
}

export interface CommitFile {
  status: string;
  path: string;
  added: number;
  deleted: number;
}

export async function gitCommitFiles(cwd: string, hash: string): Promise<CommitFile[]> {
  const [ns, num] = await Promise.all([
    execFileAsync("git", ["show", "--name-status", "--format=", hash], { cwd, maxBuffer: MAXBUF })
      .then((r) => r.stdout)
      .catch(() => ""),
    execFileAsync("git", ["show", "--numstat", "--format=", hash], { cwd, maxBuffer: MAXBUF })
      .then((r) => r.stdout)
      .catch(() => ""),
  ]);
  // 파일별 +/- (바이너리 "-"는 0)
  const stats = new Map<string, { added: number; deleted: number }>();
  for (const line of num.split("\n")) {
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (m) {
      const p = m[3].split("\t").pop() ?? m[3];
      stats.set(p, { added: m[1] === "-" ? 0 : Number(m[1]), deleted: m[2] === "-" ? 0 : Number(m[2]) });
    }
  }
  const files: CommitFile[] = [];
  for (const line of ns.split("\n")) {
    const m = line.match(/^([A-Z])\d*\t(.+)$/);
    if (m) {
      const p = m[2].split("\t").pop() ?? m[2];
      const s = stats.get(p) ?? { added: 0, deleted: 0 };
      files.push({ status: m[1], path: p, added: s.added, deleted: s.deleted });
    }
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
