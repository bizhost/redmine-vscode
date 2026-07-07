import * as vscode from "vscode";
import type { RedmineClient } from "@redmine-tools/core";

export class IssuesProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly getClient: () => Promise<RedmineClient | undefined>) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<vscode.TreeItem[]> {
    const client = await this.getClient();
    if (!client) {
      const item = new vscode.TreeItem("설정 필요: URL/프로젝트/API Key");
      item.command = {
        command: "redmine.setApiKey",
        title: "Redmine: Set API Key",
      };
      item.iconPath = new vscode.ThemeIcon("gear");
      return [item];
    }

    try {
      const assignedToMe = vscode.workspace
        .getConfiguration("redmine")
        .get<boolean>("assignedToMe", true);
      const issues = await client.listIssues({ assignedToMe });
      if (issues.length === 0) {
        return [new vscode.TreeItem("일감 없음")];
      }
      return issues.map((issue) => {
        const item = new vscode.TreeItem(`#${issue.id} ${issue.subject}`);
        item.description = issue.status?.name ?? "";
        item.tooltip = `${issue.subject}\n상태: ${issue.status?.name}\n담당: ${issue.assigned_to?.name ?? "-"}`;
        item.iconPath = new vscode.ThemeIcon("issues");
        item.command = {
          command: "redmine.openIssue",
          title: "일감 열기",
          arguments: [issue.id],
        };
        return item;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Redmine 목록 조회 실패: ${message}`);
      return [new vscode.TreeItem(`오류: ${message}`)];
    }
  }
}
