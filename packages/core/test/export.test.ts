import test from "node:test";
import assert from "node:assert/strict";
import { buildIssueMarkdown, exportFileNames } from "../src/index.js";
import type { Issue } from "../src/index.js";

const issue: Issue = {
  id: 42,
  subject: "제목",
  description: "본문 내용",
  project: { id: 1, name: "쇼핑몰" },
  status: { id: 2, name: "진행" },
  assigned_to: { id: 7, name: "김 영진" },
  done_ratio: 30,
  attachments: [
    { id: 9, filename: "a.png", filesize: 100, content_url: "https://x/9/a.png" },
    { id: 10, filename: "a.png", filesize: 200, content_url: "https://x/10/a.png" },
  ],
  journals: [
    {
      id: 1,
      user: { id: 7, name: "김 영진" },
      notes: "댓글1",
      created_on: "2026-07-01",
      details: [{ property: "attachment", name: "10", new_value: "a.png" }],
    },
    { id: 2, user: { id: 8, name: "서 주화" }, notes: "", created_on: "2026-07-02" }, // 노트/첨부 없음 → 제외
  ],
};

test("exportFileNames: 중복 파일명 → id 접두어", () => {
  const names = exportFileNames(issue);
  assert.equal(names.get(9), "a.png");
  assert.equal(names.get(10), "10_a.png");
});

test("buildIssueMarkdown: 제목/메타/설명/첨부/댓글 포함", () => {
  const md = buildIssueMarkdown(issue);
  assert.ok(md.startsWith("# #42 제목"));
  assert.ok(md.includes("- 상태: 진행"));
  assert.ok(md.includes("- 진척도: 30%"));
  assert.ok(md.includes("본문 내용"));
  assert.ok(md.includes("[a.png](attachments/a.png)"));
  assert.ok(md.includes("[a.png](attachments/10_a.png)")); // 댓글 첨부 → 중복 회피 이름
  assert.ok(md.includes("## 댓글 (1)")); // 빈 저널 제외
  assert.ok(md.includes("### 김 영진 · 2026-07-01"));
});
