import * as vscode from "vscode";
import type { Issue, NamedRef, UpdateIssueChanges } from "@redmine-tools/core";

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

function options(items: NamedRef[], selectedId: number | undefined, emptyLabel?: string): string {
  const empty =
    emptyLabel !== undefined
      ? `<option value=""${selectedId === undefined ? " selected" : ""}>${esc(emptyLabel)}</option>`
      : "";
  return (
    empty +
    items
      .map(
        (item) =>
          `<option value="${item.id}"${item.id === selectedId ? " selected" : ""}>${esc(item.name)}</option>`,
      )
      .join("")
  );
}

export interface IssueDetailContext {
  issue: Issue;
  statuses: NamedRef[];
  priorities: NamedRef[];
  trackers: NamedRef[];
  assignees: NamedRef[];
  categories: NamedRef[];
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
          const num = (v: unknown): number | "" => (v === "" ? "" : Number(v));
          await this.ctx.onUpdate({
            subject: String(msg.subject ?? this.ctx.issue.subject),
            description: String(msg.description ?? ""),
            trackerId: Number(msg.trackerId),
            statusId: Number(msg.statusId),
            priorityId: Number(msg.priorityId),
            assignedToId: num(msg.assignedToId),
            categoryId: num(msg.categoryId),
            doneRatio: Number(msg.doneRatio),
            startDate: String(msg.startDate ?? ""),
            dueDate: String(msg.dueDate ?? ""),
            estimatedHours: msg.estimatedHours === "" ? "" : Number(msg.estimatedHours),
          });
          vscode.window.showInformationMessage(`#${this.ctx.issue.id} 저장됨`);
        } else if (msg.command === "comment") {
          const notes = String(msg.notes ?? "").trim();
          if (!notes) return;
          await this.ctx.onUpdate({ notes, privateNotes: msg.privateNotes === true });
          vscode.window.showInformationMessage(`#${this.ctx.issue.id} 댓글 등록됨`);
        }
      } catch (err) {
        vscode.window.showErrorMessage(`저장 실패: ${err instanceof Error ? err.message : err}`);
      }
    });
    this.render();
  }

  private render(): void {
    const { issue, statuses, priorities, trackers, assignees, categories } = this.ctx;
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
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 0 1.5em 2em; max-width: 60em; }
  .meta, .dim { color: var(--vscode-descriptionForeground); font-size: .9em; }
  pre { white-space: pre-wrap; word-break: break-word; font-family: var(--vscode-font-family); background: var(--vscode-textBlockQuote-background); padding: .8em; border-radius: 4px; }
  .comment { margin-bottom: 1em; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: .45em 1.2em; border-radius: 3px; cursor: pointer; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  input, select, textarea {
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 3px; padding: .35em;
    font-family: var(--vscode-font-family); box-sizing: border-box;
  }
  #subject { width: 100%; font-size: 1.1em; font-weight: 600; margin: .6em 0; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(11em, 1fr)); gap: .7em; margin-bottom: .8em; }
  .grid label, .desclabel { display: flex; flex-direction: column; gap: .25em; font-size: .85em; color: var(--vscode-descriptionForeground); }
  textarea { width: 100%; resize: vertical; }
  #description { min-height: 8em; }
  #notes { min-height: 5em; }
  .commentform { margin-top: .6em; }
  .row { display: flex; gap: 1em; align-items: center; margin-top: .5em; }
  h2 { font-size: 1.05em; margin-top: 1.5em; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: .3em; }
  ul { padding-left: 1.2em; }
</style>
</head>
<body>
  <p class="meta">#${issue.id} · ${esc(issue.project?.name ?? "")} · 작성: ${esc(issue.author?.name ?? "-")} · 수정: ${esc(issue.updated_on ?? "-")}</p>
  <input id="subject" value="${esc(issue.subject)}">

  <div class="grid">
    <label>유형 <select id="tracker">${options(trackers, issue.tracker?.id)}</select></label>
    <label>상태 <select id="status">${options(statuses, issue.status?.id)}</select></label>
    <label>우선순위 <select id="priority">${options(priorities, issue.priority?.id)}</select></label>
    <label>담당자 <select id="assignee">${options(assignees, issue.assigned_to?.id, "(없음)")}</select></label>
    <label>범주 <select id="category">${options(categories, issue.category?.id, "(없음)")}</select></label>
    <label>진척도 <select id="done">${doneOptions}</select></label>
    <label>시작일 <input type="date" id="start" value="${esc(issue.start_date)}"></label>
    <label>예정일 <input type="date" id="due" value="${esc(issue.due_date)}"></label>
    <label>추정시간 <input type="number" id="estimated" min="0" step="0.5" value="${issue.estimated_hours ?? ""}"></label>
  </div>

  <label class="desclabel">설명
    <textarea id="description">${esc(issue.description)}</textarea>
  </label>
  <div class="row"><button onclick="save()">저장</button></div>

  ${attachments ? `<h2>첨부파일</h2><ul>${attachments}</ul>` : ""}

  <h2>댓글 (${(issue.journals ?? []).filter((j) => j.notes).length})</h2>
  ${comments || '<p class="dim">댓글 없음</p>'}

  <div class="commentform">
    <textarea id="notes" placeholder="댓글 입력..."></textarea>
    <div class="row">
      <button onclick="comment()">댓글 등록</button>
      <label><input type="checkbox" id="private"> 비공개 댓글</label>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const val = (id) => document.getElementById(id).value;
    function save() {
      vscode.postMessage({
        command: "save",
        subject: val("subject"),
        description: val("description"),
        trackerId: val("tracker"),
        statusId: val("status"),
        priorityId: val("priority"),
        assignedToId: val("assignee"),
        categoryId: val("category"),
        doneRatio: val("done"),
        startDate: val("start"),
        dueDate: val("due"),
        estimatedHours: val("estimated"),
      });
    }
    function comment() {
      vscode.postMessage({
        command: "comment",
        notes: val("notes"),
        privateNotes: document.getElementById("private").checked,
      });
    }
  </script>
</body>
</html>`;
  }
}
