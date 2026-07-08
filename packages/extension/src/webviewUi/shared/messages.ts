// 웹뷰 ↔ 확장 프로토콜. 타입만 — 양쪽 세계(Node/브라우저)가 import type로만 참조.
// NamedRef를 core에서 안 가져오는 이유: 웹뷰 tsconfig가 확장 의존성 해석에 엮이지 않게 격리.
export interface NamedRef {
  id: number;
  name: string;
}

// window.__INIT__ — 셸 HTML의 nonce 인라인 스크립트로 주입
export interface NewIssueInit {
  projects: NamedRef[];
  statuses: NamedRef[];
  priorities: NamedRef[];
  defaultProjectId?: number;
}

// 값은 전부 select/input.value 그대로의 문자열 — 숫자 변환은 확장 쪽 create()가 수행(기존 계약)
export interface NewIssueCreateMsg {
  command: "create";
  projectId: string;
  trackerId: string;
  statusId: string;
  priorityId: string;
  subject: string;
  description: string;
  assignedToId: string;
  categoryId: string;
  parentIssueId: string;
  startDate: string;
  dueDate: string;
  estimatedHours: string;
  doneRatio: string;
  isPrivate: boolean;
}

export type NewIssueToExtension =
  | { command: "loadProject"; projectId: number }
  | NewIssueCreateMsg
  | { command: "pickFiles" }
  | { command: "removeFile"; index: number }
  | { command: "pasteImage"; name: string; base64: string };

export type NewIssueToWebview =
  | { command: "projectData"; trackers: NamedRef[]; assignees: NamedRef[]; categories: NamedRef[] }
  | { command: "files"; names: string[] }
  | { command: "idle" };
