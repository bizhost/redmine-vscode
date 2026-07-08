import * as vscode from "vscode";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";

const execFileAsync = promisify(execFile);

// git log에서 이 파일 건드린 커밋들의 #번호 추출 (최근순, 중복 제거)
export async function issueIdsForFile(fileUri: vscode.Uri): Promise<number[]> {
  const folder = vscode.workspace.getWorkspaceFolder(fileUri);
  if (!folder) throw new Error("워크스페이스 폴더 밖의 파일");
  const rel = path.relative(folder.uri.fsPath, fileUri.fsPath);
  const { stdout } = await execFileAsync(
    "git",
    ["log", "-n", "500", "--format=%s%n%b", "--", rel],
    { cwd: folder.uri.fsPath, maxBuffer: 10 * 1024 * 1024 },
  );
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const m of stdout.matchAll(/#(\d+)/g)) {
    const id = Number(m[1]);
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}
