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
  /** attachment id → data URI (이미지 미리보기) */
  previews: Record<number, string>;
  onUpdate: (changes: UpdateIssueChanges) => Promise<void>;
  uploadFile: (filename: string, data: Uint8Array) => Promise<string>;
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
  private pendingFlash: string | undefined; // 다음 render에 표시할 성공 배너
  private pendingUploads: Array<{ name: string; data: Uint8Array }> = []; // 댓글 첨부 대기

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
          this.pendingFlash = "저장됨 ✓";
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
        } else if (msg.command === "comment") {
          const notes = String(msg.notes ?? "").trim();
          const files = this.pendingUploads;
          if (!notes && files.length === 0) return;
          this.pendingFlash = "댓글 등록됨 ✓";
          const uploads = [];
          for (const f of files) {
            uploads.push({ token: await this.ctx.uploadFile(f.name, f.data), filename: f.name });
          }
          this.pendingUploads = []; // 성공 렌더 전에 비움, 실패 시 catch에서 복구
          try {
            await this.ctx.onUpdate({ notes, privateNotes: msg.privateNotes === true, uploads });
          } catch (err) {
            this.pendingUploads = files;
            throw err;
          }
        } else if (msg.command === "pickFiles") {
          const picked = await vscode.window.showOpenDialog({ canSelectMany: true, openLabel: "첨부" });
          for (const uri of picked ?? []) {
            this.pendingUploads.push({
              name: uri.path.split("/").pop() ?? "file",
              data: await vscode.workspace.fs.readFile(uri),
            });
          }
          this.postFiles();
        } else if (msg.command === "removeFile") {
          this.pendingUploads.splice(Number(msg.index), 1);
          this.postFiles();
        }
      } catch (err) {
        this.pendingFlash = undefined;
        void this.panel.webview.postMessage({ command: "idle" }); // 버튼 복구
        vscode.window.showErrorMessage(`저장 실패: ${err instanceof Error ? err.message : err}`);
      }
    });
    this.render();
  }

  private postFiles(): void {
    void this.panel.webview.postMessage({
      command: "files",
      names: this.pendingUploads.map((f) => f.name),
    });
  }

  private render(): void {
    const { issue, statuses, priorities, trackers, assignees, categories } = this.ctx;
    const flash = this.pendingFlash;
    this.pendingFlash = undefined;
    this.panel.title = `#${issue.id} ${issue.subject}`;

    const doneOptions = Array.from({ length: 11 }, (_, i) => i * 10)
      .map(
        (v) => `<option value="${v}"${v === (issue.done_ratio ?? 0) ? " selected" : ""}>${v}%</option>`,
      )
      .join("");

    const renderAttachment = (a: NonNullable<Issue["attachments"]>[number]): string => {
      const preview = this.ctx.previews[a.id];
      const label = `${esc(a.filename)} <span class="dim">(${fmtSize(a.filesize)})</span>`;
      if (preview) {
        // 클릭 → 브라우저에서 원본
        return `<li class="att"><a href="${esc(a.content_url)}" title="브라우저로 열기"><img src="${preview}" alt="${esc(a.filename)}"></a><div>${label}</div></li>`;
      }
      return `<li><a href="${esc(a.content_url)}">${esc(a.filename)}</a> <span class="dim">(${fmtSize(a.filesize)})</span></li>`;
    };

    const attachments = (issue.attachments ?? []).map(renderAttachment).join("");

    const attachmentById = new Map((issue.attachments ?? []).map((a) => [a.id, a]));
    const comments = (issue.journals ?? [])
      .filter((j) => j.notes || j.details?.some((d) => d.property === "attachment"))
      .map((j) => {
        // 이 댓글에 첨부된 파일들 (details property=attachment, name=첨부 id)
        const journalAtts = (j.details ?? [])
          .filter((d) => d.property === "attachment")
          .map((d) => attachmentById.get(Number(d.name)))
          .filter((a): a is NonNullable<typeof a> => !!a)
          .map(renderAttachment)
          .join("");
        return `
        <div class="comment">
          <div class="meta">${esc(j.user?.name)} · ${esc(j.created_on)}</div>
          ${j.notes ? `<pre>${esc(j.notes)}</pre>` : ""}
          ${journalAtts ? `<ul class="catts">${journalAtts}</ul>` : ""}
        </div>`;
      })
      .join("");

    this.panel.webview.html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 0 1.5em 2em; max-width: 60em; }
  .meta, .dim { color: var(--vscode-descriptionForeground); font-size: .9em; }
  pre { white-space: pre-wrap; word-break: break-word; font-family: var(--vscode-font-family); background: var(--vscode-textBlockQuote-background); padding: .8em; border-radius: 4px; }
  .comment {
    margin-bottom: .8em; padding: .7em .9em; border-radius: 5px;
    background: var(--vscode-editorWidget-background, var(--vscode-textBlockQuote-background));
    border: 1px solid var(--vscode-panel-border);
    border-left: 3px solid var(--vscode-button-background);
  }
  .comment .meta { font-weight: 600; margin-bottom: .35em; }
  .comment pre { margin: 0; background: transparent; padding: 0; }
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
  li.att { list-style: none; margin: .6em 0; }
  ul.catts { padding-left: 0; margin: .3em 0 0; }
  button.busy { opacity: .7; pointer-events: none; }
  button.busy::after {
    content: ""; display: inline-block; width: .8em; height: .8em; margin-left: .5em;
    border: 2px solid currentColor; border-top-color: transparent; border-radius: 50%;
    animation: spin .8s linear infinite; vertical-align: -.1em;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .flash {
    position: fixed; top: .8em; left: 50%; transform: translateX(-50%);
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    padding: .6em 1.6em; border-radius: 4px; font-weight: 600; font-size: 1.05em;
    box-shadow: 0 2px 8px rgba(0,0,0,.3); pointer-events: none; z-index: 10;
    animation: flashfade 2.2s ease forwards;
  }
  @keyframes flashfade { 0%,60% { opacity: 1; } 100% { opacity: 0; visibility: hidden; } }
  .chip {
    display: inline-block; margin: 0 .35em .3em 0; padding: .15em .6em; border-radius: 10px;
    background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
    font-size: .85em; cursor: pointer;
  }
  .chip:hover { opacity: .75; }
  li.att img { max-width: 100%; max-height: 260px; border-radius: 4px; border: 1px solid var(--vscode-panel-border); cursor: pointer; display: block; }
</style>
</head>
<body>
  ${flash ? `<div class="flash">${esc(flash)}</div>` : ""}
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
  <div class="row"><button onclick="save(this)">저장</button></div>

  ${attachments ? `<h2>첨부파일</h2><ul>${attachments}</ul>` : ""}

  <h2>댓글 (${(issue.journals ?? []).filter((j) => j.notes || j.details?.some((d) => d.property === "attachment")).length})</h2>
  ${comments || '<p class="dim">댓글 없음</p>'}

  <div class="commentform">
    <textarea id="notes" placeholder="댓글 입력..."></textarea>
    <div id="files"></div>
    <div class="row">
      <button onclick="comment(this)">댓글 등록</button>
      <button onclick="vscode.postMessage({command:'pickFiles'})">파일 첨부</button>
      <label><input type="checkbox" id="private"> 비공개 댓글</label>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const val = (id) => document.getElementById(id).value;
    function busy(btn) { btn.classList.add("busy"); btn.disabled = true; }
    function renderFiles(names) {
      const el = document.getElementById("files");
      el.textContent = "";
      names.forEach((n, i) => {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = n + " ✕";
        chip.title = "제거";
        chip.onclick = () => vscode.postMessage({ command: "removeFile", index: i });
        el.appendChild(chip);
      });
    }
    renderFiles(${JSON.stringify(this.pendingUploads.map((f) => f.name)).replace(/</g, "\\u003c")});
    window.addEventListener("message", (e) => {
      if (e.data.command === "idle") {
        document.querySelectorAll("button").forEach((b) => { b.classList.remove("busy"); b.disabled = false; });
      } else if (e.data.command === "files") {
        renderFiles(e.data.names);
      }
    });
    function save(btn) {
      busy(btn);
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
    function comment(btn) {
      if (!val("notes").trim() && !document.getElementById("files").childElementCount) return;
      busy(btn);
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
