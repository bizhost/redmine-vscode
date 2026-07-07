import * as vscode from "vscode";
import type { Issue, ListIssuesOptions, RedmineClient } from "@redmine-tools/core";

export const PAGE_SIZE = 50;

/** 검색어 → listIssues 옵션. 검색은 닫힌 일감 포함 전체 상태 대상. #번호는 직접 조회(담당 무관) */
export function searchOpts(query: string): Partial<ListIssuesOptions> {
  const m = query.match(/^#?(\d+)$/);
  return m
    ? { issueId: Number(m[1]), statusId: "*", assignedToMe: false }
    : { subjectQuery: query, statusId: "*" };
}

interface ItemRow {
  id: number;
  label: string;
  status: string;
}

export interface Group {
  key: string;
  name: string;
  open: boolean;
  /** true면 펼칠 때 expand 요청 */
  lazy: boolean;
  issues: ItemRow[] | null;
  loaded?: number;
  total?: number;
}

export function toRow(issue: Issue): ItemRow {
  return {
    id: issue.id,
    label: `#${issue.id} ${issue.subject}`,
    status: issue.status?.name ?? "",
  };
}

export function groupByProject(issues: Issue[]): Group[] {
  const groups = new Map<string, ItemRow[]>();
  for (const issue of issues) {
    const name = issue.project?.name ?? "(프로젝트 없음)";
    const list = groups.get(name);
    if (list) list.push(toRow(issue));
    else groups.set(name, [toRow(issue)]);
  }
  return [...groups.entries()].map(([name, rows]) => ({
    key: name,
    name,
    open: true,
    lazy: false,
    issues: rows,
  }));
}

export interface ViewData {
  groups?: Group[];
  /** 검색모드 플랫 리스트 (그룹 없음) */
  rows?: ItemRow[];
  loaded?: number;
  total?: number;
  needSetup?: boolean;
  emptyText?: string;
}

export abstract class IssuesViewBase implements vscode.WebviewViewProvider {
  protected view: vscode.WebviewView | undefined;
  private filter = "";
  private selection: number[] = []; // webview에서 선택된 일감 id들

  getSelection(): number[] {
    return this.selection;
  }

  constructor(
    protected readonly getClient: () => Promise<RedmineClient | undefined>,
    private readonly searchPlaceholder: string,
  ) {}

  protected get query(): string {
    return this.filter;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = buildHtml(this.searchPlaceholder);
    view.webview.onDidReceiveMessage(async (msg: Record<string, unknown>) => {
      try {
        if (msg.command === "ready") {
          await this.send();
        } else if (msg.command === "open") {
          void vscode.commands.executeCommand("redmine.openIssue", Number(msg.id));
        } else if (msg.command === "setup") {
          void vscode.commands.executeCommand("redmine.setApiKey");
        } else if (msg.command === "select") {
          this.selection = (msg.ids as number[]) ?? [];
        } else if (msg.command === "query") {
          this.filter = String(msg.query ?? "").trim();
          this.reset();
          await this.send();
        } else if (msg.command === "expand") {
          await this.expand(String(msg.key));
        } else if (msg.command === "more") {
          await this.more();
        } else if (msg.command === "moreGroup") {
          await this.moreGroup(String(msg.key));
        }
      } catch (err) {
        this.post({ command: "error", message: err instanceof Error ? err.message : String(err) });
      }
    });
  }

  protected post(msg: unknown): void {
    void this.view?.webview.postMessage(msg);
  }

  protected async send(): Promise<void> {
    const client = await this.getClient();
    if (!client) {
      this.post({ command: "data", groups: [], needSetup: true });
      return;
    }
    const data = await this.load(client);
    this.post({ command: "data", ...data });
  }

  refresh(): void {
    this.reset();
    void this.send();
  }

  toggleSearch(): void {
    this.view?.show(true);
    this.post({ command: "toggleSearch" });
  }

  protected abstract load(client: RedmineClient): Promise<ViewData>;
  protected abstract reset(): void;
  protected async expand(_key: string): Promise<void> {}
  protected async more(): Promise<void> {}
  protected async moreGroup(_key: string): Promise<void> {}
}

function buildHtml(placeholder: string): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<style>
  body { padding: 0; margin: 0; color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: 13px; }
  #bar { display: none; padding: .35em .5em; }
  #bar.show { display: flex; align-items: center; gap: .3em;
    background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 3px; margin: .35em .5em; padding: 0 .3em; }
  #q { flex: 1; border: none; outline: none; background: transparent;
    color: var(--vscode-input-foreground); padding: .35em .2em; font-family: inherit; font-size: inherit; }
  #clear { cursor: pointer; color: var(--vscode-descriptionForeground); padding: 0 .2em; user-select: none; }
  #clear:hover { color: var(--vscode-foreground); }
  details { margin: 0; }
  summary { list-style: none; cursor: pointer; padding: .25em .5em; font-weight: 600;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  summary::before { content: "▸ "; color: var(--vscode-descriptionForeground); }
  details[open] > summary::before { content: "▾ "; }
  summary:hover { background: var(--vscode-list-hoverBackground); }
  .badge { color: var(--vscode-descriptionForeground); font-weight: 400; font-size: .9em; margin-left: .3em; }
  .item { display: flex; gap: .5em; padding: .22em .5em .22em 1.6em; cursor: pointer;
    white-space: nowrap; overflow: hidden; user-select: none; }
  .item:hover { background: var(--vscode-list-hoverBackground); }
  .item.sel { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  .item.sel .st { color: inherit; opacity: .8; }
  .item .label { flex: 1; overflow: hidden; text-overflow: ellipsis; }
  .item .st { color: var(--vscode-descriptionForeground); font-size: .9em; flex-shrink: 0; }
  .more, .dim, .setup { color: var(--vscode-descriptionForeground); padding: .3em .5em .3em 1.6em; cursor: pointer; }
  .dim { cursor: default; }
  .more:hover, .setup:hover { color: var(--vscode-textLink-foreground); }
  .setup { padding-left: .5em; }
  .top { padding-left: .5em; }
</style>
</head>
<body>
  <div id="bar">
    <input id="q" type="text" placeholder="${placeholder}">
    <span id="clear" title="지우기">✕</span>
  </div>
  <div id="list"><div class="dim" style="padding-left:.5em">불러오는 중...</div></div>
  <script>
    const vscode = acquireVsCodeApi();
    const bar = document.getElementById("bar");
    const q = document.getElementById("q");
    const list = document.getElementById("list");
    const openState = new Map();
    let timer;

    function sendQuery() { vscode.postMessage({ command: "query", query: q.value }); }
    q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(sendQuery, 300); });
    q.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { clearTimeout(timer); sendQuery(); }
      if (e.key === "Escape") { q.value = ""; clearTimeout(timer); hideBar(); sendQuery(); }
    });
    document.getElementById("clear").addEventListener("click", () => { q.value = ""; sendQuery(); q.focus(); });

    function hideBar() { bar.classList.remove("show"); }
    function toggleBar() {
      if (bar.classList.contains("show")) {
        if (q.value) { q.value = ""; sendQuery(); }
        hideBar();
      } else {
        bar.classList.add("show");
        q.focus();
      }
    }

    const selected = new Set();
    function postSelection() {
      vscode.postMessage({ command: "select", ids: [...selected] });
    }
    function applySelClass() {
      document.querySelectorAll(".item").forEach((el) => {
        el.classList.toggle("sel", selected.has(Number(el.dataset.id)));
      });
    }
    function itemEl(row) {
      const div = document.createElement("div");
      div.className = "item" + (selected.has(row.id) ? " sel" : "");
      div.dataset.id = row.id;
      div.title = row.label;
      // 우클릭 → VS Code 컨텍스트 메뉴 (다운로드)
      div.setAttribute("data-vscode-context", JSON.stringify({
        webviewSection: "issue", issueId: row.id, preventDefaultContextMenuItems: true,
      }));
      const label = document.createElement("span");
      label.className = "label"; label.textContent = row.label;
      const st = document.createElement("span");
      st.className = "st"; st.textContent = row.status;
      div.append(label, st);
      div.onclick = (e) => {
        if (e.ctrlKey || e.metaKey) {
          selected.has(row.id) ? selected.delete(row.id) : selected.add(row.id);
        } else {
          selected.clear();
          selected.add(row.id);
        }
        applySelClass();
        postSelection();
      };
      div.ondblclick = () => vscode.postMessage({ command: "open", id: row.id });
      div.oncontextmenu = () => {
        // 선택 밖 우클릭 → 해당 항목 단일 선택
        if (!selected.has(row.id)) {
          selected.clear();
          selected.add(row.id);
          applySelClass();
          postSelection();
        }
      };
      return div;
    }

    function fillItems(container, group) {
      container.textContent = "";
      if (!group.issues) { const d = document.createElement("div"); d.className = "dim"; d.textContent = "..."; container.appendChild(d); return; }
      if (group.issues.length === 0) { const d = document.createElement("div"); d.className = "dim"; d.textContent = "일감 없음"; container.appendChild(d); return; }
      for (const row of group.issues) container.appendChild(itemEl(row));
      if (group.total != null && group.loaded != null && group.loaded < group.total) {
        const more = document.createElement("div");
        more.className = "more";
        more.textContent = "더 보기 (" + group.loaded + "/" + group.total + ")";
        more.onclick = () => vscode.postMessage({ command: "moreGroup", key: group.key });
        container.appendChild(more);
      }
    }

    function groupEl(group) {
      const details = document.createElement("details");
      details.dataset.key = group.key;
      const wasOpen = openState.has(group.key) ? openState.get(group.key) : group.open;
      if (wasOpen) details.open = true;
      const summary = document.createElement("summary");
      summary.textContent = group.name;
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = group.issues ? String(group.issues.length) : "";
      summary.appendChild(badge);
      const items = document.createElement("div");
      fillItems(items, group);
      details.append(summary, items);
      let requested = !!group.issues;
      details.addEventListener("toggle", () => {
        openState.set(group.key, details.open);
        if (details.open && group.lazy && !requested) {
          requested = true;
          vscode.postMessage({ command: "expand", key: group.key });
        }
      });
      // lazy + 초기 open이면 즉시 로드
      if (details.open && group.lazy && !requested) {
        requested = true;
        vscode.postMessage({ command: "expand", key: group.key });
      }
      return details;
    }

    window.addEventListener("message", (e) => {
      const msg = e.data;
      if (msg.command === "toggleSearch") { toggleBar(); return; }
      if (msg.command === "error") {
        list.textContent = "";
        const d = document.createElement("div"); d.className = "dim top"; d.textContent = "오류: " + msg.message;
        list.appendChild(d);
        return;
      }
      if (msg.command === "group") {
        const details = list.querySelector('details[data-key="' + CSS.escape(msg.key) + '"]');
        if (!details) return;
        details.open = true;
        openState.set(msg.key, true);
        const badge = details.querySelector(".badge");
        if (badge && msg.issues) badge.textContent = String(msg.issues.length);
        fillItems(details.children[1], { key: msg.key, issues: msg.issues, loaded: msg.loaded, total: msg.total });
        return;
      }
      if (msg.command !== "data") return;
      selected.clear();
      postSelection();
      list.textContent = "";
      if (msg.needSetup) {
        const d = document.createElement("div");
        d.className = "setup"; d.textContent = "⚙ 설정 필요: URL/API Key — 클릭";
        d.onclick = () => vscode.postMessage({ command: "setup" });
        list.appendChild(d);
        return;
      }
      const flat = !!msg.rows;
      const empty = flat ? msg.rows.length === 0 : msg.groups.length === 0;
      if (empty) {
        const d = document.createElement("div"); d.className = "dim top";
        d.textContent = msg.emptyText || "일감 없음";
        list.appendChild(d);
        return;
      }
      if (flat) {
        for (const row of msg.rows) {
          const el = itemEl(row);
          el.style.paddingLeft = ".5em"; // 플랫 리스트 — 들여쓰기 제거
          list.appendChild(el);
        }
      } else {
        for (const group of msg.groups) list.appendChild(groupEl(group));
      }
      if (msg.total != null && msg.loaded != null && msg.loaded < msg.total) {
        const more = document.createElement("div");
        more.className = "more top";
        more.textContent = "더 보기 (" + msg.loaded + "/" + msg.total + ")";
        more.onclick = () => vscode.postMessage({ command: "more" });
        list.appendChild(more);
      }
    });
    vscode.postMessage({ command: "ready" });
  </script>
</body>
</html>`;
}
