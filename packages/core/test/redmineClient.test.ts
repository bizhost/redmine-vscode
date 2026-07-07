import test from "node:test";
import assert from "node:assert/strict";
import { RedmineClient, RedmineApiError } from "../src/index.js";

interface Call {
  url: string;
  init: RequestInit | undefined;
}

// fetch mock: 호출 기록 + 고정 응답
function mockFetch(status: number, body?: unknown): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return calls;
}

function makeClient() {
  return new RedmineClient({
    url: "https://redmine.example.com",
    apiKey: "SECRET",
    projectIdentifier: "myproj",
  });
}

test("listIssues: 기본 쿼리 조립 (프로젝트+내담당+open+최신순)", async () => {
  const calls = mockFetch(200, {
    issues: [{ id: 1, subject: "s", status: { id: 1, name: "New" } }],
    total_count: 1,
  });
  const page = await makeClient().listIssues();

  assert.equal(page.issues.length, 1);
  assert.equal(page.issues[0].id, 1);
  assert.equal(page.totalCount, 1);

  const u = new URL(calls[0].url);
  assert.equal(u.pathname, "/issues.json");
  assert.equal(u.searchParams.get("project_id"), "myproj");
  assert.equal(u.searchParams.get("assigned_to_id"), "me");
  assert.equal(u.searchParams.get("status_id"), "open");
  assert.equal(u.searchParams.get("sort"), "updated_on:desc");
  assert.equal(u.searchParams.get("limit"), "50");

  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers["X-Redmine-API-Key"], "SECRET");
});

test("listIssues: 옵션 override (담당자 해제, 상태/limit 변경)", async () => {
  const calls = mockFetch(200, { issues: [] });
  await makeClient().listIssues({ assignedToMe: false, statusId: "*", limit: 10 });

  const u = new URL(calls[0].url);
  assert.equal(u.searchParams.get("assigned_to_id"), null);
  assert.equal(u.searchParams.get("status_id"), "*");
  assert.equal(u.searchParams.get("limit"), "10");
});

test("listIssues: projectIdentifier 없으면 project_id 생략 (전체 프로젝트)", async () => {
  const calls = mockFetch(200, { issues: [] });
  const client = new RedmineClient({ url: "https://redmine.example.com", apiKey: "k" });
  await client.listIssues();

  const u = new URL(calls[0].url);
  assert.equal(u.searchParams.get("project_id"), null);
  assert.equal(u.searchParams.get("assigned_to_id"), "me");
});

test("listIssues: 빈 목록 → []", async () => {
  mockFetch(200, { issues: [], total_count: 0 });
  const page = await makeClient().listIssues();
  assert.deepEqual(page.issues, []);
  assert.equal(page.totalCount, 0);
});

test("listIssues: offset 페이징", async () => {
  const calls = mockFetch(200, { issues: [], total_count: 123 });
  const page = await makeClient().listIssues({ offset: 50 });
  const u = new URL(calls[0].url);
  assert.equal(u.searchParams.get("offset"), "50");
  assert.equal(page.totalCount, 123);
});

test("getIssue: include=journals,attachments + 파싱", async () => {
  const calls = mockFetch(200, {
    issue: {
      id: 42,
      subject: "제목",
      description: "내용",
      status: { id: 2, name: "In Progress" },
      journals: [{ id: 7, user: { id: 1, name: "kim" }, notes: "댓글", created_on: "2026-07-01T00:00:00Z" }],
      attachments: [{ id: 9, filename: "a.png", filesize: 123, content_url: "https://redmine.example.com/attachments/download/9/a.png" }],
    },
  });
  const issue = await makeClient().getIssue(42);

  const u = new URL(calls[0].url);
  assert.equal(u.pathname, "/issues/42.json");
  assert.equal(u.searchParams.get("include"), "journals,attachments");

  assert.equal(issue.subject, "제목");
  assert.equal(issue.journals?.[0].notes, "댓글");
  assert.equal(issue.attachments?.[0].filename, "a.png");
});

test("updateIssue: PUT body 형태", async () => {
  const calls = mockFetch(204);
  await makeClient().updateIssue(5, { statusId: 3, notes: "메모" });

  assert.equal(calls[0].init?.method, "PUT");
  const u = new URL(calls[0].url);
  assert.equal(u.pathname, "/issues/5.json");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
    issue: { status_id: 3, notes: "메모" },
  });
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers["Content-Type"], "application/json");
});

test("updateIssue: 진행률/우선순위 포함", async () => {
  const calls = mockFetch(204);
  await makeClient().updateIssue(5, { doneRatio: 70, priorityId: 2 });

  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
    issue: { done_ratio: 70, priority_id: 2 },
  });
});

test("updateIssue: 전체 필드 매핑", async () => {
  const calls = mockFetch(204);
  await makeClient().updateIssue(5, {
    subject: "새 제목",
    description: "새 설명",
    trackerId: 2,
    assignedToId: 7,
    categoryId: 3,
    startDate: "2026-07-01",
    dueDate: "2026-07-31",
    estimatedHours: 4,
  });

  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
    issue: {
      subject: "새 제목",
      description: "새 설명",
      tracker_id: 2,
      assigned_to_id: 7,
      category_id: 3,
      start_date: "2026-07-01",
      due_date: "2026-07-31",
      estimated_hours: 4,
    },
  });
});

test("updateIssue: 비공개 댓글", async () => {
  const calls = mockFetch(204);
  await makeClient().updateIssue(5, { notes: "비밀", privateNotes: true });
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
    issue: { notes: "비밀", private_notes: true },
  });
});

