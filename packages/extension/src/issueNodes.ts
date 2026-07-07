import * as vscode from "vscode";
import type { Issue } from "@redmine-tools/core";

export const PAGE_SIZE = 50;

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
