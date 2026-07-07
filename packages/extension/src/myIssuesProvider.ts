import * as vscode from "vscode";
import type { Issue, RedmineClient } from "@redmine-tools/core";
import { PAGE_SIZE, errorItem, issueItem, moreItem, setupHintItem } from "./issueNodes";

export class MyIssuesProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private issues: Issue[] = [];
  private total = 0;
  private loaded = false;

  constructor(private readonly getClient: () => Promise<RedmineClient | undefined>) {}

  refresh(): void {
    this.loaded = false;
    this.issues = [];
    this._onDidChangeTreeData.fire();
  }

  async loadMore(): Promise<void> {
    const client = await this.getClient();
    if (!client) return;
    const page = await client.listIssues({ assignedToMe: true, offset: this.issues.length });
    this.issues.push(...page.issues);
    this.total = page.totalCount;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (element) return [];
    const client = await this.getClient();
    if (!client) return [setupHintItem()];

    try {
      if (!this.loaded) {
        const page = await client.listIssues({ assignedToMe: true, limit: PAGE_SIZE });
        this.issues = page.issues;
        this.total = page.totalCount;
        this.loaded = true;
      }
      if (this.issues.length === 0) return [new vscode.TreeItem("일감 없음")];
      const items = this.issues.map(issueItem);
      if (this.issues.length < this.total) {
        items.push(moreItem("redmine.loadMoreMy", this.issues.length, this.total));
      }
      return items;
    } catch (err) {
      return [errorItem(err)];
    }
  }
}
