import * as vscode from "vscode";
import type { Issue, IssueStatus, ListIssuesOptions } from "@redmine-tools/core";

export const PAGE_SIZE = 50;

// 시크릿 스토어 키 — getClient/auth(extension)와 setApiKey(treeSetupCommands) 공용. 순환 회피 위해 여기 둠.
export const SECRET_KEY = "redmine.apiKey";

// 검색어 → listIssues 옵션. #번호는 직접조회(담당 무관), 그 외 제목 부분일치. 전체 상태 대상
export function searchOpts(query: string): Partial<ListIssuesOptions> {
  const m = query.match(/^#?(\d+)$/);
  return m
    ? { issueId: Number(m[1]), statusId: "*", assignedToMe: false }
    : { subjectQuery: query, statusId: "*" };
}

export function closedStatusIds(statuses: IssueStatus[]): Set<number> {
  return new Set(statuses.filter((s) => s.is_closed).map((s) => s.id));
}

const STATUS_COLOR = { new: "charts.blue", prog: "charts.yellow", done: "charts.green" } as const;

function statusColor(issue: Issue, closedIds: Set<number>): string {
  if (closedIds.has(issue.status.id)) return STATUS_COLOR.done;
  if (/신규|new/i.test(issue.status.name)) return STATUS_COLOR.new;
  return STATUS_COLOR.prog;
}

// 트리 노드 — 기존 명령 핸들러가 ctx.issueId를 읽으므로 issueId를 노출
export class IssueNode extends vscode.TreeItem {
  constructor(
    public readonly issue: Issue,
    closedIds: Set<number>,
    assigned: boolean,
  ) {
    super(`#${issue.id} ${issue.subject}`, vscode.TreeItemCollapsibleState.None);
    const closed = closedIds.has(issue.status.id);
    this.description = [issue.status?.name, issue.priority?.name, issue.assigned_to?.name]
      .filter(Boolean)
      .join(" · ");
    this.tooltip = `#${issue.id} ${issue.subject}`;
    this.iconPath = new vscode.ThemeIcon(
      "circle-filled",
      new vscode.ThemeColor(statusColor(issue, closedIds)),
    );
    this.contextValue = closed
      ? "redmine:issue+closed"
      : `redmine:issue+open${assigned ? "+assigned" : ""}`;
    this.command = { command: "redmine.openIssue", title: "열기", arguments: [issue.id] };
  }

  get issueId(): number {
    return this.issue.id;
  }
}

export class GroupNode extends vscode.TreeItem {
  constructor(
    public readonly groupKey: string,
    label: string,
    count: number,
    kind: "project" | "status",
    expanded: boolean,
  ) {
    super(
      label,
      expanded
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed,
    );
    this.description = String(count);
    this.contextValue = `redmine:group+${kind}`;
  }
}

export class ProjectNode extends vscode.TreeItem {
  constructor(
    public readonly projectId: number,
    label: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = "redmine:project";
  }
}

export class MoreNode extends vscode.TreeItem {
  constructor(command: string, args: unknown[], loaded: number, total: number) {
    super(`⋯ 더 보기 (${loaded}/${total})`, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "redmine:more";
    this.iconPath = new vscode.ThemeIcon("ellipsis");
    this.command = { command, title: "더 보기", arguments: args };
  }
}

export type RedmineNode = IssueNode | GroupNode | ProjectNode | MoreNode;

export function setContext(key: string, value: unknown): void {
  void vscode.commands.executeCommand("setContext", key, value);
}

// 인증 상태 공유 — 401 보고 시 false 래칭. 성공 보고는 래칭을 풀지 않음(두 트리 경합 방지).
// 해제는 resetAuthLatch만 (새로고침 명령 / URL·API 키 변경 시).
let authFailed = false;

export function reportAuthSuccess(): void {
  if (authFailed) return; // 래칭 중엔 성공 무시
  setContext("redmine:authenticated", true);
}

export function reportAuthFailure(): void {
  authFailed = true;
  setContext("redmine:authenticated", false);
}

export function resetAuthLatch(): void {
  authFailed = false;
}

export function isAuthError(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && (err as { status?: number }).status === 401
  );
}

export function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
