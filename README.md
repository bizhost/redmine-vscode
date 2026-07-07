# redmine-tools

Redmine 일감을 VS Code와 AI 양쪽에서 다루는 도구 모음.

## 팀원 설치 가이드

### 1. VS Code 확장

1. [Releases](https://github.com/bizhost/redmine-vscode/releases)에서 최신 `redmine-vscode-x.y.z.vsix` 다운로드
2. VS Code → Extensions 패널 → `⋯` 메뉴 → **Install from VSIX** (또는 `code --install-extension 파일.vsix`)
3. 설정(settings)에서:
   - `redmine.url` — Redmine 서버 URL
   - `redmine.downloadPath` — (선택) 일감 다운로드 기본 경로
4. 명령 팔레트(`Ctrl+Shift+P`) → `Redmine: Set API Key` → 본인 API key 입력
   - key 발급: Redmine → 내 계정 → 우측 "API 접근키"

### 2. MCP 서버 (Claude Code)

```bash
git clone git@github.com:bizhost/redmine-vscode.git redmine-tools
cd redmine-tools
npm install && npm run build
claude mcp add redmine \
  -e REDMINE_URL=https://your-redmine.example.com \
  -e REDMINE_API_KEY=<본인 API key> \
  -- node "$(pwd)/packages/mcp/dist/server.js"
```

새 Claude Code 세션에서 "내 일감 보여줘", "#1234 상세", "#1234를 ~/work에 내보내줘" 등 사용.

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

`REDMINE_PROJECT`는 선택 — 생략 시 전체 프로젝트에서 내 담당 이슈 조회.

툴: `list_issues`, `get_issue`, `update_issue_status`, `add_comment`, `list_statuses`

## VS Code 확장 실행

1. VS Code로 이 저장소 루트 열기
2. F5 (Run Redmine Extension) → Extension Development Host 실행
3. Host 창 settings에서 설정:
   - `redmine.url` — 서버 URL
   - `redmine.projectIdentifier` — 프로젝트 identifier (선택, 생략 시 전체 프로젝트)
   - `redmine.assignedToMe` — 내 담당만 (기본 true)
4. 명령 팔레트 → `Redmine: Set API Key` 로 키 입력 (SecretStorage 저장, 파일에 안 남음)
5. 활동바 Redmine 아이콘 → 일감 목록 → 클릭 시 상세

상세 패널에서 **상태 변경** / **댓글 작성** 버튼 사용. 첨부파일 클릭 → 브라우저로 열림(Redmine 로그인 세션 필요).

## 크레덴셜 취급

- API key는 코드/설정 파일/커밋에 넣지 않는다.
- MCP: 환경변수로만 주입. VS Code: SecretStorage.
