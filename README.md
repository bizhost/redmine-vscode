# redmine-vscode

Redmine 일감을 VS Code와 AI 양쪽에서 다루는 도구 모음 (VS Code 확장 + MCP 서버).

| 패키지 | 설명 |
|---|---|
| `packages/core` | RedmineClient — Redmine REST API 래퍼 (공유 코어) |
| `packages/mcp` | MCP 서버 — [`@bizhost/redmine-mcp`](https://www.npmjs.com/package/@bizhost/redmine-mcp) |
| `packages/extension` | VS Code 확장 — 사이드바 일감 목록/검색/상세/편집 |

## 설치

### 1. VS Code 확장

1. [Releases](https://github.com/bizhost/redmine-vscode/releases)에서 최신 `redmine-vscode-x.y.z.vsix` 다운로드
2. VS Code → Extensions 패널 → `⋯` 메뉴 → **Install from VSIX** (또는 `code --install-extension 파일.vsix`)
3. 설정(settings):
   - `redmine.url` — Redmine 서버 URL (필수)
   - `redmine.projectIdentifier` — (선택) '내 일감' 범위 한정
   - `redmine.downloadPath` — (선택) 일감 다운로드 기본 경로. 절대/`~`/상대(워크스페이스 기준)
4. 명령 팔레트(`Ctrl+Shift+P`) → `Redmine: Set API Key` → 본인 API key 입력
   - key 발급: Redmine → 내 계정 → 우측 "API 접근키"
   - key는 SecretStorage에 저장됨 (파일에 안 남음)

### 2. MCP 서버

npm으로 배포됨 — Node 20+만 있으면 됨 (clone/build 불필요). Windows/macOS/Linux 동일.

**Claude Code — 플러그인 (권장):**

```bash
# 쉘 프로필(~/.bashrc 등)에 환경변수 설정
export REDMINE_URL=https://your-redmine.example.com
export REDMINE_API_KEY=<본인 API key>

claude plugin marketplace add bizhost/redmine-vscode
claude plugin install redmine@bizhost
```

**Claude Code — 직접 등록:**

```bash
claude mcp add redmine \
  -e REDMINE_URL=https://your-redmine.example.com \
  -e REDMINE_API_KEY=<본인 API key> \
  -- npx -y @bizhost/redmine-mcp
```

**Claude Desktop — 확장 번들 (권장):**

1. [Releases](https://github.com/bizhost/redmine-vscode/releases)에서 `redmine.mcpb` 다운로드
2. 더블클릭 (또는 Claude Desktop → 설정 → 확장 프로그램 → 드래그)
3. 설정 화면 폼에 Redmine URL / API Key 입력 — JSON 편집 불필요

**Claude Desktop — 수동 설정:** `claude_desktop_config.json` (설정 → 개발자 → 구성 편집) 후 앱 완전 재시작:

```json
{
  "mcpServers": {
    "redmine": {
      "command": "npx",
      "args": ["-y", "@bizhost/redmine-mcp"],
      "env": {
        "REDMINE_URL": "https://your-redmine.example.com",
        "REDMINE_API_KEY": "<본인 API key>"
      }
    }
  }
}
```

`REDMINE_PROJECT`(선택) — 프로젝트 identifier로 기본 조회 범위 한정.

새 세션에서 "내 일감 보여줘", "#1234 상세", "#1234를 ~/work에 내보내줘" 등 사용.
툴: `list_issues` `get_issue` `update_issue_status` `add_comment` `export_issues` `list_statuses`

### 3. AI 에이전트로 설치 (복붙용 프롬프트)

Claude Code 등 AI 에이전트에 아래를 그대로 붙여넣으면 설치를 진행해준다:

```text
다음 순서로 Redmine 도구를 설치해줘.

1. VS Code 확장 설치:
   - https://github.com/bizhost/redmine-vscode/releases 에서 최신 .vsix 다운로드
   - code --install-extension <파일>.vsix 로 설치
2. MCP 등록 전에 나에게 물어봐:
   - Redmine 서버 URL
   - 내 Redmine API key (Redmine → 내 계정 → API 접근키. 채팅에 붙여넣지 말고
     claude mcp add 명령을 알려주면 내가 직접 터미널에서 실행할게)
3. 안내할 claude mcp add 명령 형식 (Node 20+ 필요):
   claude mcp add redmine -e REDMINE_URL=<url> -e REDMINE_API_KEY=<key> \
     -- npx -y @bizhost/redmine-mcp
4. 끝나면 VS Code 설정 방법 안내:
   - settings에서 redmine.url 입력
   - 명령 팔레트에서 "Redmine: Set API Key" 실행
```

## 개발

```bash
npm install
npm run build        # 전체 빌드
npm test             # core 단위테스트
npm run typecheck
```

- 확장 디버깅: 이 저장소를 VS Code로 열고 F5 (Extension Development Host)
- 확장 패키징: `cd packages/extension && npx @vscode/vsce package --no-dependencies`
- 배포:
  - MCP → `packages/mcp` 버전 bump 후 `npm publish`
  - 확장 → vsix를 GitHub Release에 첨부 (마켓플레이스 등록 시 `vsce publish`)

## 크레덴셜 취급

- API key는 코드/설정 파일/커밋에 넣지 않는다.
- MCP: 환경변수로만 주입. VS Code 확장: SecretStorage.
