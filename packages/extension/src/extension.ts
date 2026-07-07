import * as vscode from "vscode";
import { RedmineClient } from "@redmine-tools/core";
import { IssuesProvider } from "./issuesProvider";
import { IssueDetailPanel } from "./issueDetailPanel";

const SECRET_KEY = "redmine.apiKey";

export function activate(context: vscode.ExtensionContext): void {
  const getClient = async (): Promise<RedmineClient | undefined> => {
    const config = vscode.workspace.getConfiguration("redmine");
    const url = config.get<string>("url", "");
    const projectIdentifier = config.get<string>("projectIdentifier", "");
    const apiKey = await context.secrets.get(SECRET_KEY);
    if (!url || !projectIdentifier || !apiKey) return undefined;
    return new RedmineClient({ url, apiKey, projectIdentifier });
  };

  const requireClient = async (): Promise<RedmineClient> => {
    const client = await getClient();
    if (!client) {
      throw new Error("Redmine 설정 필요: settings에서 url/projectIdentifier, 'Redmine: Set API Key' 실행");
    }
    return client;
  };

  const provider = new IssuesProvider(getClient);
  const openIssue = async (id: number): Promise<void> => {
    const client = await requireClient();
    IssueDetailPanel.show(await client.getIssue(id));
  };

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("redmineIssues", provider),

    vscode.commands.registerCommand("redmine.refresh", () => provider.refresh()),

    vscode.commands.registerCommand("redmine.setApiKey", async () => {
      const value = await vscode.window.showInputBox({
        prompt: "Redmine API Key",
        password: true,
        ignoreFocusOut: true,
      });
      if (value) {
        await context.secrets.store(SECRET_KEY, value.trim());
        vscode.window.showInformationMessage("Redmine API Key 저장됨");
        provider.refresh();
      }
    }),

    vscode.commands.registerCommand("redmine.openIssue", (id: number) =>
      openIssue(id).catch((err) => vscode.window.showErrorMessage(String(err.message ?? err))),
    ),

    vscode.commands.registerCommand("redmine.changeStatus", async (id: number) => {
      try {
        const client = await requireClient();
        const statuses = await client.listStatuses();
        const picked = await vscode.window.showQuickPick(
          statuses.map((s) => ({ label: s.name, id: s.id })),
          { placeHolder: `#${id} 새 상태 선택` },
        );
        if (!picked) return;
        await client.updateIssue(id, { statusId: picked.id });
        vscode.window.showInformationMessage(`#${id} 상태 → ${picked.label}`);
        IssueDetailPanel.update(await client.getIssue(id));
        provider.refresh();
      } catch (err) {
        vscode.window.showErrorMessage(`상태 변경 실패: ${err instanceof Error ? err.message : err}`);
      }
    }),

    vscode.commands.registerCommand("redmine.addComment", async (id: number) => {
      try {
        const client = await requireClient();
        const notes = await vscode.window.showInputBox({
          prompt: `#${id} 댓글 내용`,
          ignoreFocusOut: true,
        });
        if (!notes) return;
        await client.updateIssue(id, { notes });
        vscode.window.showInformationMessage(`#${id} 댓글 등록됨`);
        IssueDetailPanel.update(await client.getIssue(id));
        provider.refresh();
      } catch (err) {
        vscode.window.showErrorMessage(`댓글 등록 실패: ${err instanceof Error ? err.message : err}`);
      }
    }),
  );
}

export function deactivate(): void {}
