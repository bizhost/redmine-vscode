import * as vscode from "vscode";
import type { Issue, RedmineClient } from "@redmine-tools/core";
import {
  PAGE_SIZE,
  ProjectGroupNode,
  errorItem,
  filterHeaderItem,
  groupByProject,
  issueItem,
  moreItem,
  searchOpts,
  setupHintItem,
} from "./issueNodes";

export class MyIssuesProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private issues: Issue[] = [];
  private total = 0;
  private loaded = false;
  private filter: string | undefined;

  constructor(private readonly getClient: () => Promise<RedmineClient | undefined>) {}

  refresh(): void {
    this.loaded = false;
    this.issues = [];
    this._onDidChangeTreeData.fire();
  }

  getFilter(): string | undefined {
    return this.filter;
  }

  setFilter(query: string | undefined): void {
    this.filter = query?.trim() || undefined;
    this.refresh();
  }

  private listOpts(offset: number) {
    return {
      assignedToMe: true,
      limit: PAGE_SIZE,
      offset,
      ...(this.filter ? searchOpts(this.filter) : {}),
    };
  }

  async loadMore(): Promise<void> {
    const client = await this.getClient();
    if (!client) return;
    const page = await client.listIssues(this.listOpts(this.issues.length));
    this.issues.push(...page.issues);
    this.total = page.totalCount;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (element) {
      return element instanceof ProjectGroupNode ? element.issues.map(issueItem) : [];
    }

    const client = await this.getClient();
    if (!client) return [setupHintItem()];

    try {
      if (!this.loaded) {
        const page = await client.listIssues(this.listOpts(0));
        this.issues = page.issues;
        this.total = page.totalCount;
        this.loaded = true;
      }
      const items: vscode.TreeItem[] = [];
      if (this.filter) items.push(filterHeaderItem(this.filter, "redmine.searchMyIssues"));
      if (this.issues.length === 0) {
        items.push(new vscode.TreeItem(this.filter ? "검색 결과 없음" : "일감 없음"));
        return items;
      }
      items.push(...groupByProject(this.issues));
      if (this.issues.length < this.total) {
        items.push(moreItem("redmine.loadMoreMy", this.issues.length, this.total));
      }
      return items;
    } catch (err) {
      return [errorItem(err)];
    }
  }
}
