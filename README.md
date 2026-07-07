# redmine-tools

Redmine 일감을 VS Code와 AI 양쪽에서 다루는 도구 모음.

| 패키지 | 설명 |
|---|---|
| `packages/core` | RedmineClient — Redmine REST API 래퍼 (공유 코어) |
| `packages/mcp` | MCP 서버 — Claude Code 등에서 일감 조회/상태변경/댓글 |
| `packages/extension` | VS Code 확장 — 사이드바 일감 목록 + 상세 패널 |

## 빌드

```bash
npm install
npm run build        # 전체 빌드
npm test             # core 단위테스트
```

## MCP 서버 등록 (Claude Code)

```bash
npm run build -w packages/core -w packages/mcp
claude mcp add redmine \
  -e REDMINE_URL=https://your-redmine.example.com \
  -e REDMINE_API_KEY=<your-api-key> \
  -e REDMINE_PROJECT=<project-identifier> \
  -- node /home/konat/project/redmine/packages/mcp/dist/server.js
```

툴: `list_issues`, `get_issue`, `update_issue_status`, `add_comment`, `list_statuses`

## VS Code 확장 실행

1. VS Code로 이 저장소 루트 열기
2. F5 (Run Redmine Extension) → Extension Development Host 실행
3. Host 창 settings에서 설정:
   - `redmine.url` — 서버 URL
   - `redmine.projectIdentifier` — 프로젝트 identifier
   - `redmine.assignedToMe` — 내 담당만 (기본 true)
4. 명령 팔레트 → `Redmine: Set API Key` 로 키 입력 (SecretStorage 저장, 파일에 안 남음)
5. 활동바 Redmine 아이콘 → 일감 목록 → 클릭 시 상세

상세 패널에서 **상태 변경** / **댓글 작성** 버튼 사용. 첨부파일 클릭 → 브라우저로 열림(Redmine 로그인 세션 필요).

## 크레덴셜 취급

- API key는 코드/설정 파일/커밋에 넣지 않는다.
- MCP: 환경변수로만 주입. VS Code: SecretStorage.
