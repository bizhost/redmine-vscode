import * as vscode from "vscode";
import { RedmineClient } from "@redmine-tools/core";
import { gitShow } from "./gitIssues";
import { MyIssuesTree } from "./myIssuesTree";
import { ProjectsTree } from "./projectsTree";
import { PanelView } from "./panelView";
import { setContext, resetAuthLatch, SECRET_KEY, type RedmineNode } from "./treeSupport";
import { createOpenDetail, registerIssueCommands, type CommandDeps } from "./issueCommands";
import { registerGitCommands } from "./gitCommands";
import { registerTreeSetupCommands } from "./treeSetupCommands";

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

  const myIssues = new MyIssuesTree(getClient);
  const projects = new ProjectsTree(getClient);
  const panel = new PanelView(getClient);
  let panelRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  const refreshAll = (): void => {
    myIssues.refresh();
    projects.refresh();
    panel.refresh();
  };

  // 연결/인증 컨텍스트 키 갱신. authenticated는 키 존재 시 낙관적 true → 401이면 트리가 false로 래칭
  const updateConnectionContext = async (): Promise<void> => {
    const url = vscode.workspace.getConfiguration("redmine").get<string>("url", "").trim();
    const apiKey = await context.secrets.get(SECRET_KEY);
    resetAuthLatch(); // URL/키 변경 → 이전 401 래칭 해제
    setContext("redmine:connected", !!url);
    setContext("redmine:authenticated", !!url && !!apiKey);
  };
  void updateConnectionContext();

  const openDetail = createOpenDetail({ requireClient, refreshAll, panel });

  const myView = vscode.window.createTreeView<RedmineNode>("redmineMyIssues", {
    treeDataProvider: myIssues,
    canSelectMany: true,
  });
  myIssues.bindView(myView);
  const projectsView = vscode.window.createTreeView<RedmineNode>("redmineProjects", {
    treeDataProvider: projects,
    canSelectMany: true,
  });
  projects.bindView(projectsView);

  const deps: CommandDeps = {
    context,
    requireClient,
    refreshAll,
    updateConnectionContext,
    openDetail,
    panel,
    myIssues,
    projects,
  };

  context.subscriptions.push(
    myView,
    projectsView,
    vscode.window.registerWebviewViewProvider(PanelView.viewId, panel, {
      webviewOptions: { retainContextWhenHidden: true },
    }),

    // git show 기반 diff — 커밋 파일의 before/after 콘텐츠 프로바이더
    vscode.workspace.registerTextDocumentContentProvider("redmine-gitshow", {
      provideTextDocumentContent: (uri) => {
        const { repo, ref } = JSON.parse(uri.query) as { repo: string; ref: string };
        return gitShow(repo, ref, uri.path.replace(/^\//, ""));
      },
    }),

    // 활성 파일 변경 → 패널 '현재 작업' 갱신 (패널 보일 때만, 400ms 디바운스)
    vscode.window.onDidChangeActiveTextEditor(() => {
      if (!panel.isVisible()) return;
      if (panelRefreshTimer) clearTimeout(panelRefreshTimer);
      panelRefreshTimer = setTimeout(() => panel.refresh(), 400);
    }),

    // groupBy/url 설정 변경 → 컨텍스트 키·트리·패널 갱신
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("redmine.url")) {
        void updateConnectionContext();
        panel.resetUsers(); // 서버 변경 → 누적 사용자/메타 초기화
        refreshAll();
      }
      if (e.affectsConfiguration("redmine.views.myIssues.groupBy")) myIssues.rerender();
      if (e.affectsConfiguration("redmine.sidebar.showTodayTime")) myIssues.rerender();
      if (e.affectsConfiguration("redmine.panel.showBadge")) panel.refresh();
    }),

    ...registerIssueCommands(deps),
    ...registerGitCommands(deps),
    ...registerTreeSetupCommands(deps),
  );
}

export function deactivate(): void {}
