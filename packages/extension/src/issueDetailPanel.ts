import * as vscode from "vscode";
import type { Issue } from "@redmine-tools/core";

function esc(text: string | undefined | null): string {
  return (text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export class IssueDetailPanel {
  private static current: IssueDetailPanel | undefined;
  private issue: Issue;

  static show(issue: Issue): void {
    if (IssueDetailPanel.current) {
      IssueDetailPanel.current.issue = issue;
      IssueDetailPanel.current.render();
      IssueDetailPanel.current.panel.reveal();
      return;
    }
    IssueDetailPanel.current = new IssueDetailPanel(issue);
  }

  static update(issue: Issue): void {
    if (IssueDetailPanel.current) {
      IssueDetailPanel.current.issue = issue;
      IssueDetailPanel.current.render();
    }
  }

  private readonly panel: vscode.WebviewPanel;

  private constructor(issue: Issue) {
    this.issue = issue;
    this.panel = vscode.window.createWebviewPanel(
      "redmineIssue",
      `#${issue.id}`,
      vscode.ViewColumn.One,
      { enableScripts: true },
    );
    this.panel.onDidDispose(() => {
      IssueDetailPanel.current = undefined;
    });
    this.panel.webview.onDidReceiveMessage((msg: { command: string }) => {
      if (msg.command === "changeStatus") {
        void vscode.commands.executeCommand("redmine.changeStatus", this.issue.id);
      } else if (msg.command === "addComment") {
        void vscode.commands.executeCommand("redmine.addComment", this.issue.id);
      }
    });
    this.render();
  }

  private render(): void {
    const issue = this.issue;
    this.panel.title = `#${issue.id} ${issue.subject}`;

    const attachments = (issue.attachments ?? [])
      .map(
        (a) =>
          `<li><a href="${esc(a.content_url)}">${esc(a.filename)}</a> <span class="dim">(${fmtSize(a.filesize)})</span></li>`,
      )
      .join("");

    const comments = (issue.journals ?? [])
      .filter((j) => j.notes)
      .map(
        (j) => `
        <div class="comment">
          <div class="meta">${esc(j.user?.name)} · ${esc(j.created_on)}</div>
          <pre>${esc(j.notes)}</pre>
        </div>`,
      )
      .join("");

    this.panel.webview.html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 0 1.5em 2em; }
  h1 { font-size: 1.3em; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: .4em; }
  .meta, .dim { color: var(--vscode-descriptionForeground); font-size: .9em; }
  pre { white-space: pre-wrap; word-break: break-word; font-family: var(--vscode-font-family); background: var(--vscode-textBlockQuote-background); padding: .8em; border-radius: 4px; }
  .comment { margin-bottom: 1em; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: .5em 1em; border-radius: 3px; cursor: pointer; margin-right: .5em; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  h2 { font-size: 1.05em; margin-top: 1.5em; }
  ul { padding-left: 1.2em; }
</style>
</head>
<body>
  <h1>#${issue.id} ${esc(issue.subject)}</h1>
  <p class="meta">
    상태: <b>${esc(issue.status?.name)}</b>
    · 담당: ${esc(issue.assigned_to?.name ?? "-")}
    · 작성: ${esc(issue.author?.name ?? "-")}
    · 수정: ${esc(issue.updated_on ?? "-")}
  </p>
  <div>
    <button onclick="post('changeStatus')">상태 변경</button>
    <button onclick="post('addComment')">댓글 작성</button>
  </div>
  <h2>내용</h2>
  <pre>${esc(issue.description) || "(없음)"}</pre>
  ${attachments ? `<h2>첨부파일</h2><ul>${attachments}</ul>` : ""}
  <h2>댓글 (${(issue.journals ?? []).filter((j) => j.notes).length})</h2>
  ${comments || '<p class="dim">댓글 없음</p>'}
  <script>
    const vscode = acquireVsCodeApi();
    function post(command) { vscode.postMessage({ command }); }
  </script>
</body>
</html>`;
  }
}
