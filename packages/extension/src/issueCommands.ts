import * as vscode from "vscode";
import * as os from "node:os";
import * as path from "node:path";
import {
  RedmineClient,
  buildIssueMarkdown,
  exportFileNames,
  type UpdateIssueChanges,
} from "@redmine-tools/core";
import { MyIssuesTree } from "./myIssuesTree";
import { ProjectsTree } from "./projectsTree";
import { PanelView } from "./panelView";
import { IssueDetailPanel } from "./issueDetailPanel";
import { NewIssuePanel } from "./newIssuePanel";

// 명령 핸들러가 activate 클로저에서 캡처하던 자유변수 모음 — 각 register 함수에 주입.
export interface CommandDeps {
  context: vscode.ExtensionContext;
  requireClient: () => Promise<RedmineClient>;
  refreshAll: () => void;
  updateConnectionContext: () => Promise<void>;
  openDetail: (id: number) => Promise<void>;
  panel: PanelView;
  myIssues: MyIssuesTree;
  projects: ProjectsTree;
}

// 트리 노드 컨텍스트 인자에서 issueId 추출 (menu/inline → 노드, 직접 호출 → {issueId})
export function nodeIssueId(ctx: unknown): number | undefined {
  const id = (ctx as { issueId?: unknown } | undefined)?.issueId;
  return typeof id === "number" && Number.isInteger(id) ? id : undefined;
}

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};
const PREVIEW_MAX_BYTES = 5 * 1024 * 1024;

// 이미지 첨부만 data URI로 — 실패/비이미지는 링크 폴백
async function loadPreviews(
  client: RedmineClient,
  attachments: { id: number; filename: string; filesize: number; content_url: string }[],
): Promise<Record<number, string>> {
  const previews: Record<number, string> = {};
  await Promise.all(
    attachments.map(async (a) => {
      const ext = a.filename.split(".").pop()?.toLowerCase() ?? "";
      const mime = IMAGE_MIME[ext];
      if (!mime || a.filesize > PREVIEW_MAX_BYTES) return;
      try {
        const data = await client.downloadAttachment(a.content_url);
        previews[a.id] = `data:${mime};base64,${Buffer.from(data).toString("base64")}`;
      } catch {
        // 미리보기 실패 → 링크만 표시
      }
    }),
  );
  return previews;
}

// 일감 상세 패널 오픈 헬퍼 — issue/git/treeSetup 세 모듈이 공유(deps.openDetail로 주입).
export function createOpenDetail(
  d: Pick<CommandDeps, "requireClient" | "refreshAll" | "panel">,
): (id: number) => Promise<void> {
  const { requireClient, refreshAll, panel } = d;
  return async (id: number): Promise<void> => {
    const client = await requireClient();
    const issue = await client.getIssue(id);
    const projectId = issue.project?.id;
    // 상위/연결 일감 제목 (relations엔 id만 옴)
    const relatedIds = new Set<number>();
    if (issue.parent) relatedIds.add(issue.parent.id);
    for (const r of issue.relations ?? []) {
      relatedIds.add(r.issue_id === issue.id ? r.issue_to_id : r.issue_id);
    }
    const loadRelatedSubjects = async (): Promise<Record<number, string>> => {
      const subjects: Record<number, string> = {};
      await Promise.all(
        [...relatedIds].slice(0, 20).map(async (rid) => {
          try {
            subjects[rid] = (await client.getIssue(rid)).subject;
          } catch {
            // 권한 없음/삭제 → 번호만 표시
          }
        }),
      );
      return subjects;
    };

    const [
      statuses,
      priorities,
      trackers,
      assignees,
      categories,
      previews,
      relatedSubjects,
      timeEntryActivities,
      currentUser,
    ] = await Promise.all([
      client.listStatuses(),
      client.listPriorities(),
      client.listTrackers(),
      projectId ? client.listAssignees(projectId) : Promise.resolve([]),
      projectId ? client.listCategories(projectId) : Promise.resolve([]),
      loadPreviews(client, issue.attachments ?? []),
      loadRelatedSubjects(),
      client.listTimeEntryActivities().catch(() => []),
      client.getCurrentUser().catch(() => undefined),
    ]);
    IssueDetailPanel.show({
      issue,
      statuses,
      priorities,
      trackers,
      assignees,
      categories,
      previews,
      relatedSubjects,
      timeEntryActivities,
      currentUser,
      addWatcher: (userId) => client.addWatcher(id, userId),
      removeWatcher: (userId) => client.removeWatcher(id, userId),
      uploadFile: (filename, data) => client.uploadFile(filename, data),
      onUpdate: async (changes: UpdateIssueChanges) => {
        await client.updateIssue(id, changes);
        IssueDetailPanel.update(await client.getIssue(id));
        refreshAll();
      },
      logTime: async (hours, activityId, comments) => {
        const now = new Date();
        const spentOn = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
        // time_entry.comments는 길이 제한(≤255) — 첫 줄 요약만
        const summary = comments.split("\n")[0].trim().slice(0, 255);
        await client.createTimeEntry({ issueId: id, hours, activityId, comments: summary || undefined, spentOn });
        panel.refresh();
      },
    });
  };
}

