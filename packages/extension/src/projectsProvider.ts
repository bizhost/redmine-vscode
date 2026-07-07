import type { Issue, Project, RedmineClient } from "@redmine-tools/core";
import { IssuesViewBase, PAGE_SIZE, type Group, type ViewData, searchOpts, toRow } from "./issuesWebview";

interface PageState {
  issues: Issue[];
  total: number;
}

export class ProjectsView extends IssuesViewBase {
  private projects: Project[] | undefined;
  private pages = new Map<number, PageState>(); // projectId → 로드된 일감
  private search: PageState | undefined;

  constructor(getClient: () => Promise<RedmineClient | undefined>) {
    super(getClient, "전체 프로젝트에서 검색 (제목 또는 #번호)");
  }

  protected reset(): void {
    this.projects = undefined;
    this.pages.clear();
    this.search = undefined;
  }

  private searchListOpts(offset: number) {
    return {
      assignedToMe: false, // 담당 무관
      limit: PAGE_SIZE,
      offset,
      projectId: 0, // falsy → 설정된 projectIdentifier 무시, 전 프로젝트
      ...searchOpts(this.query),
    };
  }

  protected async load(client: RedmineClient): Promise<ViewData> {
    if (this.query) {
      if (!this.search) {
        const page = await client.listIssues(this.searchListOpts(0));
        this.search = { issues: page.issues, total: page.totalCount };
      }
      return {
        rows: this.search.issues.map(toRow),
        loaded: this.search.issues.length,
        total: this.search.total,
        emptyText: "검색 결과 없음",
      };
    }
    if (!this.projects) this.projects = await client.listProjects();
    const groups: Group[] = this.projects.map((p) => {
      const state = this.pages.get(p.id);
      return {
        key: String(p.id),
        name: p.name,
        open: false,
        lazy: true,
        issues: state ? state.issues.map(toRow) : null,
        loaded: state?.issues.length,
        total: state?.total,
      };
    });
    return { groups };
  }

  /** 프로젝트 펼침 → 첫 페이지 로드 */
  protected async expand(key: string): Promise<void> {
    const client = await this.getClient();
    if (!client) return;
    const projectId = Number(key);
    let state = this.pages.get(projectId);
    if (!state) {
      const page = await client.listIssues({
        assignedToMe: false,
        projectId,
        limit: PAGE_SIZE,
      });
      state = { issues: page.issues, total: page.totalCount };
      this.pages.set(projectId, state);
    }
    this.postGroup(key, state);
  }

  protected async moreGroup(key: string): Promise<void> {
    const client = await this.getClient();
    const state = this.pages.get(Number(key));
    if (!client || !state) return;
    const page = await client.listIssues({
      assignedToMe: false,
      projectId: Number(key),
      offset: state.issues.length,
    });
    state.issues.push(...page.issues);
    state.total = page.totalCount;
    this.postGroup(key, state);
  }

  protected async more(): Promise<void> {
    const client = await this.getClient();
    if (!client || !this.search) return;
    const page = await client.listIssues(this.searchListOpts(this.search.issues.length));
    this.search.issues.push(...page.issues);
    this.search.total = page.totalCount;
    this.post({
      command: "data",
      rows: this.search.issues.map(toRow),
      loaded: this.search.issues.length,
      total: this.search.total,
      emptyText: "검색 결과 없음",
    });
  }

  private postGroup(key: string, state: PageState): void {
    this.post({
      command: "group",
      key,
      issues: state.issues.map(toRow),
      loaded: state.issues.length,
      total: state.total,
    });
  }
}
