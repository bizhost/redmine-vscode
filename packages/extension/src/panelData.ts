import type { Issue, IssueStatus } from "@redmine-tools/core";

const DAY = 86_400_000;

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function mmdd(iso: string): string {
  const p = iso.split("-");
  return p.length === 3 ? `${p[1]}-${p[2]}` : iso;
}
export function relTime(iso?: string): string {
  if (!iso) return "";
  const m = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

// 상태명/닫힘여부 → 색 카테고리 (트리와 동일 규칙)
export function statusCat(status: { id: number; name: string }, closedIds: Set<number>): "new" | "prog" | "done" {
  if (closedIds.has(status.id)) return "done";
  return /신규|new/i.test(status.name) ? "new" : "prog";
}

interface DueInfo {
  text: string;
  cls: string;
}
export function dueInfo(due: string | undefined, t0: number): DueInfo {
  if (!due) return { text: "—", cls: "dim" };
  const d = new Date(`${due}T00:00:00`).getTime();
  if (d < t0) return { text: `${mmdd(due)} 지연`, cls: "late" };
  const days = Math.round((d - t0) / DAY);
  if (days <= 7) return { text: `${mmdd(due)} D-${days}`, cls: "late" };
  return { text: mmdd(due), cls: "" };
}

interface IssueCounts {
  new: number;
  prog: number;
  dueSoon: number;
  overdue: number;
}
export function countIssues(issues: Issue[]): IssueCounts {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const t0 = today.getTime();
  const in7 = t0 + 7 * DAY;
  const c: IssueCounts = { new: 0, prog: 0, dueSoon: 0, overdue: 0 };
  for (const i of issues) {
    if (/신규|new/i.test(i.status.name)) c.new++;
    else c.prog++;
    if (i.due_date) {
      const d = new Date(`${i.due_date}T00:00:00`).getTime();
      if (d < t0) c.overdue++;
      else if (d <= in7) c.dueSoon++;
    }
  }
  return c;
}

interface ServerOpts {
  limit: number;
  offset: number;
  assignedToMe?: boolean;
  assignedToId?: number;
  statusId?: string;
  projectId?: number;
  subjectQuery?: string;
  issueId?: number;
  dueBefore?: string;
}
interface ClientFilters {
  // 서버로 못 미는 잔여만: status: 이름 해석 실패 케이스
  statusName?: string;
}
export interface Filters {
  project: string;
  status: string;
  assignee: string;
  search: string;
  period: string;
  repo: number;
  branch: string;
  linkedOnly: boolean;
}

// 검색 구문 + 드롭다운 → 서버 옵션 + 클라이언트 잔여 필터. 좁은 서버 조회 위에 클라 필터 얹지 않도록 매핑.
export function buildOpts(f: Filters, offset: number, statuses: IssueStatus[]): { server: ServerOpts; client: ClientFilters } {
  const server: ServerOpts = { limit: 50, offset };
  const client: ClientFilters = {};
  let assignee = f.assignee;
  let statusName: string | undefined;
  const text: string[] = [];
  for (const tok of f.search.trim().split(/\s+/).filter(Boolean)) {
    if (/^#\d+$/.test(tok)) server.issueId = Number(tok.slice(1));
    else if (tok === "assignee:me") assignee = "me";
    else if (/^status:/.test(tok)) statusName = tok.slice(7);
    else if (/^due:<7d$/i.test(tok)) {
      // 서버측 마감 상한 = 오늘+7일. 좁은 페이지 위 클라 필터 대신 서버로 밀어 페이징 정상화.
      const d7 = new Date();
      d7.setHours(0, 0, 0, 0);
      d7.setDate(d7.getDate() + 7);
      server.dueBefore = ymd(d7);
    } else text.push(tok);
  }
  if (text.length) server.subjectQuery = text.join(" ");

  // 담당자
  if (assignee === "me") server.assignedToMe = true;
  else if (assignee === "all") {
    server.assignedToMe = false;
    server.projectId = 0; // 전 프로젝트
  } else {
    server.assignedToMe = false;
    server.assignedToId = Number(assignee); // 개별 담당자 → 서버측 필터
  }
  // 프로젝트 (드롭다운이 우선)
  if (f.project) server.projectId = Number(f.project);

  // 상태: 구문(status:) → 이름 해석, 아니면 드롭다운
  const named = statusName
    ? statuses.find((s) => s.name === statusName || s.name.includes(statusName))
    : undefined;
  if (statusName) {
    if (named) server.statusId = String(named.id);
    else client.statusName = statusName; // 이름 해석 실패 → 클라 필터
  } else if (f.status === "all") server.statusId = "*";
  else if (f.status && f.status !== "open") server.statusId = String(f.status);
  // 'open' → statusId 생략 (Redmine 기본 = 열림)

  return { server, client };
}

export function applyClient(issues: Issue[], c: ClientFilters): Issue[] {
  if (!c.statusName) return issues;
  return issues.filter((i) => i.status.name.includes(c.statusName!));
}
