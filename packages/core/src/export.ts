import type { Issue } from "./types.js";

/** 첨부 저장 파일명 — 중복 시 첨부 id 접두어 */
export function exportFileNames(issue: Issue): Map<number, string> {
  const used = new Set<string>();
  const map = new Map<number, string>();
  for (const a of issue.attachments ?? []) {
    const name = used.has(a.filename) ? `${a.id}_${a.filename}` : a.filename;
    used.add(name);
    map.set(a.id, name);
  }
  return map;
}

/** 일감 → issue.md 내용. 첨부 링크는 attachments/ 상대경로 */
export function buildIssueMarkdown(issue: Issue, fileNames?: Map<number, string>): string {
  const names = fileNames ?? exportFileNames(issue);
  const lines: string[] = [`# #${issue.id} ${issue.subject}`, ""];

  const meta: Array<[string, string | undefined]> = [
    ["프로젝트", issue.project?.name],
    ["유형", issue.tracker?.name],
    ["상태", issue.status?.name],
    ["우선순위", issue.priority?.name],
    ["담당자", issue.assigned_to?.name],
    ["작성자", issue.author?.name],
    ["시작일", issue.start_date],
    ["예정일", issue.due_date],
    ["진척도", issue.done_ratio != null ? `${issue.done_ratio}%` : undefined],
    ["추정시간", issue.estimated_hours != null ? `${issue.estimated_hours}h` : undefined],
    ["작성일", issue.created_on],
    ["수정일", issue.updated_on],
  ];
  for (const [key, value] of meta) if (value) lines.push(`- ${key}: ${value}`);

  lines.push("", "## 설명", "", issue.description || "(없음)", "");

  if (issue.attachments?.length) {
    lines.push("## 첨부파일", "");
    for (const a of issue.attachments) {
      lines.push(`- [${a.filename}](attachments/${names.get(a.id)}) (${a.filesize} bytes)`);
    }
    lines.push("");
  }

  const journals = (issue.journals ?? []).filter(
    (j) => j.notes || j.details?.some((d) => d.property === "attachment"),
  );
  if (journals.length) {
    lines.push(`## 댓글 (${journals.length})`, "");
    for (const j of journals) {
      lines.push(`### ${j.user?.name ?? "?"} · ${j.created_on}`, "");
      if (j.notes) lines.push(j.notes, "");
      const atts = (j.details ?? []).filter((d) => d.property === "attachment");
      for (const d of atts) {
        const saved = names.get(Number(d.name));
        if (saved) lines.push(`- 첨부: [${d.new_value ?? saved}](attachments/${saved})`);
      }
      if (atts.length) lines.push("");
    }
  }
  return lines.join("\n");
}
