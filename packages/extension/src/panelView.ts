import * as vscode from "vscode";
import type { RedmineClient, IssueStatus, Project, TimeEntry } from "@redmine-tools/core";
import { closedStatusIds } from "./treeSupport";
import {
  issueIdsForFile,
  listGitRepos,
  gitBranches,
  gitLog,
  gitWorkingChanges,
  gitWorkingFiles,
  gitCommitFiles,
  gitRemoteWebUrl,
  commitWebUrl,
  type GitRepo,
} from "./gitIssues";

import {
  ymd,
  mmdd,
  relTime,
  statusCat,
  dueInfo,
  countIssues,
  buildOpts,
  applyClient,
  type Filters,
} from "./panelData";
import { buildHtml } from "./panelHtml";

// 단일 웹뷰 앱 — 좌측 레일(일감/소요시간/커밋) 내부 전환, 필터 공유. ↗ pop-out은 동일 앱을 에디터 탭에 재호스팅.
export class PanelView implements vscode.WebviewViewProvider {
  static readonly viewId = "redminePanel";
  private static outCh?: vscode.OutputChannel;
  static log(): vscode.OutputChannel {
    if (!this.outCh) this.outCh = vscode.window.createOutputChannel("Redmine");
    return this.outCh;
  }
  private view?: vscode.WebviewView;
  private panel?: vscode.WebviewPanel;
  private gens = new WeakMap<vscode.Webview, number>(); // 웹뷰별 stale 응답 폐기
  private selGens = new WeakMap<vscode.Webview, number>(); // aside 선택(일감/커밋) stale 폐기
  private badgeValue = 0;
  private user?: { id: number; name: string };
  private knownUsers = new Map<number, string>();
  // 사용자 id → 팔레트 색 인덱스. 최초 등장순으로 고정 배정 → 필터 바뀌어도 같은 색 유지.
  // ponytail: 6색 팔레트라 세션에 6명 초과 등장하면 %6 충돌 가능. 필요시 뷰별 distinct 배정으로 승급.
  private userColors = new Map<number, number>();
  private meta?: { statuses: IssueStatus[]; projects: Project[]; closedIds: Set<number> };