export function registerIssueCommands(d: CommandDeps): vscode.Disposable[] {
  const { context, requireClient, refreshAll, openDetail: openIssue } = d;

  // 상태 변경 QuickPick → updateIssue. reopenOnly면 열린 상태만 후보
  const changeStatus = async (node: unknown, reopenOnly = false): Promise<void> => {
    const id = nodeIssueId(node);
    if (id === undefined) return;
    const client = await requireClient();
    const statuses = await client.listStatuses();
    const choices = reopenOnly ? statuses.filter((s) => !s.is_closed) : statuses;
    const picked = await vscode.window.showQuickPick(
      choices.map((s) => ({ label: s.name, id: s.id })),
      { placeHolder: reopenOnly ? "재오픈할 상태 선택" : `#${id} 상태 변경` },
    );
    if (!picked) return;
    await client.updateIssue(id, { statusId: picked.id });
    IssueDetailPanel.update(await client.getIssue(id)); // 열려있으면 반영
    refreshAll();
  };

  return [
    // SCM 커밋 입력창에 내 일감 #번호 삽입 (래퍼런스앱 Associate Issue 대응)
    vscode.commands.registerCommand("redmine.insertIssueRef", async () => {
      try {
        const ext = vscode.extensions.getExtension("vscode.git");
        if (!ext) {
          vscode.window.showErrorMessage("Git 확장을 찾을 수 없음");
          return;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const api = (await ext.activate()).getAPI(1) as any;
        const repos = api.repositories as Array<{ inputBox: { value: string }; rootUri: vscode.Uri }>;
        if (!repos.length) {
          vscode.window.showErrorMessage("열린 git 저장소 없음");
          return;
        }
        const client = await requireClient();
        const page = await client.listIssues({ assignedToMe: true, limit: 50 });
        if (page.issues.length === 0) {
          vscode.window.showInformationMessage("삽입할 내 일감 없음");
          return;
        }
        const picked = await vscode.window.showQuickPick(
          page.issues.map((i) => ({ label: `#${i.id} ${i.subject}`, description: i.status?.name, id: i.id })),
          { placeHolder: "커밋 메시지에 삽입할 일감" },
        );
        if (!picked) return;
        let repo = repos[0];
        if (repos.length > 1) {
          const rp = await vscode.window.showQuickPick(
            repos.map((r, idx) => ({ label: r.rootUri.fsPath, idx })),
            { placeHolder: "대상 저장소" },
          );
          if (!rp) return;
          repo = repos[rp.idx];
        }
        const cur = repo.inputBox.value;
        repo.inputBox.value = (cur ? `${cur.replace(/\s*$/, "")} ` : "") + `#${picked.id} `;
      } catch (err) {
        vscode.window.showErrorMessage(`일감 연결 실패: ${err instanceof Error ? err.message : err}`);
      }
    }),

    vscode.commands.registerCommand("redmine.openIssueByNumber", async () => {
      const value = await vscode.window.showInputBox({
        prompt: "열 일감 번호",
        ignoreFocusOut: true,
        validateInput: (v) => (/^#?\d+$/.test(v.trim()) ? null : "숫자 또는 #숫자"),
      });
      const id = Number(value?.trim().replace(/^#/, ""));
      if (Number.isInteger(id)) await openIssue(id);
    }),

    vscode.commands.registerCommand("redmine.changeStatus", (node?: unknown) =>
      changeStatus(node).catch((err) =>
        vscode.window.showErrorMessage(`상태 변경 실패: ${err instanceof Error ? err.message : err}`),
      ),
    ),
    vscode.commands.registerCommand("redmine.reopenIssue", (node?: unknown) =>
      changeStatus(node, true).catch((err) =>
        vscode.window.showErrorMessage(`재오픈 실패: ${err instanceof Error ? err.message : err}`),
      ),
    ),
    vscode.commands.registerCommand("redmine.copyIssueLink", async (node?: unknown) => {
      const id = nodeIssueId(node);
      if (id === undefined) return;
      const url = vscode.workspace.getConfiguration("redmine").get<string>("url", "").trim();
      if (!url) {
        vscode.window.showErrorMessage("Redmine URL 미설정: settings에서 redmine.url 설정");
        return;
      }
      await vscode.env.clipboard.writeText(`${url.replace(/\/+$/, "")}/issues/${id}`);
      vscode.window.showInformationMessage(`링크 복사됨: #${id}`);
    }),

    vscode.commands.registerCommand("redmine.openIssue", (id: number) =>
      openIssue(id).catch((err) =>
        vscode.window.showErrorMessage(`일감 열기 실패: ${err instanceof Error ? err.message : err}`),
      ),
    ),

    vscode.commands.registerCommand(
      "redmine.openIssueInBrowser",
      (ctx?: { issueId?: number }) => {
        const id = Number(ctx?.issueId);
        if (!Number.isInteger(id)) return;
        const url = vscode.workspace.getConfiguration("redmine").get<string>("url", "").trim();
        if (!url) {
          vscode.window.showErrorMessage("Redmine URL 미설정: settings에서 redmine.url 설정");
          return;
        }
        void vscode.env.openExternal(vscode.Uri.parse(`${url.replace(/\/+$/, "")}/issues/${id}`));
      },
    ),

    vscode.commands.registerCommand("redmine.newIssue", async () => {
      try {
        const client = await requireClient();
        const [projects, statuses, priorities] = await Promise.all([
          client.listProjects(),
          client.listStatuses(),
          client.listPriorities(),
        ]);
        if (projects.length === 0) {
          vscode.window.showWarningMessage("일감을 만들 수 있는 프로젝트 없음");
          return;
        }
        NewIssuePanel.show({
          extensionUri: context.extensionUri,
          projects,
          statuses,
          priorities,
          defaultProjectId: projects[0].id,
          loadProjectData: async (projectId) => {
            const [trackers, assignees, categories] = await Promise.all([
              client.listProjectTrackers(projectId),
              client.listAssignees(projectId),
              client.listCategories(projectId),
            ]);
            return { trackers, assignees, categories };
          },
          uploadFile: (filename, data) => client.uploadFile(filename, data),
          onCreate: async (fields) => {
            const created = await client.createIssue(fields);
            refreshAll();
            return created;
          },
        });
      } catch (err) {
        vscode.window.showErrorMessage(`새 일감 실패: ${err instanceof Error ? err.message : err}`);
      }
    }),

    vscode.commands.registerCommand(
      "redmine.downloadIssues",
      async (node?: unknown, selected?: unknown[]) => {
        try {
          const clicked = nodeIssueId(node);
          if (clicked === undefined) return;
          // 클릭한 트리의 다중 선택만 사용 (VS Code가 2번째 인자로 전달) — 반대편 트리 무시
          const picked = Array.isArray(selected)
            ? selected.map(nodeIssueId).filter((v): v is number => v !== undefined)
            : [];
          const ids = picked.length ? [...new Set([clicked, ...picked])] : [clicked];

          // 설정된 기본 경로 있으면 바로 사용, 없으면 매번 선택
          const configured = vscode.workspace
            .getConfiguration("redmine")
            .get<string>("downloadPath", "")
            .trim();
          const expanded = configured.replace(/^~(?=$|\/)/, os.homedir());
          const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          // 상대경로 → 워크스페이스 루트 기준. 워크스페이스 없으면 위치 선택으로 폴백
          const resolved = !expanded
            ? undefined
            : path.isAbsolute(expanded)
              ? expanded
              : workspaceRoot
                ? path.join(workspaceRoot, expanded)
                : undefined;
          let base: vscode.Uri;
          if (resolved) {
            base = vscode.Uri.file(resolved);
            await vscode.workspace.fs.createDirectory(base); // 없으면 생성
          } else {
            const picked = await vscode.window.showOpenDialog({
              canSelectFolders: true,
              canSelectFiles: false,
              canSelectMany: false,
              openLabel: "여기에 다운로드",
            });
            if (!picked) return;
            base = picked[0];
          }
          const client = await requireClient();

          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `Redmine 일감 다운로드 (${ids.length}건)`,
            },
            async (progress) => {
              for (const id of ids) {
                progress.report({ message: `#${id}` });
                const issue = await client.getIssue(id);
                const names = exportFileNames(issue);
                const dir = vscode.Uri.joinPath(base, String(id));
                await vscode.workspace.fs.createDirectory(dir);
                await vscode.workspace.fs.writeFile(
                  vscode.Uri.joinPath(dir, "issue.md"),
                  Buffer.from(buildIssueMarkdown(issue, names), "utf8"),
                );
                if (issue.attachments?.length) {
                  const attDir = vscode.Uri.joinPath(dir, "attachments");
                  await vscode.workspace.fs.createDirectory(attDir);
                  for (const a of issue.attachments) {
                    const data = await client.downloadAttachment(a.content_url);
                    await vscode.workspace.fs.writeFile(
                      vscode.Uri.joinPath(attDir, names.get(a.id) ?? a.filename),
                      new Uint8Array(data),
                    );
                  }
                }
              }
            },
          );
          vscode.window.showInformationMessage(
            `다운로드 완료: ${ids.map((i) => `#${i}`).join(", ")} → ${base.fsPath}`,
          );
        } catch (err) {
          vscode.window.showErrorMessage(`다운로드 실패: ${err instanceof Error ? err.message : err}`);
        }
      },
    ),
  ];
}
