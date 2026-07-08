import * as vscode from "vscode";
import { searchOpts, resetAuthLatch, SECRET_KEY } from "./treeSupport";
import { type CommandDeps } from "./issueCommands";

const GROUP_BY_ORDER = ["project", "status", "none"] as const;

export function registerTreeSetupCommands(d: CommandDeps): vscode.Disposable[] {
  const {
    context,
    requireClient,
    refreshAll,
    updateConnectionContext,
    openDetail: openIssue,
    panel,
    myIssues,
    projects,
  } = d;

  const searchAndOpen = async (assignedToMe: boolean, allProjects: boolean): Promise<void> => {
    try {
      const client = await requireClient();
      const query = (
        await vscode.window.showInputBox({
          prompt: "제목 또는 #번호로 검색",
          ignoreFocusOut: true,
        })
      )?.trim();
      if (!query) return;
      const page = await client.listIssues({
        assignedToMe,
        limit: 50,
        ...(allProjects ? { projectId: 0 } : {}),
        ...searchOpts(query),
      });
      if (page.issues.length === 0) {
        vscode.window.showInformationMessage("검색 결과 없음");
        return;
      }
      const picked = await vscode.window.showQuickPick(
        page.issues.map((i) => ({
          label: `#${i.id} ${i.subject}`,
          description: i.status?.name,
          id: i.id,
        })),
        { placeHolder: `검색 결과 ${page.issues.length}건` },
      );
      if (picked) await openIssue(picked.id);
    } catch (err) {
      vscode.window.showErrorMessage(`검색 실패: ${err instanceof Error ? err.message : err}`);
    }
  };

  return [
    vscode.commands.registerCommand("redmine.refresh", () => {
      resetAuthLatch(); // 재조회로 인증 재판정 허용
      refreshAll();
    }),
    vscode.commands.registerCommand("redmine.refreshPanel", () => panel.refresh()),
    vscode.commands.registerCommand("redmine.openPanel", () => panel.popout()),

    vscode.commands.registerCommand("redmine.searchMyIssues", () => searchAndOpen(true, false)),
    vscode.commands.registerCommand("redmine.searchProjects", () => searchAndOpen(false, true)),
    vscode.commands.registerCommand("redmine.myIssues.more", () => myIssues.loadMore()),
    vscode.commands.registerCommand("redmine.projects.more", (projectId: number) =>
      projects.loadMore(projectId),
    ),

    vscode.commands.registerCommand("redmine.toggleMyIssuesGroupBy", async () => {
      const cfg = vscode.workspace.getConfiguration("redmine");
      const cur = cfg.get<string>("views.myIssues.groupBy", "project");
      const next = GROUP_BY_ORDER[(GROUP_BY_ORDER.indexOf(cur as never) + 1) % GROUP_BY_ORDER.length];
      await cfg.update("views.myIssues.groupBy", next, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`내 일감 그룹 기준: ${next}`);
    }),

    vscode.commands.registerCommand("redmine.setApiKey", async () => {
      const value = await vscode.window.showInputBox({
        prompt: "Redmine API Key",
        password: true,
        ignoreFocusOut: true,
      });
      if (value) {
        await context.secrets.store(SECRET_KEY, value.trim());
        vscode.window.showInformationMessage("Redmine API Key 저장됨");
        await updateConnectionContext();
        refreshAll();
      }
    }),
  ];
}
