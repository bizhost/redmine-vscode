import type { NamedRef } from "@redmine-tools/core";

// 확장(Node) 측 웹뷰 HTML 빌더 공용 헬퍼. 웹뷰(브라우저) 스크립트 문자열 내부의 esc는 import 불가 — 각 클라이언트 JS에 별도 존재.
export function esc(text: string | undefined | null): string {
  return (text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function options(items: NamedRef[], selectedId?: number, emptyLabel?: string): string {
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

// 패널 간 byte-identical 검증된 규칙만. 근사 중복(.chip/.badge/button 베이스 등)은 패널별로 다름 → 로컬 유지, 병합 금지(시각 회귀).
export const sharedCss = `  input, select, textarea {
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 3px; padding: .35em;
    font-family: var(--vscode-font-family); box-sizing: border-box;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.busy { opacity: .7; pointer-events: none; }
  button.busy::after {
    content: ""; display: inline-block; width: .8em; height: .8em; margin-left: .5em;
    border: 2px solid currentColor; border-top-color: transparent; border-radius: 50%;
    animation: spin .8s linear infinite; vertical-align: -.1em;
  }
  @keyframes spin { to { transform: rotate(360deg); } }`;
