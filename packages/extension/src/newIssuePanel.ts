import * as vscode from "vscode";
import type { CreateIssueFields, Issue, NamedRef, Project } from "@redmine-tools/core";

function esc(text: string | undefined | null): string {
  return (text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function options(items: NamedRef[], selectedId?: number, emptyLabel?: string): string {
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

export interface ProjectFormData {
  trackers: NamedRef[];
  assignees: NamedRef[];
  categories: NamedRef[];
}

export interface NewIssueContext {
  projects: Project[];
  statuses: NamedRef[];
  priorities: NamedRef[];
  defaultProjectId?: number;
  loadProjectData: (projectId: number) => Promise<ProjectFormData>;
  uploadFile: (filename: string, data: Uint8Array) => Promise<string>;
  onCreate: (fields: CreateIssueFields) => Promise<Issue>;
}

export class NewIssuePanel {
  private static current: NewIssuePanel | undefined;

  static show(ctx: NewIssueContext): void {
    if (NewIssuePanel.current) {
      NewIssuePanel.current.panel.reveal();
      return;
    }
    NewIssuePanel.current = new NewIssuePanel(ctx);
  }

  private readonly panel: vscode.WebviewPanel;
  private pendingUploads: Array<{ name: string; data: Uint8Array }> = [];

  private constructor(private readonly ctx: NewIssueContext) {
    this.panel = vscode.window.createWebviewPanel(
      "redmineNewIssue",
      "새 일감 만들기",
      vscode.ViewColumn.Active,
      { enableScripts: true },
    );
    this.panel.onDidDispose(() => {
      NewIssuePanel.current = undefined;
    });
    this.panel.webview.onDidReceiveMessage(async (msg: Record<string, unknown>) => {
      try {
        if (msg.command === "loadProject") {
          const data = await this.ctx.loadProjectData(Number(msg.projectId));
          void this.panel.webview.postMessage({ command: "projectData", ...data });
        } else if (msg.command === "create") {
          await this.create(msg);
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
        } else if (msg.command === "pasteImage") {
          this.pendingUploads.push({
            name: String(msg.name),
            data: new Uint8Array(Buffer.from(String(msg.base64), "base64")),
          });
          this.postFiles();
        }
      } catch (err) {
        void this.panel.webview.postMessage({ command: "idle" });
        vscode.window.showErrorMessage(`실패: ${err instanceof Error ? err.message : err}`);
      }
    });
    this.render();
    if (ctx.defaultProjectId) {
      // 초기 프로젝트 데이터 로드
      void ctx.loadProjectData(ctx.defaultProjectId).then((data) =>
        this.panel.webview.postMessage({ command: "projectData", ...data }),
      );
    }
  }

  private async create(msg: Record<string, unknown>): Promise<void> {
    const num = (v: unknown): number | undefined => (v === "" || v == null ? undefined : Number(v));
    const uploads = [];
    for (const f of this.pendingUploads) {
      uploads.push({ token: await this.ctx.uploadFile(f.name, f.data), filename: f.name });
    }
    const created = await this.ctx.onCreate({
      projectId: Number(msg.projectId),
      subject: String(msg.subject ?? "").trim(),
      description: String(msg.description ?? "") || undefined,
      trackerId: num(msg.trackerId),
      statusId: num(msg.statusId),
      priorityId: num(msg.priorityId),
      assignedToId: num(msg.assignedToId),
      categoryId: num(msg.categoryId),
      parentIssueId: num(msg.parentIssueId),
      doneRatio: num(msg.doneRatio),
      startDate: String(msg.startDate ?? ""),
      dueDate: String(msg.dueDate ?? ""),
      estimatedHours: num(msg.estimatedHours),
      isPrivate: msg.isPrivate === true,
      uploads,
    });
    this.pendingUploads = [];
    vscode.window.showInformationMessage(`#${created.id} 생성됨`);
    this.panel.dispose();
    void vscode.commands.executeCommand("redmine.openIssue", created.id);
  }

  private postFiles(): void {
    void this.panel.webview.postMessage({
      command: "files",
      names: this.pendingUploads.map((f) => f.name),
    });
  }

  private render(): void {
    const { projects, statuses, priorities, defaultProjectId } = this.ctx;
    const projectRefs: NamedRef[] = projects.map((p) => ({ id: p.id, name: p.name }));
    const doneOptions = Array.from({ length: 11 }, (_, i) => i * 10)
      .map((v) => `<option value="${v}">${v}%</option>`)
      .join("");

    this.panel.webview.html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 0 1.5em 2em; max-width: 60em; }
  h1 { font-size: 1.2em; }
  input, select, textarea {
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 3px; padding: .35em;
    font-family: var(--vscode-font-family); box-sizing: border-box;
  }
  #subject { width: 100%; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(11em, 1fr)); gap: .7em; margin: .8em 0; }
  label { display: flex; flex-direction: column; gap: .25em; font-size: .85em; color: var(--vscode-descriptionForeground); }
  label.inline { flex-direction: row; align-items: center; gap: .4em; }
  textarea { width: 100%; min-height: 250px; resize: vertical; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: .45em 1.2em; border-radius: 3px; cursor: pointer; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.busy { opacity: .7; pointer-events: none; }
  button.busy::after {
    content: ""; display: inline-block; width: .8em; height: .8em; margin-left: .5em;
    border: 2px solid currentColor; border-top-color: transparent; border-radius: 50%;
    animation: spin .8s linear infinite; vertical-align: -.1em;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .row { display: flex; gap: 1em; align-items: center; margin-top: .8em; }
  .chip {
    display: inline-block; margin: 0 .35em .3em 0; padding: .15em .6em; border-radius: 10px;
    background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
    font-size: .85em; cursor: pointer;
  }
  .req::after { content: " *"; color: var(--vscode-errorForeground); }
</style>
</head>
<body>
  <h1>새 일감 만들기</h1>
  <div class="grid">
    <label class="req">프로젝트 <select id="project">${options(projectRefs, defaultProjectId)}</select></label>
    <label class="req">유형 <select id="tracker"></select></label>
    <label>상태 <select id="status">${options(statuses)}</select></label>
    <label>우선순위 <select id="priority">${options(priorities)}</select></label>
  </div>
  <label class="req">제목 <input id="subject"></label>
  <div class="grid" style="margin-top:.8em">
    <label>담당자 <select id="assignee"><option value="">(없음)</option></select></label>
    <label>범주 <select id="category"><option value="">(없음)</option></select></label>
    <label>상위 일감 # <input type="number" id="parent" min="1"></label>
    <label>시작일 <input type="date" id="start"></label>
    <label>예정일 <input type="date" id="due"></label>
    <label>추정시간 <input type="number" id="estimated" min="0" step="0.5"></label>
    <label>진척도 <select id="done">${doneOptions}</select></label>
    <label class="inline"><input type="checkbox" id="private"> 비공개</label>
  </div>
  <label>설명 <textarea id="description" placeholder="이미지 붙여넣기 가능"></textarea></label>
  <div id="files" style="margin-top:.5em"></div>
  <div class="row">
    <button onclick="create(this)">저장</button>
    <button onclick="vscode.postMessage({command:'pickFiles'})">파일 첨부</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const val = (id) => document.getElementById(id).value;
    const fill = (id, items, empty) => {
      const el = document.getElementById(id);
      el.textContent = "";
      if (empty) el.appendChild(new Option(empty, ""));
      for (const item of items) el.appendChild(new Option(item.name, item.id));
    };
    document.getElementById("project").addEventListener("change", loadProject);
    function loadProject() {
      vscode.postMessage({ command: "loadProject", projectId: Number(val("project")) });
    }
    function renderFiles(names) {
      const el = document.getElementById("files");
      el.textContent = "";
      names.forEach((n, i) => {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = n + " ✕";
        chip.onclick = () => vscode.postMessage({ command: "removeFile", index: i });
        el.appendChild(chip);
      });
    }
    document.getElementById("description").addEventListener("paste", (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (const item of items) {
        if (!item.type.startsWith("image/")) continue;
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const ext = (item.type.split("/")[1] || "png").replace("jpeg", "jpg").split("+")[0];
        const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
        const reader = new FileReader();
        reader.onload = () => {
          vscode.postMessage({ command: "pasteImage", name: "paste-" + ts + "." + ext, base64: String(reader.result).split(",")[1] });
        };
        reader.readAsDataURL(file);
      }
    });
    window.addEventListener("message", (e) => {
      const msg = e.data;
      if (msg.command === "projectData") {
        fill("tracker", msg.trackers);
        fill("assignee", msg.assignees, "(없음)");
        fill("category", msg.categories, "(없음)");
      } else if (msg.command === "files") {
        renderFiles(msg.names);
      } else if (msg.command === "idle") {
        document.querySelectorAll("button").forEach((b) => { b.classList.remove("busy"); b.disabled = false; });
      }
    });
    function create(btn) {
      if (!val("subject").trim()) { document.getElementById("subject").focus(); return; }
      btn.classList.add("busy"); btn.disabled = true;
      vscode.postMessage({
        command: "create",
        projectId: val("project"),
        trackerId: val("tracker"),
        statusId: val("status"),
        priorityId: val("priority"),
        subject: val("subject"),
        description: val("description"),
        assignedToId: val("assignee"),
        categoryId: val("category"),
        parentIssueId: val("parent"),
        startDate: val("start"),
        dueDate: val("due"),
        estimatedHours: val("estimated"),
        doneRatio: val("done"),
        isPrivate: document.getElementById("private").checked,
      });
    }
    loadProject(); // 초기 프로젝트 데이터
  </script>
</body>
</html>`;
  }
}
