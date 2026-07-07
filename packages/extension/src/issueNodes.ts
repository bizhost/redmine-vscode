import * as vscode from "vscode";
import type { Issue, ListIssuesOptions } from "@redmine-tools/core";

export const PAGE_SIZE = 50;

/** 검색어 → listIssues 옵션. #번호는 직접 조회(담당/상태 무관) */
export function searchOpts(query: string): Partial<ListIssuesOptions> {
  const m = query.match(/^#?(\d+)$/);
  return m
    ? { issueId: Number(m[1]), statusId: "*", assignedToMe: false }
    : { subjectQuery: query };
}

export class ProjectGroupNode extends vscode.TreeItem {
  constructor(
    name: string,
    readonly issues: Issue[],
  ) {
    super(name, vscode.TreeItemCollapsibleState.Expanded);
    this.description = String(issues.length);
    this.iconPath = new vscode.ThemeIcon("project");
  }
}

/** 프로젝트별 그룹 노드 — 일감 있는 프로젝트만 */
export function groupByProject(issues: Issue[]): ProjectGroupNode[] {
  const groups = new Map<string, Issue[]>();
  for (const issue of issues) {
    const name = issue.project?.name ?? "(프로젝트 없음)";
    const list = groups.get(name);
    if (list) list.push(issue);
    else groups.set(name, [issue]);
  }
  return [...groups.entries()].map(([name, list]) => new ProjectGroupNode(name, list));
}

/** 활성 검색 표시 노드 — 클릭 시 검색 명령 재실행(비우면 해제) */
export function filterHeaderItem(query: string, command: string): vscode.TreeItem {
  const item = new vscode.TreeItem(`검색: "${query}"`);
  item.description = "클릭해서 수정/해제";
  item.iconPath = new vscode.ThemeIcon("filter");
  item.command = { command, title: "검색" };
  return item;
}

export function issueItem(issue: Issue): vscode.TreeItem {
  const item = new vscode.TreeItem(`#${issue.id} ${issue.subject}`);
  item.description = issue.status?.name ?? "";
  item.tooltip = `${issue.subject}\n상태: ${issue.status?.name}\n담당: ${issue.assigned_to?.name ?? "-"}`;
  item.iconPath = new vscode.ThemeIcon("issues");
  item.command = { command: "redmine.openIssue", title: "일감 열기", arguments: [issue.id] };
  return item;
}

export function moreItem(command: string, loaded: number, total: number, ...args: unknown[]): vscode.TreeItem {
  const item = new vscode.TreeItem(`더 보기 (${loaded}/${total})`);
  item.iconPath = new vscode.ThemeIcon("ellipsis");
  item.command = { command, title: "더 보기", arguments: args };
  return item;
}

export function setupHintItem(): vscode.TreeItem {
  const item = new vscode.TreeItem("설정 필요: URL/API Key");
  item.command = { command: "redmine.setApiKey", title: "Redmine: Set API Key" };
  item.iconPath = new vscode.ThemeIcon("gear");
  return item;
}

export function errorItem(err: unknown): vscode.TreeItem {
  const message = err instanceof Error ? err.message : String(err);
  vscode.window.showErrorMessage(`Redmine 조회 실패: ${message}`);
  return new vscode.TreeItem(`오류: ${message}`);
}
