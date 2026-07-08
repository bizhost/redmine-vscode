import type { UpdateIssueChanges } from "@redmine-tools/core";

export function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export const RELATION_LABEL: Record<string, string> = {
  relates: "관련됨",
  duplicates: "중복함",
  duplicated: "중복됨",
  blocks: "차단함",
  blocked: "차단됨",
  precedes: "선행",
  follows: "후행",
  copied_to: "복사됨",
  copied_from: "복사본",
};

// journal detail attr name → 한글 라벨
export const DETAIL_LABEL: Record<string, string> = {
  status_id: "상태",
  priority_id: "우선순위",
  tracker_id: "유형",
  assigned_to_id: "담당자",
  category_id: "범주",
  done_ratio: "진척도",
  subject: "제목",
  description: "설명",
  start_date: "시작일",
  due_date: "예정일",
  estimated_hours: "추정시간",
  fixed_version_id: "대상 버전",
  parent_id: "상위 일감",
};

// 통합 제출: 웹뷰 field 키 → UpdateIssueChanges 매핑
const num = (v: unknown): number | "" => (v === "" || v == null ? "" : Number(v));
export function fieldsToChanges(fields: Record<string, unknown>): UpdateIssueChanges {
  const c: UpdateIssueChanges = {};
  if ("subject" in fields) c.subject = String(fields.subject ?? "");
  if ("description" in fields) c.description = String(fields.description ?? "");
  if ("status" in fields) c.statusId = Number(fields.status);
  if ("priority" in fields) c.priorityId = Number(fields.priority);
  if ("tracker" in fields) c.trackerId = Number(fields.tracker);
  if ("assignee" in fields) c.assignedToId = num(fields.assignee);
  if ("category" in fields) c.categoryId = num(fields.category);
  if ("done" in fields) c.doneRatio = Number(fields.done);
  if ("start" in fields) c.startDate = String(fields.start ?? "");
  if ("due" in fields) c.dueDate = String(fields.due ?? "");
  if ("estimated" in fields) c.estimatedHours = fields.estimated === "" ? "" : Number(fields.estimated);
  return c;
}
