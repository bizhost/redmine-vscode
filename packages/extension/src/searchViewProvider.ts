import * as vscode from "vscode";
import type { RedmineClient } from "@redmine-tools/core";

export class SearchViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = "redmineSearch";

  constructor(
    private readonly getClient: () => Promise<RedmineClient | undefined>,
    private readonly openIssue: (id: number) => Promise<void>,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html();

    view.webview.onDidReceiveMessage(async (msg: { command: string; query?: string; id?: number }) => {
      if (msg.command === "search") {
        const query = (msg.query ?? "").trim();
        if (!query) {
          void view.webview.postMessage({ command: "results", items: [] });
          return;
        }
        try {
          const client = await this.getClient();
          if (!client) {
            void view.webview.postMessage({ command: "error", message: "설정 필요: URL/API Key" });
            return;
          }
          const results = await client.searchIssues(query);
          void view.webview.postMessage({ command: "results", items: results });
        } catch (err) {
          void view.webview.postMessage({
            command: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      } else if (msg.command === "open" && typeof msg.id === "number") {
        void this.openIssue(msg.id).catch((err) =>
          vscode.window.showErrorMessage(`일감 열기 실패: ${err instanceof Error ? err.message : err}`),
        );
      }
    });
  }

  private html(): string {
    return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: .4em; margin: 0; }
  #q {
    width: 100%; box-sizing: border-box; padding: .4em;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 3px;
  }
  #q:focus { outline: 1px solid var(--vscode-focusBorder); }
  .row { padding: .35em .3em; cursor: pointer; border-radius: 3px; font-size: .95em;
         white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row:hover { background: var(--vscode-list-hoverBackground); }
  .dim { color: var(--vscode-descriptionForeground); font-size: .85em; padding: .5em .3em; }
</style>
</head>
<body>
  <input id="q" type="text" placeholder="일감 검색 (제목/내용/댓글)">
  <div id="list"><div class="dim">검색어를 입력하세요</div></div>
  <script>
    const vscode = acquireVsCodeApi();
    const q = document.getElementById("q");
    const list = document.getElementById("list");
    let timer;
    q.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => vscode.postMessage({ command: "search", query: q.value }), 300);
    });
    window.addEventListener("message", (e) => {
      const msg = e.data;
      list.textContent = "";
      if (msg.command === "error") {
        const d = document.createElement("div");
        d.className = "dim"; d.textContent = msg.message;
        list.appendChild(d);
        return;
      }
      if (msg.command === "results") {
        if (msg.items.length === 0) {
          const d = document.createElement("div");
          d.className = "dim";
          d.textContent = q.value.trim() ? "결과 없음" : "검색어를 입력하세요";
          list.appendChild(d);
          return;
        }
        for (const item of msg.items) {
          const row = document.createElement("div");
          row.className = "row";
          row.textContent = item.title;
          row.title = item.title;
          row.onclick = () => vscode.postMessage({ command: "open", id: item.id });
          list.appendChild(row);
        }
      }
    });
  </script>
</body>
</html>`;
  }
}
