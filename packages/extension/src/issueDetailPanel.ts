import * as vscode from "vscode";
import type { Issue, IssueStatus, UpdateIssueChanges } from "@redmine-tools/core";

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

function options(items: IssueStatus[], selectedName: string | undefined): string {
  return items
    .map(
      (item) =>
        `<option value="${item.id}"${item.name === selectedName ? " selected" : ""}>${esc(item.name)}</option>`,
    )
    .join("");
}

export interface IssueDetailContext {
  issue: Issue;
  statuses: IssueStatus[];
  priorities: IssueStatus[];
  onUpdate: (changes: UpdateIssueChanges) => Promise<void>;
}

export class IssueDetailPanel {
  private static current: IssueDetailPanel | undefined;
  private ctx: IssueDetailContext;

  static show(ctx: IssueDetailContext): void {
    if (IssueDetailPanel.current) {
      IssueDetailPanel.current.ctx = ctx;
      IssueDetailPanel.current.render();
      IssueDetailPanel.current.panel.reveal();
      return;
    }
    IssueDetailPanel.current = new IssueDetailPanel(ctx);
  }

  static update(issue: Issue): void {
    if (IssueDetailPanel.current) {
      IssueDetailPanel.current.ctx.issue = issue;
      IssueDetailPanel.current.render();
    }
  }

  private readonly panel: vscode.WebviewPanel;

  private constructor(ctx: IssueDetailContext) {
    this.ctx = ctx;
    this.panel = vscode.window.createWebviewPanel(
      "redmineIssue",
      `#${ctx.issue.id}`,
      vscode.ViewColumn.One,
      { enableScripts: true },
    );
    this.panel.onDidDispose(() => {
      IssueDetailPanel.current = undefined;
    });
    this.panel.webview.onDidReceiveMessage(async (msg: Record<string, unknown>) => {
      try {
        if (msg.command === "save") {
          await this.ctx.onUpdate({
            statusId: Number(msg.statusId),
            priorityId: Number(msg.priorityId),
            doneRatio: Number(msg.doneRatio),
          });
          vscode.window.showInformationMessage(`#${this.ctx.issue.id} 저장됨`);
        } else if (msg.command === "comment") {
          const notes = String(msg.notes ?? "").trim();
          if (!notes) return;
          await this.ctx.onUpdate({ notes });
          vscode.window.showInformationMessage(`#${this.ctx.issue.id} 댓글 등록됨`);
        }
      } catch (err) {
        vscode.window.showErrorMessage(`저장 실패: ${err instanceof Error ? err.message : err}`);
      }
    });
    this.render();
  }

  private render(): void {
    const { issue, statuses, priorities } = this.ctx;
    this.panel.title = `#${issue.id} ${issue.subject}`;

    const doneOptions = Array.from({ length: 11 }, (_, i) => i * 10)
      .map(
        (v) => `<option value="${v}"${v === (issue.done_ratio ?? 0) ? " selected" : ""}>${v}%</option>`,
      )
      .join("");

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
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: .45em 1em; border-radius: 3px; cursor: pointer; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  select, textarea {
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 3px; padding: .35em;
    font-family: var(--vscode-font-family);
  }
  .editbar { display: flex; gap: 1em; align-items: end; flex-wrap: wrap; margin: .8em 0; }
  .editbar label { display: flex; flex-direction: column; gap: .25em; font-size: .85em; color: var(--vscode-descriptionForeground); }
  textarea { width: 100%; min-height: 5em; box-sizing: border-box; resize: vertical; }
  .commentform { margin-top: .6em; }
  .commentform button { margin-top: .5em; }
  h2 { font-size: 1.05em; margin-top: 1.5em; }
  ul { padding-left: 1.2em; }
</style>
</head>
<body>
  <h1>#${issue.id} ${esc(issue.subject)}</h1>
  <p class="meta">
    담당: ${esc(issue.assigned_to?.name ?? "-")}
    · 작성: ${esc(issue.author?.name ?? "-")}
    · 수정: ${esc(issue.updated_on ?? "-")}
  </p>

  <div class="editbar">
    <label>상태
      <select id="status">${options(statuses, issue.status?.name)}</select>
    </label>
    <label>우선순위
      <select id="priority">${options(priorities, issue.priority?.name)}</select>
    </label>
    <label>진행률
      <select id="done">${doneOptions}</select>
    </label>
    <button onclick="save()">저장</button>
  </div>

  <h2>내용</h2>
  <pre>${esc(issue.description) || "(없음)"}</pre>
  ${attachments ? `<h2>첨부파일</h2><ul>${attachments}</ul>` : ""}

  <h2>댓글 (${(issue.journals ?? []).filter((j) => j.notes).length})</h2>
  ${comments || '<p class="dim">댓글 없음</p>'}

  <div class="commentform">
    <textarea id="notes" placeholder="댓글 입력..."></textarea>
    <button onclick="comment()">댓글 등록</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    function save() {
      vscode.postMessage({
        command: "save",
        statusId: document.getElementById("status").value,
        priorityId: document.getElementById("priority").value,
        doneRatio: document.getElementById("done").value,
      });
    }
    function comment() {
      vscode.postMessage({ command: "comment", notes: document.getElementById("notes").value });
    }
  </script>
</body>
</html>`;
  }
}
