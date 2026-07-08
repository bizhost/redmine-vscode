import * as vscode from "vscode";
import type { Issue, RedmineClient } from "@redmine-tools/core";
import {
  GroupNode,
  IssueNode,
  MoreNode,
  TodayTimeNode,
  PAGE_SIZE,
  closedStatusIds,
  errText,
  isAuthError,
  reportAuthFailure,
  reportAuthSuccess,
  setContext,
  type RedmineNode,
} from "./treeSupport";
import { ymd } from "./panelData";

type GroupBy = "project" | "status" | "none";

/** assignedToMe 단일 스트림을 페이지로 로드 → groupBy 설정에 따라 클라이언트 측 그룹핑 */
export class MyIssuesTree implements vscode.TreeDataProvider<RedmineNode> {
  private readonly _onDidChange = new vscode.EventEmitter<RedmineNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private view: vscode.TreeView<RedmineNode> | undefined;
  private issues: Issue[] = [];
  private total = 0;
  private loaded = false;
  private closedIds = new Set<number>();
  // 오늘 내 소요시간 캐시. null = 조회 실패(노드 생략). {hours,count} = 조회 성공(0건 포함).
  private todayTime: { hours: number; count: number } | null = null;

  constructor(private readonly getClient: () => Promise<RedmineClient | undefined>) {}

  bindView(view: vscode.TreeView<RedmineNode>): void {
    this.view = view;
  }

  private get groupBy(): GroupBy {
    return vscode.workspace
      .getConfiguration("redmine")
      .get<GroupBy>("views.myIssues.groupBy", "project");
  }

  private get showTodayTime(): boolean {
    return vscode.workspace
      .getConfiguration("redmine")
      .get<boolean>("sidebar.showTodayTime", true);
  }

  refresh(): void {
    this.loaded = false;
    this.issues = [];
    this._onDidChange.fire();
  }

  /** 재조회 없이 다시 그룹핑만 (groupBy 변경용) */
  rerender(): void {
    this._onDidChange.fire();
  }

  getTreeItem(node: RedmineNode): vscode.TreeItem {
    return node;
  }

  async getChildren(element?: RedmineNode): Promise<RedmineNode[]> {
    if (element instanceof GroupNode) return this.groupIssues(element.groupKey);
    if (element) return []; // IssueNode/MoreNode 자식 없음
    return this.rootChildren();
  }

  async loadMore(): Promise<void> {
    const client = await this.getClient();
    if (!client) return;
    const page = await client.listIssues({
      assignedToMe: true,
      limit: PAGE_SIZE,
      offset: this.issues.length,
    });
    this.issues.push(...page.issues);
    this.total = page.totalCount;
    this._onDidChange.fire();
  }

  private async rootChildren(): Promise<RedmineNode[]> {
    if (!(await this.ensureLoaded())) return [];
    if (this.issues.length === 0) return []; // viewsWelcome ③ (일감 없음) — 시간 노드도 생략(빈 상태 우선)
    const gb = this.groupBy;
    const nodes: RedmineNode[] =
      gb === "none"
        ? this.issues.map((i) => new IssueNode(i, this.closedIds, true))
        : this.buildGroups(gb).map(
            (g) => new GroupNode(g.key, g.label, g.issues.length, gb, true),
          );
    if (this.issues.length < this.total) {
      nodes.push(new MoreNode("redmine.myIssues.more", [], this.issues.length, this.total));
    }
    if (this.showTodayTime && this.todayTime) {
      nodes.unshift(new TodayTimeNode(this.todayTime.hours, this.todayTime.count));
    }
    return nodes;
  }

  private groupIssues(key: string): RedmineNode[] {
    const gb = this.groupBy;
    if (gb === "none") return [];
    return (
      this.buildGroups(gb)
        .find((g) => g.key === key)
        ?.issues.map((i) => new IssueNode(i, this.closedIds, true)) ?? []
    );
  }

  private buildGroups(gb: "project" | "status"): { key: string; label: string; issues: Issue[] }[] {
    const map = new Map<string, Issue[]>();
    for (const issue of this.issues) {
      const label =
        gb === "project"
          ? (issue.project?.name ?? "(프로젝트 없음)")
          : (issue.status?.name ?? "(상태 없음)");
      const list = map.get(label);
      if (list) list.push(issue);
      else map.set(label, [issue]);
    }
    return [...map.entries()].map(([label, issues]) => ({ key: label, label, issues }));
  }

  private async ensureLoaded(): Promise<boolean> {
    if (this.loaded) return true;
    const client = await this.getClient();
    if (!client) {
      setContext("redmine:authenticated", false);
      return false;
    }
    setContext("redmine:loading", true);
    if (this.view) this.view.message = "일감을 불러오는 중…";
    const today = ymd(new Date());
    try {
      const [page, statuses, timeRes] = await Promise.all([
        client.listIssues({ assignedToMe: true, limit: PAGE_SIZE, offset: 0 }),
        client.listStatuses(),
        // 실패해도 트리 로드는 계속 — 노드만 생략(null)
        client.listTimeEntries({ from: today, to: today, userId: "me" }).catch(() => null),
      ]);
      this.issues = page.issues;
      this.total = page.totalCount;
      this.closedIds = closedStatusIds(statuses);
      this.todayTime = timeRes
        ? { hours: timeRes.entries.reduce((s, e) => s + (e.hours || 0), 0), count: timeRes.entries.length }
        : null;
      this.loaded = true;
      reportAuthSuccess();
      setContext("redmine:loadError", false);
      if (this.view) this.view.message = undefined;
      return true;
    } catch (err) {
      if (isAuthError(err)) {
        reportAuthFailure(); // viewsWelcome ②가 안내
        if (this.view) this.view.message = undefined;
      } else {
        setContext("redmine:loadError", true); // ③('일감 없음') 오인 방지
        if (this.view) this.view.message = `불러오기 실패: ${errText(err)}`;
      }
      return false;
    } finally {
      setContext("redmine:loading", false);
    }
  }
}
