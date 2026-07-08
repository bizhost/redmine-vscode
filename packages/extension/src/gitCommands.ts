import * as vscode from "vscode";
import * as path from "node:path";
import { issueIdsForFile } from "./gitIssues";
import { nodeIssueId, type CommandDeps } from "./issueCommands";

export function registerGitCommands(d: CommandDeps): vscode.Disposable[] {
  const { requireClient, openDetail: openIssue } = d;

  return [
    // 커밋 파일 diff — before(hash^)/after(hash) 콘텐츠를 에디터 diff로
    vscode.commands.registerCommand(
      "redmine.diffCommitFile",
      (repoPath: string, hash: string, file: string) => {
        const uri = (ref: string): vscode.Uri =>
          vscode.Uri.from({ scheme: "redmine-gitshow", path: `/${file}`, query: JSON.stringify({ repo: repoPath, ref }) });
        void vscode.commands.executeCommand(
          "vscode.diff",
          uri(`${hash}^`),
          uri(hash),
          `${path.basename(file)} (${hash.slice(0, 7)})`,
        );
      },
    ),

    // 작업 중 변경 파일 diff — HEAD ↔ 워킹트리(로컬 Uri). 삭제 파일은 우측 빈 문서.
    vscode.commands.registerCommand(
      "redmine.diffWorkingFile",
      (repoPath: string, file: string, del: boolean) => {
        const showUri = (ref: string): vscode.Uri =>
          vscode.Uri.from({ scheme: "redmine-gitshow", path: `/${file}`, query: JSON.stringify({ repo: repoPath, ref }) });
        const right = del
          ? showUri("__none__") // 없는 ref → gitShow 빈 문자열
          : vscode.Uri.file(path.join(repoPath, file));
        void vscode.commands.executeCommand(
          "vscode.diff",
          showUri("HEAD"), // 신규 파일은 HEAD에 없어 빈 문자열
          right,
          `${path.basename(file)} (작업 트리)`,
        );
      },
    ),

    vscode.commands.registerCommand("redmine.showChangesets", async (node?: unknown) => {
      try {
        const id = nodeIssueId(node);
        if (id === undefined) return;
        const client = await requireClient();
        const changesets = (await client.getIssue(id)).changesets ?? [];
        if (changesets.length === 0) {
          vscode.window.showInformationMessage(`#${id} 연결된 커밋 없음`);
          return;
        }
        await vscode.window.showQuickPick(
          changesets.map((c) => ({
            label: c.revision.slice(0, 12),
            description: c.comments?.split("\n")[0] ?? "",
            detail: [c.user?.name, c.committed_on].filter(Boolean).join(" · "),
          })),
          { placeHolder: `#${id} 연결 커밋 ${changesets.length}건` },
        );
      } catch (err) {
        vscode.window.showErrorMessage(`커밋 조회 실패: ${err instanceof Error ? err.message : err}`);
      }
    }),

    vscode.commands.registerCommand("redmine.issuesForFile", async (uri?: vscode.Uri) => {
      try {
        const target = uri ?? vscode.window.activeTextEditor?.document.uri;
        if (!target) return;
        const client = await requireClient();
        const ids = (await issueIdsForFile(target)).slice(0, 20); // 최근 20건만 조회
        if (ids.length === 0) {
          vscode.window.showInformationMessage("이 파일과 연결된 일감 없음 (커밋 메시지 #번호 기준)");
          return;
        }
        const issues = await Promise.all(
          ids.map((id) =>
            client
              .getIssue(id)
              .then((i) => ({ label: `#${i.id} ${i.subject}`, description: i.status?.name, id: i.id }))
              .catch(() => undefined), // 삭제됐거나 권한 없는 일감 → 제외
          ),
        );
        const items = issues.filter((i): i is NonNullable<typeof i> => !!i);
        if (items.length === 0) {
          vscode.window.showInformationMessage("연결된 일감을 조회할 수 없음");
          return;
        }
        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: `${path.basename(target.fsPath)} 관련 일감 ${items.length}건`,
        });
        if (picked) await openIssue(picked.id);
      } catch (err) {
        vscode.window.showErrorMessage(`관련 일감 조회 실패: ${err instanceof Error ? err.message : err}`);
      }
    }),
  ];
}