test("listProjects: 프로젝트 목록", async () => {
  const calls = mockFetch(200, { projects: [{ id: 1, name: "P1", identifier: "p1" }] });
  const projects = await makeClient().listProjects();
  const u = new URL(calls[0].url);
  assert.equal(u.pathname, "/projects.json");
  assert.equal(projects[0].identifier, "p1");
});

test("listTrackers: 유형 목록", async () => {
  mockFetch(200, { trackers: [{ id: 1, name: "버그" }, { id: 4, name: "코드정리" }] });
  const trackers = await makeClient().listTrackers();
  assert.equal(trackers[1].name, "코드정리");
});

test("listAssignees: 멤버십에서 user만 추출", async () => {
  const calls = mockFetch(200, {
    memberships: [
      { id: 1, user: { id: 7, name: "김 영진" } },
      { id: 2, group: { id: 9, name: "팀" } },
      { id: 3, user: { id: 8, name: "이 몽룡" } },
    ],
  });
  const users = await makeClient().listAssignees(42);
  const u = new URL(calls[0].url);
  assert.equal(u.pathname, "/projects/42/memberships.json");
  assert.deepEqual(users.map((x) => x.name), ["김 영진", "이 몽룡"]);
});

test("listCategories: 프로젝트 범주", async () => {
  const calls = mockFetch(200, { issue_categories: [{ id: 1, name: "백엔드" }] });
  const cats = await makeClient().listCategories(42);
  const u = new URL(calls[0].url);
  assert.equal(u.pathname, "/projects/42/issue_categories.json");
  assert.equal(cats[0].name, "백엔드");
});

test("searchIssues: 검색 쿼리 + 결과", async () => {
  const calls = mockFetch(200, {
    results: [{ id: 100, title: "PHP 버전업", type: "issue", url: "..." }],
  });
  const results = await makeClient().searchIssues("PHP");
  const u = new URL(calls[0].url);
  assert.equal(u.pathname, "/search.json");
  assert.equal(u.searchParams.get("q"), "PHP");
  assert.equal(u.searchParams.get("issues"), "1");
  assert.deepEqual(results, [{ id: 100, title: "PHP 버전업" }]);
});

test("listIssues: projectId 숫자 override", async () => {
  const calls = mockFetch(200, { issues: [] });
  await makeClient().listIssues({ projectId: 42 });
  const u = new URL(calls[0].url);
  assert.equal(u.searchParams.get("project_id"), "42");
});

test("listPriorities: 우선순위 목록", async () => {
  const calls = mockFetch(200, { issue_priorities: [{ id: 1, name: "낮음" }, { id: 2, name: "보통" }] });
  const priorities = await makeClient().listPriorities();

  const u = new URL(calls[0].url);
  assert.equal(u.pathname, "/enumerations/issue_priorities.json");
  assert.equal(priorities[1].name, "보통");
});

test("401 → RedmineApiError(status=401)", async () => {
  mockFetch(401, { errors: ["Unauthorized"] });
  await assert.rejects(
    () => makeClient().listIssues(),
    (err: unknown) => err instanceof RedmineApiError && err.status === 401,
  );
});

test("base URL 뒤 슬래시/서브패스 유지", async () => {
  const calls = mockFetch(200, { issue_statuses: [] });
  const client = new RedmineClient({
    url: "https://host.example.com/redmine/",
    apiKey: "k",
    projectIdentifier: "p",
  });
  await client.listStatuses();
  assert.ok(calls[0].url.startsWith("https://host.example.com/redmine/issue_statuses.json"));
});

test("downloadAttachment: API key 헤더로 바이너리 수신", async () => {
  const bytes = new Uint8Array([137, 80, 78, 71]); // PNG magic
  const calls: Call[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(bytes, { status: 200 });
  }) as typeof fetch;

  const data = await makeClient().downloadAttachment("https://redmine.example.com/attachments/download/9/a.png");
  assert.deepEqual(new Uint8Array(data), bytes);
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers["X-Redmine-API-Key"], "SECRET");
});

test("downloadAttachment: 실패 → RedmineApiError", async () => {
  mockFetch(403);
  await assert.rejects(
    () => makeClient().downloadAttachment("https://redmine.example.com/attachments/download/9/a.png"),
    (err: unknown) => err instanceof RedmineApiError && err.status === 403,
  );
});

test("uploadFile: POST /uploads.json → token", async () => {
  const calls = mockFetch(201, { upload: { token: "7.abc123" } });
  const token = await makeClient().uploadFile("스크린샷.png", new Uint8Array([1, 2, 3]));

  assert.equal(token, "7.abc123");
  const u = new URL(calls[0].url);
  assert.equal(u.pathname, "/uploads.json");
  assert.equal(u.searchParams.get("filename"), "스크린샷.png");
  assert.equal(calls[0].init?.method, "POST");
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers["Content-Type"], "application/octet-stream");
  assert.equal(headers["X-Redmine-API-Key"], "SECRET");
});

test("updateIssue: uploads 첨부 매핑", async () => {
  const calls = mockFetch(204);
  await makeClient().updateIssue(5, {
    notes: "파일 첨부",
    uploads: [{ token: "7.abc", filename: "a.png", contentType: "image/png" }],
  });
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
    issue: {
      notes: "파일 첨부",
      uploads: [{ token: "7.abc", filename: "a.png", content_type: "image/png" }],
    },
  });
});

test("listStatuses: 상태 목록 파싱", async () => {
  mockFetch(200, { issue_statuses: [{ id: 1, name: "New" }, { id: 5, name: "Closed", is_closed: true }] });
  const statuses = await makeClient().listStatuses();
  assert.equal(statuses.length, 2);
  assert.equal(statuses[1].name, "Closed");
});
