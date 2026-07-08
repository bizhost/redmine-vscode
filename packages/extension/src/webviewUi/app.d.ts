import type { NewIssueInit } from "./shared/messages";

// 웹뷰 전용 앰비언트 — 확장(tsc) 프로그램에는 로드되지 않음(tsconfig exclude)
declare global {
  interface Window {
    __INIT__: NewIssueInit;
  }
}

export {};
