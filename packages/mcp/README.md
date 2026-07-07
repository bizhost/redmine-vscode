# @bizhost/redmine-mcp

Redmine MCP 서버 — Claude Code/Desktop 등 MCP 클라이언트에서 Redmine 일감을 다룬다.

## 툴

| 툴 | 기능 |
|---|---|
| `list_issues` | 일감 목록 (기본: 내 담당 open, 페이징) |
| `get_issue` | 상세: 내용/댓글/첨부/관계 |
| `update_issue_status` | 상태 변경 (이름 or id) |
| `add_comment` | 댓글 등록 |
| `export_issues` | `<dir>/<번호>/issue.md` + 첨부 다운로드 |
| `list_statuses` | 상태 목록 |

## 등록 (Claude Code)

```bash
claude mcp add redmine \
  -e REDMINE_URL=https://your-redmine.example.com \
  -e REDMINE_API_KEY=<your-api-key> \
  -- npx -y @bizhost/redmine-mcp
```

`REDMINE_PROJECT`(선택) — 프로젝트 identifier로 기본 범위 한정.

## 등록 (Claude Desktop)

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "redmine": {
      "command": "npx",
      "args": ["-y", "@bizhost/redmine-mcp"],
      "env": {
        "REDMINE_URL": "https://your-redmine.example.com",
        "REDMINE_API_KEY": "<your-api-key>"
      }
    }
  }
}
```

요구사항: Node 20+, Redmine REST API 활성화.
