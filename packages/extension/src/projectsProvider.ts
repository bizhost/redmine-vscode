import * as vscode from "vscode";
import type { Issue, RedmineClient } from "@redmine-tools/core";
import { PAGE_SIZE, errorItem, issueItem, moreItem, setupHintItem } from "./issueNodes";

class ProjectNode extends vscode.TreeItem {
  constructor(
    readonly projectId: number,
    name: string,
  ) {
    super(name, vscode.TreeItemCollapsibleState.Collapsed);
    this.iconPath = new vscode.ThemeIcon("project");
  }
}

interface PageState {
  issues: Issue[];
  total: number;
}

export class ProjectsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private pages = new Map<number, PageState>();

  constructor(private readonly getClient: () => Promise<RedmineClient | undefined>) {}

  refresh(): void {
    this.pages.clear();
    this._onDidChangeTreeData.fire();
  }

  async loadMore(projectId: number): Promise<void> {
    const client = await this.getClient();
    const state = this.pages.get(projectId);
    if (!client || !state) return;
    const page = await client.listIssues({
      assignedToMe: false,
      projectId,
      offset: state.issues.length,
    });
    state.issues.push(...page.issues);
    state.total = page.totalCount;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    const client = await this.getClient();
    if (!client) return element ? [] : [setupHintItem()];

    try {
      if (!element) {
        const projects = await client.listProjects();
        return projects.map((p) => new ProjectNode(p.id, p.name));
      }

      if (element instanceof ProjectNode) {
        let state = this.pages.get(element.projectId);
        if (!state) {
          const page = await client.listIssues({
            assignedToMe: false, // 담당 무관 전체 open 일감
            projectId: element.projectId,
            limit: PAGE_SIZE,
          });
          state = { issues: page.issues, total: page.totalCount };
          this.pages.set(element.projectId, state);
        }
        if (state.issues.length === 0) return [new vscode.TreeItem("일감 없음")];
        const items = state.issues.map(issueItem);
        if (state.issues.length < state.total) {
          items.push(
            moreItem("redmine.loadMoreProject", state.issues.length, state.total, element.projectId),
          );
        }
        return items;
      }
      return [];
    } catch (err) {
      return [errorItem(err)];
    }
  }
}
