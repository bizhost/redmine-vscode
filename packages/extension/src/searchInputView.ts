import * as vscode from "vscode";

/** 사이드바 상단 검색 입력 — 타이핑하면 아래 트리 pane들이 필터됨 */
export class SearchInputView implements vscode.WebviewViewProvider {
  static readonly viewId = "redmineSearch";

  constructor(private readonly onQuery: (query: string) => void) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = { enableScripts: true };
    view.webview.html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<style>
  body { padding: .3em .4em; margin: 0; }
  .box { display: flex; align-items: center; gap: .3em;
    background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 3px; padding: 0 .3em; }
  .box:focus-within { outline: 1px solid var(--vscode-focusBorder); }
  #q { flex: 1; border: none; outline: none; background: transparent;
    color: var(--vscode-input-foreground); padding: .4em .2em; font-family: var(--vscode-font-family); }
  #clear { cursor: pointer; color: var(--vscode-descriptionForeground); user-select: none;
    padding: 0 .2em; visibility: hidden; }
  #clear:hover { color: var(--vscode-foreground); }
  .hint { color: var(--vscode-descriptionForeground); font-size: .8em; margin: .35em .2em 0; }
</style>
</head>
<body>
  <div class="box">
    <input id="q" type="text" placeholder="일감 검색 (제목 또는 #번호)">
    <span id="clear" title="지우기">✕</span>
  </div>
  <div class="hint">내 일감 / 프로젝트 pane에 각각 결과 표시</div>
  <script>
    const vscode = acquireVsCodeApi();
    const q = document.getElementById("q");
    const clearBtn = document.getElementById("clear");
    let timer;
    function send() {
      clearBtn.style.visibility = q.value ? "visible" : "hidden";
      vscode.postMessage({ command: "query", query: q.value });
    }
    q.addEventListener("input", () => {
      clearTimeout(timer);
      clearBtn.style.visibility = q.value ? "visible" : "hidden";
      timer = setTimeout(send, 300);
    });
    q.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { clearTimeout(timer); send(); }
      if (e.key === "Escape") { q.value = ""; clearTimeout(timer); send(); }
    });
    clearBtn.addEventListener("click", () => { q.value = ""; send(); q.focus(); });
  </script>
</body>
</html>`;
    view.webview.onDidReceiveMessage((msg: { command: string; query?: string }) => {
      if (msg.command === "query") this.onQuery((msg.query ?? "").trim());
    });
  }
}
