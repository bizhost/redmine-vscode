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
  private filter: string | undefined;
  private searchState: PageState | undefined;

  constructor(private readonly getClient: () => Promise<RedmineClient | undefined>) {}

  refresh(): void {
    this.pages.clear();
    this.searchState = undefined;
    this._onDidChangeTreeData.fire();
  }

  getFilter(): string | undefined {
    return this.filter;
  }

  setFilter(query: string | undefined): void {
    this.filter = query?.trim() || undefined;
    this.refresh();
  }

  private searchListOpts(offset: number) {
    return {
      assignedToMe: false, // 프로젝트 pane은 담당 무관
      limit: PAGE_SIZE,
      offset,
      projectId: 0, // falsy → 설정된 projectIdentifier 무시, 전 프로젝트 검색
      ...searchOpts(this.filter ?? ""),
    };
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

  async loadMoreSearch(): Promise<void> {
    const client = await this.getClient();
    if (!client || !this.searchState) return;
    const page = await client.listIssues(this.searchListOpts(this.searchState.issues.length));
    this.searchState.issues.push(...page.issues);
    this.searchState.total = page.totalCount;
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
        if (this.filter) return this.searchRoot(client);
        const projects = await client.listProjects();
        return projects.map((p) => new ProjectNode(p.id, p.name));
      }

      if (element instanceof ProjectGroupNode) {
        return element.issues.map(issueItem);
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

  /** 검색 모드 루트: 전 프로젝트 대상 결과를 프로젝트별 그룹으로 */
  private async searchRoot(client: RedmineClient): Promise<vscode.TreeItem[]> {
    if (!this.searchState) {
      const page = await client.listIssues(this.searchListOpts(0));
      this.searchState = { issues: page.issues, total: page.totalCount };
    }
    const state = this.searchState;
    const items: vscode.TreeItem[] = [filterHeaderItem(this.filter ?? "", "redmine.searchProjects")];
    if (state.issues.length === 0) {
      items.push(new vscode.TreeItem("검색 결과 없음"));
      return items;
    }
    items.push(...groupByProject(state.issues));
    if (state.issues.length < state.total) {
      items.push(moreItem("redmine.loadMoreProjectsSearch", state.issues.length, state.total));
    }
    return items;
  }
}