  constructor(private readonly getClient: () => Promise<RedmineClient | undefined>) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    PanelView.log().appendLine(`[host] resolveWebviewView visible=${view.visible}`);
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = buildHtml();
    this.wire(view.webview);
    this.applyBadge();
  }

  // ↗ 에디터 탭 pop-out — 동일 HTML/핸들러 재사용
  popout(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    const p = vscode.window.createWebviewPanel(
      "redminePanelPopout",
      "Redmine 워크벤치",
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel = p;
    p.webview.html = buildHtml();
    this.wire(p.webview);
    p.onDidDispose(() => {
      this.panel = undefined;
    });
  }

  isVisible(): boolean {
    return (this.view?.visible ?? false) || (this.panel?.visible ?? false);
  }

  refresh(): void {
    this.post({ command: "refresh" });
    void this.updateBadge();
  }

  resetUsers(): void {
    this.knownUsers.clear();
    this.userColors.clear();
    this.meta = undefined;
    this.user = undefined;
  }

  private post(msg: unknown): void {
    void this.view?.webview.postMessage(msg);
    void this.panel?.webview.postMessage(msg);
  }

  private applyBadge(): void {
    if (this.view) {
      this.view.badge =
        this.badgeValue > 0
          ? { value: this.badgeValue, tooltip: `기한 임박·지연 ${this.badgeValue}건` }
          : undefined;
    }
  }
  private setBadge(n: number): void {
    this.badgeValue = n;
    this.applyBadge();
  }

  private async ensureMeta(client: RedmineClient): Promise<{ statuses: IssueStatus[]; projects: Project[]; closedIds: Set<number> }> {
    if (this.meta) return this.meta;
    const [statuses, projects] = await Promise.all([
      client.listStatuses().catch(() => [] as IssueStatus[]),
      client.listProjects().catch(() => [] as Project[]),
    ]);
    this.meta = { statuses, projects, closedIds: closedStatusIds(statuses) };
    return this.meta;
  }

  private wire(webview: vscode.Webview): void {
    webview.onDidReceiveMessage(async (msg: Record<string, unknown>) => {
      PanelView.log().appendLine(`[host] recv ${String(msg.command)}${msg.view ? " view=" + String(msg.view) : ""}`);
      try {
        switch (msg.command) {
          case "jsError":
            PanelView.log().appendLine(`[webview] ${String(msg.message)}`);
            break;
          case "load":
            await this.load(webview, msg.view as string, msg.filters as Filters, Number(msg.offset) || 0);
            break;
          case "open":
            void vscode.commands.executeCommand("redmine.openIssue", Number(msg.id));
            break;
          case "openInBrowser":
            void vscode.commands.executeCommand("redmine.openIssueInBrowser", { issueId: Number(msg.id) });
            break;
          case "changeStatus":
            await this.changeStatus(Number(msg.id), Number(msg.statusId));
            break;
          case "copyLink":
            void vscode.commands.executeCommand("redmine.copyIssueLink", { issueId: Number(msg.id) });
            break;
          case "run":
            void vscode.commands.executeCommand(String(msg.cmd));
            break;
          case "changeStatusPick":
            // row id 실어 QuickPick 흐름 (redmine.changeStatus는 nodeIssueId로 issueId 추출)
            void vscode.commands.executeCommand("redmine.changeStatus", { issueId: Number(msg.id) });
            break;
          case "popout":
            void vscode.commands.executeCommand("redmine.openPanel");
            break;
          case "insertRef":
            void vscode.commands.executeCommand("redmine.insertIssueRef");
            break;
          case "selectIssue":
            await this.selectIssue(webview, Number(msg.id));
            break;
          case "selectCommit":
            await this.selectCommit(
              webview,
              String(msg.repoPath),
              String(msg.hash),
              msg.issueId ? Number(msg.issueId) : undefined,
            );
            break;
          case "diffFile":
            void vscode.commands.executeCommand(
              "redmine.diffCommitFile",
              String(msg.repoPath),
              String(msg.hash),
              String(msg.file),
            );
            break;
          case "selectWorking":
            await this.selectWorking(webview, String(msg.repoPath));
            break;
          case "diffWorkingFile":
            void vscode.commands.executeCommand(
              "redmine.diffWorkingFile",
              String(msg.repoPath),
              String(msg.file),
              !!msg.del,
            );
            break;
          case "openCommitRemote":
            await this.openCommitRemote(String(msg.repoPath), String(msg.hash));
            break;
          case "openCommitRevision":
            this.openCommitRevision(String(msg.hash));
            break;
          case "copyText":
            await vscode.env.clipboard.writeText(String(msg.text));
            void vscode.window.setStatusBarMessage("복사됨", 1500);
            break;
        }
      } catch (err) {
        PanelView.log().appendLine(`[host] handler error: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
        void webview.postMessage({ command: "error", message: err instanceof Error ? err.message : String(err) });
      }
    });
  }

  private async changeStatus(id: number, statusId: number): Promise<void> {
    const client = await this.getClient();
    if (!client || !Number.isInteger(id) || !Number.isInteger(statusId)) return;
    await client.updateIssue(id, { statusId });
    this.refresh();
  }

  private async load(webview: vscode.Webview, view: string, filters: Filters, offset: number): Promise<void> {
    const gen = (this.gens.get(webview) ?? 0) + 1;
    this.gens.set(webview, gen);
    const alive = (): boolean => this.gens.get(webview) === gen;
    const send = (m: object): void => {
      PanelView.log().appendLine(`[host] send data view=${view} alive=${alive()}`);
      if (alive()) void webview.postMessage({ command: "data", view, ...m });
    };
    if (view === "commits") {
      await this.loadCommits(send, filters);
      return;
    }
    const client = await this.getClient();
    if (!client) {
      this.setBadge(0);
      send({ connected: false });
      return;
    }
    if (view === "time") await this.loadTime(client, alive, send, filters);
    else await this.loadIssues(client, alive, send, filters, offset);
  }

  private async loadIssues(
    client: RedmineClient,
    alive: () => boolean,
    send: (m: object) => void,
    filters: Filters,
    offset: number,
  ): Promise<void> {
    const meta = await this.ensureMeta(client);
    if (!alive()) return;
    if (!this.user) this.user = await client.getCurrentUser().catch(() => undefined);
    const { server, client: cf } = buildOpts(filters, offset, meta.statuses);

    const activeUri = vscode.window.activeTextEditor?.document.uri;
    const [page, myPage, gitIds] = await Promise.all([
      client.listIssues(server),
      client.listIssues({ assignedToMe: true, limit: 50 }),
      activeUri ? issueIdsForFile(activeUri).catch(() => [] as number[]) : Promise.resolve([] as number[]),
    ]);
    if (!alive()) return;

    const counts = countIssues(myPage.issues);
    this.setBadge(counts.dueSoon + counts.overdue);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const t0 = today.getTime();
    const uid = this.user?.id;

    const filtered = applyClient(page.issues, cf);
    const rows = filtered.map((i) => ({
      id: i.id,
      subject: i.subject,
      status: i.status.name,
      cat: statusCat(i.status, meta.closedIds),
      priority: i.priority?.name ?? "",
      project: i.project?.name ?? "",
      assignee: i.assigned_to?.name ?? "—",
      done: i.done_ratio ?? 0,
      updated: relTime(i.updated_on),
      mine: uid !== undefined && i.assigned_to?.id === uid,
      due: dueInfo(i.due_date, t0),
    }));

    // 현재 작업 — 활성 파일 연관 일감 1건
    let currentWork: unknown;
    if (gitIds.length) {
      const issue = await client.getIssue(gitIds[0]).catch(() => undefined);
      if (issue && alive()) {
        currentWork = {
          id: issue.id,
          subject: issue.subject,
          statusId: issue.status.id,
          meta: [issue.status?.name, issue.priority?.name].filter(Boolean).join(" · "),
        };
      }
    }
    if (!alive()) return;

    // 담당자 드롭다운 후보 (조회된 목록 distinct)
    const assignees = new Map<number, string>();
    for (const i of [...page.issues, ...myPage.issues]) {
      if (i.assigned_to) assignees.set(i.assigned_to.id, i.assigned_to.name);
    }

    let host = "";
    try {
      host = new URL(vscode.workspace.getConfiguration("redmine").get<string>("url", "")).host;
    } catch {
      /* 무시 */
    }

    send({
      connected: true,
      host,
      account: this.user?.name,
      filters,
      currentWork,
      statuses: meta.statuses.map((s) => ({ id: s.id, name: s.name })),
      // parent.id 포함 → 프론트에서 계층 트리 정렬
      projects: meta.projects.map((p) => ({ id: p.id, name: p.name, parent: p.parent ? { id: p.parent.id } : undefined })),
      assignees: [...assignees].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
      counts,
      rows,
      totalCount: page.totalCount,
      offset,
      // 서버 원본 페이지 기준 — 클라 필터로 rows 줄어도 다음 페이지 존재하면 true (무한 "더 불러오기" 방지)
      hasMore: offset + page.issues.length < page.totalCount,
      clientFiltered: !!cf.statusName,
    });
  }

  private async selectIssue(webview: vscode.Webview, id: number): Promise<void> {
    const gen = (this.selGens.get(webview) ?? 0) + 1;
    this.selGens.set(webview, gen);
    const client = await this.getClient();
    if (!client || !Number.isInteger(id)) return;
    const meta = await this.ensureMeta(client);
    const issue = await client.getIssue(id);
    if (this.selGens.get(webview) !== gen) return; // 빠른 재선택 → stale 폐기
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const note = (issue.journals ?? []).filter((j) => j.notes && j.notes.trim()).pop();
    void webview.postMessage({
      command: "issueDetail",
      detail: {
        id: issue.id,
        subject: issue.subject,
        status: issue.status.name,
        cat: statusCat(issue.status, meta.closedIds),
        priority: issue.priority?.name ?? "",
        meta: [issue.project?.name, issue.assigned_to?.name, issue.due_date ? `예정 ${mmdd(issue.due_date)}` : null]
          .filter(Boolean)
          .join(" · "),
        desc: (issue.description ?? "").trim().slice(0, 160),
        comment: note ? `${note.user?.name ?? ""}: ${note.notes!.split("\n")[0].slice(0, 100)}` : "",
      },
    });
  }

  private async loadTime(
    client: RedmineClient,
    alive: () => boolean,
    send: (m: object) => void,
    filters: Filters,
  ): Promise<void> {
    const now = new Date();
    const to = ymd(now);
    let from: string;
    let n: number;
    if (filters.period === "month") {
      from = ymd(new Date(now.getFullYear(), now.getMonth(), 1));
      n = now.getDate();
    } else {
      n = Number(filters.period) || 7;
      const f = new Date(now);
      f.setDate(now.getDate() - (n - 1));
      from = ymd(f);
    }
    const userId = filters.assignee === "me" ? "me" : filters.assignee === "all" ? undefined : Number(filters.assignee);

    let result: { entries: TimeEntry[]; truncated: boolean };
    try {
      result = await client.listTimeEntries({ from, to, userId });
    } catch (err) {
      send({ connected: true, error: err instanceof Error ? err.message : String(err) });
      return;
    }
    if (!alive()) return;
    const entries = result.entries;
    for (const e of entries) if (e.user) this.knownUsers.set(e.user.id, e.user.name);

    const days: Array<{ date: string; label: string; hours: number; isToday: boolean }> = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const key = ymd(d);
      const hours = entries.filter((e) => e.spent_on === key).reduce((s, e) => s + (e.hours || 0), 0);
      days.push({ date: key, label: `${d.getMonth() + 1}/${d.getDate()}`, hours: Math.round(hours * 100) / 100, isToday: i === 0 });
    }
    const total = days.reduce((s, d) => s + d.hours, 0);

    // 작업자별 시리즈: 일자별 시간 집계 → 상위 5명 + '기타'. 6명 이하면 전원 개별.
    const byUser = new Map<number, { name: string; total: number; byDate: Map<string, number> }>();
    for (const e of entries) {
      if (!e.user) continue;
      const u = byUser.get(e.user.id) ?? { name: e.user.name, total: 0, byDate: new Map() };
      u.total += e.hours || 0;
      u.byDate.set(e.spent_on, (u.byDate.get(e.spent_on) || 0) + (e.hours || 0));
      byUser.set(e.user.id, u);
    }
    for (const id of byUser.keys()) if (!this.userColors.has(id)) this.userColors.set(id, this.userColors.size);
    const ranked = [...byUser.entries()].sort((a, b) => b[1].total - a[1].total);
    const dateKeys = days.map((d) => d.date);
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const showAll = ranked.length <= 6;
    const top = showAll ? ranked : ranked.slice(0, 5);
    const rest = showAll ? [] : ranked.slice(5);
    const series = top.map(([id, u]) => ({
      name: u.name,
      colorIdx: this.userColors.get(id) ?? 0,
      other: false,
      values: dateKeys.map((k) => r2(u.byDate.get(k) || 0)),
    }));
    if (rest.length) {
      series.push({
        name: "기타",
        colorIdx: -1,
        other: true,
        values: dateKeys.map((k) => r2(rest.reduce((s, [, u]) => s + (u.byDate.get(k) || 0), 0))),
      });
    }

    const table = entries
      .slice()
      .sort((a, b) => (a.spent_on < b.spent_on ? 1 : a.spent_on > b.spent_on ? -1 : b.id - a.id))
      .map((e) => ({
        date: e.spent_on,
        issueId: e.issue?.id,
        activity: e.activity?.name ?? "",
        comments: e.comments ?? "",
        hours: e.hours,
      }));

    send({
      connected: true,
      filter: filters.assignee,
      period: filters.period,
      users: [...this.knownUsers].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
      today: days[days.length - 1]?.hours ?? 0,
      total: Math.round(total * 100) / 100,
      avg: Math.round((total / n) * 100) / 100,
      days,
      series,
      multi: series.length >= 2,
      entries: table,
      truncated: result.truncated,
    });
  }

  private async loadCommits(send: (m: object) => void, filters: Filters): Promise<void> {
    const repos = await listGitRepos();
    if (!repos.length) {
      send({ connected: true, repos: [], commits: [] });
      return;
    }
    const idx = Math.min(Math.max(0, filters.repo), repos.length - 1);
    const repo = repos[idx];
    const { current, branches } = await gitBranches(repo.path);
    const branch = filters.branch && branches.includes(filters.branch) ? filters.branch : current;
    const [commits, working, remoteUrl] = await Promise.all([
      gitLog(repo.path, { branch, limit: 100 }),
      gitWorkingChanges(repo.path),
      gitRemoteWebUrl(repo.path),
    ]);
    const cfg = vscode.workspace.getConfiguration("redmine");
    const hasRevision = !!cfg.get<string>("url", "").trim() && !!cfg.get<string>("projectIdentifier", "").trim();

    const q = filters.search.trim();
    const num = q.match(/^#?(\d+)$/)?.[1];
    const filtered = commits.filter((c) => {
      if (filters.linkedOnly && !c.issueIds.length) return false;
      if (!q) return true;
      if (num) return c.issueIds.includes(Number(num));
      return `${c.subject}\n${c.body}`.toLowerCase().includes(q.toLowerCase());
    });

    send({
      connected: true,
      repos: repos.map((r: GitRepo) => r.name),
      repoIndex: idx,
      repoPath: repo.path,
      branches,
      branch,
      working,
      remoteUrl,
      hasRevision,
      commits: filtered.map((c) => ({
        hash: c.hash,
        shortHash: c.shortHash,
        subject: c.subject,
        body: c.body,
        author: c.author,
        date: relTime(c.dateIso),
        dateIso: c.dateIso,
        issueIds: c.issueIds,
        added: c.added,
        deleted: c.deleted,
        files: c.files,
      })),
      linkedOnly: filters.linkedOnly,
    });
  }

  private async selectCommit(
    webview: vscode.Webview,
    repoPath: string,
    hash: string,
    issueId?: number,
  ): Promise<void> {
    const gen = (this.selGens.get(webview) ?? 0) + 1;
    this.selGens.set(webview, gen);
    const files = await gitCommitFiles(repoPath, hash);
    let issue: unknown;
    if (issueId) {
      const client = await this.getClient();
      if (client) {
        const meta = await this.ensureMeta(client);
        const i = await client.getIssue(issueId).catch(() => undefined);
        if (i) {
          issue = {
            id: i.id,
            subject: i.subject,
            status: i.status.name,
            cat: statusCat(i.status, meta.closedIds),
            meta: [i.assigned_to?.name, i.due_date ? `예정 ${mmdd(i.due_date)}` : null].filter(Boolean).join(" · "),
          };
        }
      }
    }
    if (this.selGens.get(webview) !== gen) return; // 빠른 재선택 → stale 폐기
    void webview.postMessage({ command: "commitDetail", hash, files, issue });
  }

  private async selectWorking(webview: vscode.Webview, repoPath: string): Promise<void> {
    const gen = (this.selGens.get(webview) ?? 0) + 1;
    this.selGens.set(webview, gen);
    const files = await gitWorkingFiles(repoPath);
    if (this.selGens.get(webview) !== gen) return; // 빠른 재선택 → stale 폐기
    void webview.postMessage({ command: "workingDetail", files });
  }

  // 커밋 원격 저장소 permalink 열기. 원격 없으면 안내.
  private async openCommitRemote(repoPath: string, hash: string): Promise<void> {
    const base = await gitRemoteWebUrl(repoPath);
    const url = commitWebUrl(base, hash);
    if (!url) {
      void vscode.window.showInformationMessage("원격 저장소(origin)를 찾을 수 없습니다.");
      return;
    }
    void vscode.env.openExternal(vscode.Uri.parse(url));
  }

  // Redmine 리비전 페이지 열기 (url·projectIdentifier 설정 시).
  private openCommitRevision(hash: string): void {
    const cfg = vscode.workspace.getConfiguration("redmine");
    const url = cfg.get<string>("url", "").trim().replace(/\/+$/, "");
    const pid = cfg.get<string>("projectIdentifier", "").trim();
    if (!url || !pid) {
      void vscode.window.showInformationMessage("Redmine URL·프로젝트 식별자 설정이 필요합니다.");
      return;
    }
    void vscode.env.openExternal(
      vscode.Uri.parse(`${url}/projects/${pid}/repository/revisions/${hash}`),
    );
  }

  private async updateBadge(): Promise<void> {
    const client = await this.getClient();
    if (!client) {
      this.setBadge(0);
      return;
    }
    try {
      const page = await client.listIssues({ assignedToMe: true, limit: 50 });
      const c = countIssues(page.issues);
      this.setBadge(c.dueSoon + c.overdue);
    } catch {
      /* 무시 */
    }
  }
}

