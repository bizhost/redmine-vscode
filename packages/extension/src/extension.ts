import * as vscode from "vscode";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import { RedmineClient, type UpdateIssueChanges } from "@redmine-tools/core";

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
import { MyIssuesProvider } from "./myIssuesProvider";
import { ProjectsProvider } from "./projectsProvider";
import { IssueDetailPanel } from "./issueDetailPanel";
import { NewIssuePanel } from "./newIssuePanel";
import { SearchInputView } from "./searchInputView";

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

  const myIssues = new MyIssuesProvider(getClient);
  const projects = new ProjectsProvider(getClient);
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

  // pane 내부 검색 — InputBox, 비우면 해제
  const promptFilter = async (
    provider: MyIssuesProvider | ProjectsProvider,
    placeHolder: string,
  ): Promise<void> => {
    const value = await vscode.window.showInputBox({
      prompt: "제목 검색 또는 #일감번호 (비우면 검색 해제)",
      placeHolder,
      value: provider.getFilter() ?? "",
      ignoreFocusOut: true,
    });
    if (value === undefined) return; // ESC → 유지
    provider.setFilter(value);
  };

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("redmineMyIssues", myIssues),
    vscode.window.registerTreeDataProvider("redmineProjects", projects),
    vscode.window.registerWebviewViewProvider(
      SearchInputView.viewId,
      new SearchInputView((query) => {
        myIssues.setFilter(query); // 내 담당 범위
        projects.setFilter(query); // 전체 범위
      }),
    ),

    vscode.commands.registerCommand("redmine.refresh", refreshAll),
    vscode.commands.registerCommand("redmine.loadMoreMy", () => myIssues.loadMore()),
    vscode.commands.registerCommand("redmine.loadMoreProject", (projectId: number) =>
      projects.loadMore(projectId),
    ),
    vscode.commands.registerCommand("redmine.loadMoreProjectsSearch", () =>
      projects.loadMoreSearch(),
    ),
    vscode.commands.registerCommand("redmine.searchMyIssues", () =>
      promptFilter(myIssues, "내 일감에서 검색"),
    ),
    vscode.commands.registerCommand("redmine.searchProjects", () =>
      promptFilter(projects, "전체 프로젝트에서 검색"),
    ),

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
