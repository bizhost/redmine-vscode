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
  const calls = mockFetch(200, { issues: [{ id: 1, subject: "s", status: { id: 1, name: "New" } }] });
  const issues = await makeClient().listIssues();

  assert.equal(issues.length, 1);
  assert.equal(issues[0].id, 1);

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
  mockFetch(200, { issues: [] });
  assert.deepEqual(await makeClient().listIssues(), []);
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

test("listStatuses: 상태 목록 파싱", async () => {
  mockFetch(200, { issue_statuses: [{ id: 1, name: "New" }, { id: 5, name: "Closed", is_closed: true }] });
  const statuses = await makeClient().listStatuses();
  assert.equal(statuses.length, 2);
  assert.equal(statuses[1].name, "Closed");
});
