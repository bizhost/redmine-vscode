import * as vscode from "vscode";
import { RedmineClient, type UpdateIssueChanges } from "@redmine-tools/core";
import { MyIssuesProvider } from "./myIssuesProvider";
import { ProjectsProvider } from "./projectsProvider";
import { SearchViewProvider } from "./searchViewProvider";
import { IssueDetailPanel } from "./issueDetailPanel";

const SECRET_KEY = "redmine.apiKey";

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};
const PREVIEW_MAX_BYTES = 5 * 1024 * 1024;

// 이미지 첨부만 data URI로 — 실패/비이미지는 링크 폴백
async function loadPreviews(
  client: RedmineClient,
  attachments: { id: number; filename: string; filesize: number; content_url: string }[],
): Promise<Record<number, string>> {
  const previews: Record<number, string> = {};
  await Promise.all(
    attachments.map(async (a) => {
      const ext = a.filename.split(".").pop()?.toLowerCase() ?? "";
      const mime = IMAGE_MIME[ext];
      if (!mime || a.filesize > PREVIEW_MAX_BYTES) return;
      try {
        const data = await client.downloadAttachment(a.content_url);
        previews[a.id] = `data:${mime};base64,${Buffer.from(data).toString("base64")}`;
      } catch {
        // 미리보기 실패 → 링크만 표시
      }
    }),
  );
  return previews;
}

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
    const [statuses, priorities, trackers, assignees, categories, previews] = await Promise.all([
      client.listStatuses(),
      client.listPriorities(),
      client.listTrackers(),
      projectId ? client.listAssignees(projectId) : Promise.resolve([]),
      projectId ? client.listCategories(projectId) : Promise.resolve([]),
      loadPreviews(client, issue.attachments ?? []),
    ]);
    IssueDetailPanel.show({
      issue,
      statuses,
      priorities,
      trackers,
      assignees,
      categories,
      previews,
      onUpdate: async (changes: UpdateIssueChanges) => {
        await client.updateIssue(id, changes);
        IssueDetailPanel.update(await client.getIssue(id));
        refreshAll();
      },
    });
  };

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("redmineMyIssues", myIssues),
    vscode.window.registerTreeDataProvider("redmineProjects", projects),
    vscode.window.registerWebviewViewProvider(
      SearchViewProvider.viewId,
      new SearchViewProvider(getClient, openIssue),
    ),

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
      vscode.commands.executeCommand("redmineSearch.focus"),
    ),
  );
}

export function deactivate(): void {}
