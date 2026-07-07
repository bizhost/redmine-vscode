import * as vscode from "vscode";
import { RedmineClient, type UpdateIssueChanges } from "@redmine-tools/core";
import { MyIssuesProvider } from "./myIssuesProvider";
import { ProjectsProvider } from "./projectsProvider";
import { IssueDetailPanel } from "./issueDetailPanel";

const SECRET_KEY = "redmine.apiKey";

export function activate(context: vscode.ExtensionContext): void {
  const getClient = async (): Promise<RedmineClient | undefined> => {
    const config = vscode.workspace.getConfiguration("redmine");
    const url = config.get<string>("url", "");
    const projectIdentifier = config.get<string>("projectIdentifier", "");
    const apiKey = await context.secrets.get(SECRET_KEY);
    if (!url || !apiKey) return undefined;
    return new RedmineClient({ url, apiKey, projectIdentifier: projectIdentifier || undefined });
  };

  const requireClient = async (): Promise<RedmineClient> => {
    const client = await getClient();
    if (!client) {
      throw new Error("Redmine 설정 필요: settings에서 url 설정 후 'Redmine: Set API Key' 실행");
    }
    return client;
  };

  const myIssues = new MyIssuesProvider(getClient);
  const projects = new ProjectsProvider(getClient);
  const refreshAll = (): void => {
    myIssues.refresh();
    projects.refresh();
  };

  const openIssue = async (id: number): Promise<void> => {
    const client = await requireClient();
    const issue = await client.getIssue(id);
    const projectId = issue.project?.id;
    const [statuses, priorities, trackers, assignees, categories] = await Promise.all([
      client.listStatuses(),
      client.listPriorities(),
      client.listTrackers(),
      projectId ? client.listAssignees(projectId) : Promise.resolve([]),
      projectId ? client.listCategories(projectId) : Promise.resolve([]),
    ]);
    IssueDetailPanel.show({
      issue,
      statuses,
      priorities,
      trackers,
      assignees,
      categories,
      onUpdate: async (changes: UpdateIssueChanges) => {
        await client.updateIssue(id, changes);
        IssueDetailPanel.update(await client.getIssue(id));
        refreshAll();
      },
    });
  };

  const searchLive = async (): Promise<void> => {
    const client = await requireClient();
    const qp = vscode.window.createQuickPick<vscode.QuickPickItem & { issueId: number }>();
    qp.placeholder = "일감 검색 (제목/내용/댓글) — 입력하면 바로 검색";
    qp.matchOnDescription = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let seq = 0;
    qp.onDidChangeValue((value) => {
      if (timer) clearTimeout(timer);
      const query = value.trim();
      if (!query) {
        qp.items = [];
        return;
      }
      timer = setTimeout(async () => {
        const mySeq = ++seq;
        qp.busy = true;
        try {
          const results = await client.searchIssues(query);
          if (mySeq !== seq) return; // 오래된 응답 무시
          qp.items = results.map((r) => ({ label: r.title, issueId: r.id, alwaysShow: true }));
        } catch {
          if (mySeq === seq) qp.items = [];
        } finally {
          if (mySeq === seq) qp.busy = false;
        }
      }, 300);
    });
    qp.onDidAccept(() => {
      const picked = qp.selectedItems[0];
      if (picked) {
        qp.hide();
        void openIssue(picked.issueId).catch((err) =>
          vscode.window.showErrorMessage(`일감 열기 실패: ${err instanceof Error ? err.message : err}`),
        );
      }
    });
    qp.onDidHide(() => qp.dispose());
    qp.show();
  };

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("redmineMyIssues", myIssues),
    vscode.window.registerTreeDataProvider("redmineProjects", projects),

    vscode.commands.registerCommand("redmine.refresh", refreshAll),
    vscode.commands.registerCommand("redmine.loadMoreMy", () => myIssues.loadMore()),
    vscode.commands.registerCommand("redmine.loadMoreProject", (projectId: number) =>
      projects.loadMore(projectId),
    ),

    vscode.commands.registerCommand("redmine.setApiKey", async () => {
      const value = await vscode.window.showInputBox({
        prompt: "Redmine API Key",
        password: true,
        ignoreFocusOut: true,
      });
      if (value) {
        await context.secrets.store(SECRET_KEY, value.trim());
        vscode.window.showInformationMessage("Redmine API Key 저장됨");
        refreshAll();
      }
    }),

    vscode.commands.registerCommand("redmine.openIssue", (id: number) =>
      openIssue(id).catch((err) =>
        vscode.window.showErrorMessage(`일감 열기 실패: ${err instanceof Error ? err.message : err}`),
      ),
    ),

    vscode.commands.registerCommand("redmine.search", () =>
      searchLive().catch((err) =>
        vscode.window.showErrorMessage(`검색 실패: ${err instanceof Error ? err.message : err}`),
      ),
    ),
  );
}

export function deactivate(): void {}
