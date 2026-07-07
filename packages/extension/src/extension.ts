import * as vscode from "vscode";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as os from "node:os";
import * as path from "node:path";
import {
  RedmineClient,
  buildIssueMarkdown,
  exportFileNames,
  type UpdateIssueChanges,
} from "@redmine-tools/core";

const execFileAsync = promisify(execFile);

// git log에서 이 파일 건드린 커밋들의 #번호 추출 (최근순, 중복 제거)
async function issueIdsForFile(fileUri: vscode.Uri): Promise<number[]> {
  const folder = vscode.workspace.getWorkspaceFolder(fileUri);
  if (!folder) throw new Error("워크스페이스 폴더 밖의 파일");
  const rel = path.relative(folder.uri.fsPath, fileUri.fsPath);
  const { stdout } = await execFileAsync(
    "git",
    ["log", "-n", "500", "--format=%s%n%b", "--", rel],
    { cwd: folder.uri.fsPath, maxBuffer: 10 * 1024 * 1024 },
  );
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const m of stdout.matchAll(/#(\d+)/g)) {
    const id = Number(m[1]);
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}
import { MyIssuesView } from "./myIssuesProvider";
import { ProjectsView } from "./projectsProvider";
import { IssueDetailPanel } from "./issueDetailPanel";
import { NewIssuePanel } from "./newIssuePanel";

const SECRET_KEY = "redmine.apiKey";

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

export function activate(context: vscode.ExtensionContext): void {
  const getClient = async (): Promise<RedmineClient | undefined> => {
    const config = vscode.workspace.getConfiguration("redmine");
    const url = config.get<string>("url", "");
    const projectIdentifier = config.get<string>("projectIdentifier", "");
    const apiKey = await context.secrets.get(SECRET_KEY);
    if (!url || !apiKey) return undefined;
    return new RedmineClient({ url, apiKey, projectIdentifier: projectIdentifier || undefined });
  };

  const requireClient = async (): Promise<RedmineClient> => {
    const client = await getClient();
    if (!client) {
      throw new Error("Redmine 설정 필요: settings에서 url 설정 후 'Redmine: Set API Key' 실행");
    }
    return client;
  };

  const myIssues = new MyIssuesView(getClient);
  const projects = new ProjectsView(getClient);
  const refreshAll = (): void => {
    myIssues.refresh();
    projects.refresh();
  };

  const openIssue = async (id: number): Promise<void> => {
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

    const [statuses, priorities, trackers, assignees, categories, previews, relatedSubjects] =
      await Promise.all([
        client.listStatuses(),
        client.listPriorities(),
        client.listTrackers(),
        projectId ? client.listAssignees(projectId) : Promise.resolve([]),
        projectId ? client.listCategories(projectId) : Promise.resolve([]),
        loadPreviews(client, issue.attachments ?? []),
        loadRelatedSubjects(),
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
      uploadFile: (filename, data) => client.uploadFile(filename, data),
      onUpdate: async (changes: UpdateIssueChanges) => {
        await client.updateIssue(id, changes);
        IssueDetailPanel.update(await client.getIssue(id));
        refreshAll();
      },
    });
  };

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("redmineMyIssues", myIssues),
    vscode.window.registerWebviewViewProvider("redmineProjects", projects),

    vscode.commands.registerCommand("redmine.refresh", refreshAll),
    vscode.commands.registerCommand("redmine.searchMyIssues", () => myIssues.toggleSearch()),
    vscode.commands.registerCommand("redmine.searchProjects", () => projects.toggleSearch()),

    vscode.commands.registerCommand("redmine.setApiKey", async () => {
      const value = await vscode.window.showInputBox({
        prompt: "Redmine API Key",
        password: true,
        ignoreFocusOut: true,
      });
      if (value) {
        await context.secrets.store(SECRET_KEY, value.trim());
        vscode.window.showInformationMessage("Redmine API Key 저장됨");
        refreshAll();
      }
    }),

    vscode.commands.registerCommand("redmine.openIssue", (id: number) =>
      openIssue(id).catch((err) =>
        vscode.window.showErrorMessage(`일감 열기 실패: ${err instanceof Error ? err.message : err}`),
      ),
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
      async (ctx?: { issueId?: number }) => {
        try {
          const clicked = Number(ctx?.issueId);
          if (!Number.isInteger(clicked)) return;
          // 클릭 항목이 포함된 pane의 다중 선택 사용, 아니면 단일
          const ids = myIssues.getSelection().includes(clicked)
            ? myIssues.getSelection()
            : projects.getSelection().includes(clicked)
              ? projects.getSelection()
              : [clicked];

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

    vscode.commands.registerCommand("redmine.issuesForFile", async (uri?: vscode.Uri) => {
      try {
        const target = uri ?? vscode.window.activeTextEditor?.document.uri;
        if (!target) return;
        const client = await requireClient();
        const ids = (await issueIdsForFile(target)).slice(0, 20); // 최근 20건만 조회
        if (ids.length === 0) {
          vscode.window.showInformationMessage("이 파일과 연결된 일감 없음 (커밋 메시지 #번호 기준)");
          return;
        }
        const issues = await Promise.all(
          ids.map((id) =>
            client
              .getIssue(id)
              .then((i) => ({ label: `#${i.id} ${i.subject}`, description: i.status?.name, id: i.id }))
              .catch(() => undefined), // 삭제됐거나 권한 없는 일감 → 제외
          ),
        );
        const items = issues.filter((i): i is NonNullable<typeof i> => !!i);
        if (items.length === 0) {
          vscode.window.showInformationMessage("연결된 일감을 조회할 수 없음");
          return;
        }
        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: `${path.basename(target.fsPath)} 관련 일감 ${items.length}건`,
        });
        if (picked) await openIssue(picked.id);
      } catch (err) {
        vscode.window.showErrorMessage(`관련 일감 조회 실패: ${err instanceof Error ? err.message : err}`);
      }
    }),
  );
}

export function deactivate(): void {}
