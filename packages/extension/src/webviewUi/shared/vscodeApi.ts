// acquireVsCodeApi는 웹뷰 생애 1회만 호출 가능 — 싱글턴 확보 후 재export.
declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

const api = acquireVsCodeApi();

export function post<T>(msg: T): void {
  api.postMessage(msg);
}
