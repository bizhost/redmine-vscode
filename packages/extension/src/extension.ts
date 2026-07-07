import * as vscode from "vscode";
import { RedmineClient, type UpdateIssueChanges } from "@redmine-tools/core";
import { IssuesProvider } from "./issuesProvider";
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

  const provider = new IssuesProvider(getClient);

  const openIssue = async (id: number): Promise<void> => {
    const client = await getClient();
    if (!client) {
      throw new Error("Redmine 설정 필요: settings에서 url 설정 후 'Redmine: Set API Key' 실행");
    }
    const [issue, statuses, priorities] = await Promise.all([
      client.getIssue(id),
      client.listStatuses(),
      client.listPriorities(),
    ]);
    IssueDetailPanel.show({
      issue,
      statuses,
      priorities,
      onUpdate: async (changes: UpdateIssueChanges) => {
        await client.updateIssue(id, changes);
        IssueDetailPanel.update(await client.getIssue(id));
        provider.refresh();
      },
    });
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
      openIssue(id).catch((err) =>
        vscode.window.showErrorMessage(`일감 열기 실패: ${err instanceof Error ? err.message : err}`),
      ),
    ),
  );
}

export function deactivate(): void {}
