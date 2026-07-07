import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { RedmineClient, type Issue } from "@redmine-tools/core";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`환경변수 ${name} 필요 (REDMINE_URL, REDMINE_API_KEY)`);
    process.exit(1);
  }
  return value;
}

const client = new RedmineClient({
  url: requireEnv("REDMINE_URL"),
  apiKey: requireEnv("REDMINE_API_KEY"),
  projectIdentifier: process.env.REDMINE_PROJECT, // 생략 시 전체 프로젝트
});

const server = new McpServer({ name: "redmine-mcp", version: "0.1.0" });

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

// 상세 응답 축약: AI가 쓰기 좋은 형태만
function issueSummary(issue: Issue) {
  return {
    id: issue.id,
    subject: issue.subject,
    status: issue.status?.name,
    assigned_to: issue.assigned_to?.name,
    updated_on: issue.updated_on,
  };
}

server.registerTool(
  "list_issues",
  {
    description:
      "Redmine 일감 목록 조회. 기본: 내게 할당된 open 이슈, 최신순. REDMINE_PROJECT 설정 시 해당 프로젝트로 한정.",
    inputSchema: {
      assignedToMe: z.boolean().optional().describe("false면 프로젝트 전체 이슈 (기본 true)"),
      statusId: z.string().optional().describe("open | closed | * | 상태 숫자 id (기본 open)"),
      limit: z.number().int().min(1).max(100).optional().describe("최대 개수 (기본 50)"),
    },
  },
  async (args) => {
    try {
      const issues = await client.listIssues(args);
      return ok(issues.map(issueSummary));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "get_issue",
  {
    description: "일감 상세 조회: 제목, 내용, 상태, 담당자, 첨부파일, 댓글 이력.",
    inputSchema: { id: z.number().int().describe("일감 번호") },
  },
  async ({ id }) => {
    try {
      const issue = await client.getIssue(id);
      return ok({
        ...issueSummary(issue),
        description: issue.description,
        author: issue.author?.name,
        priority: issue.priority?.name,
        created_on: issue.created_on,
        attachments: issue.attachments?.map((a) => ({
          filename: a.filename,
          filesize: a.filesize,
          url: a.content_url,
        })),
        comments: issue.journals
          ?.filter((j) => j.notes)
          .map((j) => ({ user: j.user?.name, notes: j.notes, created_on: j.created_on })),
      });
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "update_issue_status",
  {
    description: "일감 상태 변경. status는 상태 이름(예: 'In Progress') 또는 숫자 id.",
    inputSchema: {
      id: z.number().int().describe("일감 번호"),
      status: z.string().describe("상태 이름 또는 숫자 id"),
    },
  },
  async ({ id, status }) => {
    try {
      let statusId = Number(status);
      if (!Number.isInteger(statusId) || String(statusId) !== status.trim()) {
        const statuses = await client.listStatuses();
        const found = statuses.find((s) => s.name.toLowerCase() === status.trim().toLowerCase());
        if (!found) {
          return fail(
            new Error(
              `상태 '${status}' 없음. 사용 가능: ${statuses.map((s) => s.name).join(", ")}`,
            ),
          );
        }
        statusId = found.id;
      }
      await client.updateIssue(id, { statusId });
      return ok({ updated: id, statusId });
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "add_comment",
  {
    description: "일감에 댓글(notes) 등록.",
    inputSchema: {
      id: z.number().int().describe("일감 번호"),
      notes: z.string().min(1).describe("댓글 내용"),
    },
  },
  async ({ id, notes }) => {
    try {
      await client.updateIssue(id, { notes });
      return ok({ commented: id });
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "list_statuses",
  {
    description: "Redmine 이슈 상태 목록 조회.",
    inputSchema: {},
  },
  async () => {
    try {
      return ok(await client.listStatuses());
    } catch (err) {
      return fail(err);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
