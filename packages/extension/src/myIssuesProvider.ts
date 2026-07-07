import type { Issue, RedmineClient } from "@redmine-tools/core";
import { IssuesViewBase, PAGE_SIZE, type ViewData, groupByProject, searchOpts, toRow } from "./issuesWebview";

export class MyIssuesView extends IssuesViewBase {
  private issues: Issue[] = [];
  private total = 0;
  private loadedFlag = false;

  constructor(getClient: () => Promise<RedmineClient | undefined>) {
    super(getClient, "내 일감 검색 (제목 또는 #번호)");
  }

  protected reset(): void {
    this.loadedFlag = false;
    this.issues = [];
  }

  private listOpts(offset: number) {
    return {
      assignedToMe: true,
      limit: PAGE_SIZE,
      offset,
      ...(this.query ? searchOpts(this.query) : {}),
    };
  }

  protected async load(client: RedmineClient): Promise<ViewData> {
    if (!this.loadedFlag) {
      const page = await client.listIssues(this.listOpts(0));
      this.issues = page.issues;
      this.total = page.totalCount;
      this.loadedFlag = true;
    }
    return this.build();
  }

  private build(): ViewData {
    const paging = { loaded: this.issues.length, total: this.total };
    if (this.query) {
      // 검색모드: 그룹 없이 플랫
      return { rows: this.issues.map(toRow), emptyText: "검색 결과 없음", ...paging };
    }
    return { groups: groupByProject(this.issues), ...paging };
  }

  protected async more(): Promise<void> {
    const client = await this.getClient();
    if (!client) return;
    const page = await client.listIssues(this.listOpts(this.issues.length));
    this.issues.push(...page.issues);
    this.total = page.totalCount;
    this.post({ command: "data", ...this.build() });
  }
}
