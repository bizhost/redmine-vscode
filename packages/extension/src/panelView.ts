import * as vscode from "vscode";
import type { RedmineClient, Issue, IssueStatus, Project, TimeEntry } from "@redmine-tools/core";
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

const DAY = 86_400_000;

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function mmdd(iso: string): string {
  const p = iso.split("-");
  return p.length === 3 ? `${p[1]}-${p[2]}` : iso;
}
function relTime(iso?: string): string {
  if (!iso) return "";
  const m = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

// 상태명/닫힘여부 → 색 카테고리 (트리와 동일 규칙)
function statusCat(status: { id: number; name: string }, closedIds: Set<number>): "new" | "prog" | "done" {
  if (closedIds.has(status.id)) return "done";
  return /신규|new/i.test(status.name) ? "new" : "prog";
}

interface DueInfo {
  text: string;
  cls: string;
}
function dueInfo(due: string | undefined, t0: number): DueInfo {
  if (!due) return { text: "—", cls: "dim" };
  const d = new Date(`${due}T00:00:00`).getTime();
  if (d < t0) return { text: `${mmdd(due)} 지연`, cls: "late" };
  const days = Math.round((d - t0) / DAY);
  if (days <= 7) return { text: `${mmdd(due)} D-${days}`, cls: "late" };
  return { text: mmdd(due), cls: "" };
}

interface IssueCounts {
  new: number;
  prog: number;
  dueSoon: number;
  overdue: number;
}
function countIssues(issues: Issue[]): IssueCounts {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const t0 = today.getTime();
  const in7 = t0 + 7 * DAY;
  const c: IssueCounts = { new: 0, prog: 0, dueSoon: 0, overdue: 0 };
  for (const i of issues) {
    if (/신규|new/i.test(i.status.name)) c.new++;
    else c.prog++;
    if (i.due_date) {
      const d = new Date(`${i.due_date}T00:00:00`).getTime();
      if (d < t0) c.overdue++;
      else if (d <= in7) c.dueSoon++;
    }
  }
  return c;
}

interface ServerOpts {
  limit: number;
  offset: number;
  assignedToMe?: boolean;
  assignedToId?: number;
  statusId?: string;
  projectId?: number;
  subjectQuery?: string;
  issueId?: number;
  dueBefore?: string;
}
interface ClientFilters {
  // 서버로 못 미는 잔여만: status: 이름 해석 실패 케이스
  statusName?: string;
}
interface Filters {
  project: string;
  status: string;
  assignee: string;
  search: string;
  period: string;
  repo: number;
  branch: string;
  linkedOnly: boolean;
}

// 검색 구문 + 드롭다운 → 서버 옵션 + 클라이언트 잔여 필터. 좁은 서버 조회 위에 클라 필터 얹지 않도록 매핑.
function buildOpts(f: Filters, offset: number, statuses: IssueStatus[]): { server: ServerOpts; client: ClientFilters } {
  const server: ServerOpts = { limit: 50, offset };
  const client: ClientFilters = {};
  let assignee = f.assignee;
  let statusName: string | undefined;
  const text: string[] = [];
  for (const tok of f.search.trim().split(/\s+/).filter(Boolean)) {
    if (/^#\d+$/.test(tok)) server.issueId = Number(tok.slice(1));
    else if (tok === "assignee:me") assignee = "me";
    else if (/^status:/.test(tok)) statusName = tok.slice(7);
    else if (/^due:<7d$/i.test(tok)) {
      // 서버측 마감 상한 = 오늘+7일. 좁은 페이지 위 클라 필터 대신 서버로 밀어 페이징 정상화.
      const d7 = new Date();
      d7.setHours(0, 0, 0, 0);
      d7.setDate(d7.getDate() + 7);
      server.dueBefore = ymd(d7);
    } else text.push(tok);
  }
  if (text.length) server.subjectQuery = text.join(" ");

  // 담당자
  if (assignee === "me") server.assignedToMe = true;
  else if (assignee === "all") {
    server.assignedToMe = false;
    server.projectId = 0; // 전 프로젝트
  } else {
    server.assignedToMe = false;
    server.assignedToId = Number(assignee); // 개별 담당자 → 서버측 필터
  }
  // 프로젝트 (드롭다운이 우선)
  if (f.project) server.projectId = Number(f.project);

  // 상태: 구문(status:) → 이름 해석, 아니면 드롭다운
  const named = statusName
    ? statuses.find((s) => s.name === statusName || s.name.includes(statusName))
    : undefined;
  if (statusName) {
    if (named) server.statusId = String(named.id);
    else client.statusName = statusName; // 이름 해석 실패 → 클라 필터
  } else if (f.status === "all") server.statusId = "*";
  else if (f.status && f.status !== "open") server.statusId = String(f.status);
  // 'open' → statusId 생략 (Redmine 기본 = 열림)

  return { server, client };
}

function applyClient(issues: Issue[], c: ClientFilters): Issue[] {
  if (!c.statusName) return issues;
  return issues.filter((i) => i.status.name.includes(c.statusName!));
}

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

function buildHtml(): string {
  // String.raw: 웹뷰 JS의 \n·\d 등이 TS 템플릿 이스케이프로 소실되는 것 방지 (실제 SyntaxError 사고 이력)
  return String.raw`<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<style>
  :root{--nl:#4fa3ff;--pr:#e2b93d;--dn:#3fb950;--late:#ff8f8f;}
  *{box-sizing:border-box;}
  body{margin:0;padding:0;color:var(--vscode-foreground);font-family:var(--vscode-font-family);font-size:13px;}
  .wrap{display:flex;height:100vh;}
  .rail{width:38px;flex:none;border-right:1px solid var(--vscode-panel-border,var(--vscode-widget-border));display:flex;flex-direction:column;align-items:center;padding-top:8px;gap:4px;}
  .rail span{width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:4px;cursor:pointer;color:var(--vscode-descriptionForeground);font-size:15px;}
  .rail span.on{background:var(--vscode-button-background);color:var(--vscode-button-foreground);}
  .rail span:hover{background:var(--vscode-list-hoverBackground);}
  .main{flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden;}
  .bar{display:flex;gap:8px;align-items:center;padding:6px 10px;border-bottom:1px solid var(--vscode-panel-border,var(--vscode-widget-border));flex-wrap:wrap;}
  .strip{background:var(--vscode-editorWidget-background,var(--vscode-input-background));}
  .content{flex:1;display:flex;min-height:0;overflow:hidden;}
  .grid{flex:1;overflow:auto;}
  .foot{display:flex;justify-content:space-between;gap:8px;padding:4px 10px;border-top:1px solid var(--vscode-panel-border,var(--vscode-widget-border));font-size:11px;color:var(--vscode-descriptionForeground);}
  input.search{flex:1;min-width:120px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,var(--vscode-dropdown-border));border-radius:2px;padding:4px 8px;font-size:12px;font-family:inherit;}
  select{background:var(--vscode-dropdown-background);color:var(--vscode-dropdown-foreground);border:1px solid var(--vscode-dropdown-border);font-size:11px;padding:2px 4px;border-radius:2px;font-family:inherit;}
  .chip{display:inline-block;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);border:1px solid var(--vscode-contrastBorder,transparent);border-radius:10px;padding:1px 9px;font-size:11px;}
  .chip.on{color:var(--dn);border-color:var(--dn);background:transparent;}
  .cchip{cursor:pointer;}
  .cchip b{margin-left:5px;}
  .cchip.due{border-color:var(--pr);}
  .cchip.late{border-color:var(--late);}
  .cchip.sel{background:var(--vscode-button-background);color:var(--vscode-button-foreground);}
  .spacer{flex:1;}
  .iconbtn{cursor:pointer;color:var(--vscode-descriptionForeground);padding:2px 4px;}
  .iconbtn:hover{color:var(--vscode-foreground);}
  table{width:100%;border-collapse:collapse;font-size:12px;}
  th{position:sticky;top:0;background:var(--vscode-editor-background,var(--vscode-panel-background));text-align:left;color:var(--vscode-descriptionForeground);font-weight:600;font-size:10px;text-transform:uppercase;padding:5px 8px;border-bottom:1px solid var(--vscode-panel-border,var(--vscode-widget-border));cursor:pointer;white-space:nowrap;}
  td{padding:4px 8px;border-bottom:1px solid var(--vscode-panel-border,transparent);white-space:nowrap;}
  tr.row{cursor:pointer;}
  tr.row:hover td{background:var(--vscode-list-hoverBackground);}
  tr.sel td{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground);}
  tr.grp td{background:var(--vscode-editorWidget-background,var(--vscode-input-background));font-weight:600;color:var(--vscode-descriptionForeground);font-size:11px;}
  .st{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle;}
  .st.new{background:var(--nl);}.st.prog{background:var(--pr);}.st.done{background:var(--dn);}
  .pg{display:inline-block;width:64px;height:7px;background:var(--vscode-input-background);border-radius:3px;overflow:hidden;vertical-align:middle;}
  .pg i{display:block;height:100%;background:var(--vscode-progressBar-background,var(--vscode-button-background));}
  .dim{color:var(--vscode-descriptionForeground);}
  .late{color:var(--late);}
  .link{color:var(--vscode-textLink-foreground);cursor:pointer;}
  .link:hover{text-decoration:underline;}
  .aside{width:280px;flex:none;min-width:0;border-left:1px solid var(--vscode-panel-border,var(--vscode-widget-border));padding:12px;overflow:auto;}
  .aside.wide{width:300px;}
  .aside h3,.aside .m{overflow-wrap:anywhere;}
  .rez{width:6px;flex:none;cursor:col-resize;background:transparent;touch-action:none;user-select:none;}
  .rez:hover{background:var(--vscode-sash-hoverBorder,var(--vscode-focusBorder));}
  .brow{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-bottom:4px;}
  .brow .badge{margin-right:0;flex:none;}
  .aside h3{font-size:13px;margin:8px 0 4px;}
  .aside .m{color:var(--vscode-descriptionForeground);font-size:11px;}
  .box{border:1px dashed var(--vscode-panel-border,var(--vscode-widget-border));border-radius:2px;padding:8px;color:var(--vscode-descriptionForeground);font-size:11px;margin:8px 0;white-space:pre-wrap;word-break:break-word;}
  .badge{display:inline-block;border-radius:10px;padding:1px 9px;font-size:11px;font-weight:600;margin-right:4px;white-space:nowrap;}
  .badge.id{background:var(--vscode-input-background);border:1px solid var(--vscode-panel-border);}
  .badge.st{width:auto;height:auto;border-radius:10px;background:#7a5b0f;color:#ffe9ad;}
  .badge.st.new{background:#0e4a7a;color:#cfe6ff;}
  .badge.st.done{background:#1f5a2b;color:#c8f0cf;}
  .badge.pr{background:#7a2222;color:#ffc2c2;}
  .btn{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:2px;padding:4px 10px;font-size:12px;cursor:pointer;font-family:inherit;margin-right:4px;}
  .btn:hover{background:var(--vscode-button-hoverBackground);}
  .btn.ghost{background:transparent;border:1px solid var(--vscode-button-border,var(--vscode-panel-border));color:var(--vscode-foreground);}
  .ib{display:inline-block;border-radius:9px;padding:0 8px;font-size:10px;font-weight:600;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);cursor:pointer;margin-right:3px;}
  .ib:hover{text-decoration:underline;}
  .chg{display:inline-flex;gap:1px;height:7px;vertical-align:middle;margin-right:5px;}
  .chg i{display:block;border-radius:1px;}
  .chg .a{background:var(--dn);}.chg .d{background:var(--late);}
  .ga{color:var(--vscode-gitDecoration-addedResourceForeground,#81b88b);}
  .gd{color:var(--vscode-gitDecoration-deletedResourceForeground,#c74e39);}
  .gm{color:var(--vscode-gitDecoration-modifiedResourceForeground,#e2c08d);}
  .fst{width:14px;flex:none;font-weight:700;text-align:center;}
  .file .dir{color:var(--vscode-descriptionForeground);font-size:10px;margin-left:6px;}
  .file .fnum{flex:none;font-size:10px;}
  .hcard .who{font-weight:600;}
  .hcard .abs{font-style:italic;}
  .hcard .subj{font-weight:600;margin-top:4px;}
  .av{width:22px;height:22px;border-radius:50%;background:var(--vscode-button-background);color:var(--vscode-button-foreground);display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex:none;}
  .cdhead{display:flex;align-items:center;gap:8px;margin-bottom:6px;}
  .cdhead .who{color:var(--vscode-textLink-foreground);font-weight:600;}
  .cdrow{display:flex;align-items:center;gap:6px;font-size:12px;margin-bottom:6px;flex-wrap:wrap;}
  .brchip{display:inline-flex;align-items:center;border:1px solid var(--vscode-panel-border);border-radius:3px;padding:0 7px;font-size:11px;color:var(--vscode-textLink-foreground);}
  .msgbox{position:relative;background:var(--vscode-editorWidget-background,var(--vscode-input-background));border:1px solid var(--vscode-panel-border,transparent);border-radius:3px;padding:8px 26px 8px 10px;font-size:12px;margin-bottom:8px;}
  .msgbox .subj{font-weight:600;}
  .msgbox .body{margin-top:4px;color:var(--vscode-descriptionForeground);white-space:pre-wrap;word-break:break-word;}
  .msgbox .cpy{position:absolute;right:6px;top:6px;cursor:pointer;color:var(--vscode-descriptionForeground);}
  .msgbox .cpy:hover{color:var(--vscode-foreground);}
  .fh{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--vscode-foreground);margin:10px 0 6px;display:flex;align-items:center;gap:6px;}
  .fh .cnt{background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);border-radius:8px;padding:0 6px;font-size:10px;}
  input.ffilter{width:100%;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,var(--vscode-dropdown-border));border-radius:2px;padding:3px 8px;font-size:11px;font-family:inherit;margin-bottom:6px;box-sizing:border-box;}
  tr.wip td{background:var(--vscode-editorWidget-background,var(--vscode-input-background));font-weight:600;}
  .file{display:flex;justify-content:space-between;font-size:11px;padding:2px 0;gap:8px;}
  .file .fn{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .file .stt{color:var(--pr);cursor:pointer;flex:none;}
  .file .stt:hover{text-decoration:underline;}
  .card{background:var(--vscode-editorWidget-background,var(--vscode-input-background));border:1px solid var(--vscode-panel-border,transparent);border-radius:4px;padding:8px 10px;margin-top:8px;}
  .stats{display:flex;gap:14px;margin-bottom:12px;flex-wrap:wrap;}
  .stat{background:var(--vscode-editorWidget-background,var(--vscode-input-background));border:1px solid var(--vscode-panel-border,transparent);border-radius:4px;padding:8px 14px;}
  .stat b{font-size:22px;}
  .stat span{display:block;font-size:10px;color:var(--vscode-descriptionForeground);text-transform:uppercase;}
  .seg{display:inline-flex;border:1px solid var(--vscode-panel-border,var(--vscode-dropdown-border));border-radius:2px;overflow:hidden;font-size:11px;}
  .seg span{padding:2px 10px;cursor:pointer;}
  .seg span.on{background:var(--vscode-button-background);color:var(--vscode-button-foreground);}
  .chartwrap{position:relative;padding:10px 4px;flex:1;min-height:120px;overflow:hidden;}
  .chartwrap svg{display:block;width:100%;height:100%;}
  svg .grid{stroke:var(--vscode-widget-border,var(--vscode-panel-border));stroke-width:1;opacity:.6;}
  svg .bar{fill:var(--vscode-charts-blue,#4fa3ff);}
  svg .line{stroke:var(--vscode-charts-blue,#4fa3ff);stroke-width:2;fill:none;}
  svg .pt{fill:var(--vscode-charts-blue,#4fa3ff);}
  svg .ylab,svg .xlab{fill:var(--vscode-descriptionForeground);font-size:8px;}
  svg .xlab.tod{fill:var(--vscode-foreground);font-weight:600;}
  svg .vlab{fill:var(--vscode-foreground);font-size:8px;font-weight:600;}
  .legend{display:flex;flex-wrap:wrap;gap:4px 12px;margin:2px 0 2px;font-size:11px;color:var(--vscode-foreground);flex:none;}
  .legend .li{display:inline-flex;align-items:center;gap:4px;}
  .legend .sw{width:10px;height:10px;border-radius:2px;flex:none;}
  .tip{position:absolute;display:none;pointer-events:none;z-index:5;background:var(--vscode-editorWidget-background,var(--vscode-input-background));border:1px solid var(--vscode-widget-border,var(--vscode-panel-border));color:var(--vscode-foreground);font-size:11px;padding:2px 6px;border-radius:3px;white-space:nowrap;}
  .hcard{position:fixed;display:none;z-index:60;max-width:420px;background:var(--vscode-editorHoverWidget-background,var(--vscode-editorWidget-background));border:1px solid var(--vscode-editorHoverWidget-border,var(--vscode-widget-border));color:var(--vscode-editorHoverWidget-foreground,var(--vscode-foreground));font-size:12px;padding:8px 10px;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,.4);pointer-events:none;}
  .hcard .m{color:var(--vscode-descriptionForeground);font-size:11px;}
  .hcard .msg{white-space:pre-wrap;word-break:break-word;margin-top:4px;max-height:180px;overflow:hidden;}
  .vdesc{font-size:11px;color:var(--vscode-descriptionForeground);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:0 1 auto;}
  .pad{padding:12px;}
  .num{text-align:right;}
  label.cb{font-size:11px;color:var(--vscode-descriptionForeground);display:flex;align-items:center;gap:3px;}
</style>
</head>
<body>
<div class="wrap">
  <div class="rail">
    <span data-view="issues" title="일감">📋</span>
    <span data-view="time" title="소요시간">⏱</span>
    <span data-view="commits" title="커밋">🔀</span>
  </div>
  <div class="main">
    <div id="strip"></div>
    <div class="bar" id="bar"></div>
    <div class="content" id="content"><div class="pad dim">불러오는 중...</div></div>
    <div class="foot" id="foot"></div>
  </div>
</div>
<script>
const vscode = acquireVsCodeApi();
// 웹뷰 JS 에러 → 호스트 OutputChannel(출력 탭 "Redmine")로 표면화
window.onerror=function(msg,src,line,col,err){ try{ vscode.postMessage({command:"jsError",message:String(msg)+" @"+line+":"+col+(err&&err.stack?"\n"+err.stack:"")}); }catch(e){} };
window.addEventListener("unhandledrejection",function(e){ try{ vscode.postMessage({command:"jsError",message:"unhandledrejection: "+String(e.reason)}); }catch(x){} });
vscode.postMessage({command:"jsError",message:"[boot] webview script started"});
const S = vscode.getState() || {
  view:"issues",
  filters:{project:"",status:"open",assignee:"me",search:"",period:"7",repo:0,branch:"",linkedOnly:true},
  sort:{col:"updated",dir:"desc"}, offset:0, selId:null, selHash:null, asideW:null, chartMode:"bar", last:{}
};
function save(){ vscode.setState(S); }
function el(t,c,x){ const e=document.createElement(t); if(c)e.className=c; if(x!=null)e.textContent=x; return e; }
function fmtH(h){ return (Math.round((h||0)*10)/10).toFixed(1); }
function post(m){ vscode.postMessage(m); }
function reqLoad(){ post({command:"load", view:S.view, filters:S.filters, offset:S.offset}); }

// ---- rail ----
document.querySelectorAll(".rail span").forEach(s=>{
  s.onclick=()=>{ S.view=s.dataset.view; S.offset=0; S.selId=null; S.selHash=null; save(); syncRail(); reqLoad(); showLoading(); };
});
function syncRail(){ document.querySelectorAll(".rail span").forEach(s=>s.classList.toggle("on", s.dataset.view===S.view)); }
function showLoading(){ document.getElementById("content").innerHTML='<div class="pad dim">불러오는 중...</div>'; document.getElementById("strip").innerHTML=""; document.getElementById("bar").innerHTML=""; document.getElementById("foot").innerHTML=""; }
const VIEW_DESC={issues:"일감 — 검색·필터 탐색, 행 클릭=상세, 우클릭=액션",time:"소요시간 — 기간·작업자별 작업시간 집계",commits:"커밋 — 워크스페이스 커밋 ↔ #일감 연결, 파일 클릭=diff"};
function stripDesc(){ return el("span","vdesc",VIEW_DESC[S.view]||""); }

// ---- issues ----
function renderIssues(d){
  const strip=document.getElementById("strip"); strip.className="bar strip"; strip.innerHTML="";
  if(d.currentWork){
    const cw=d.currentWork;
    const w=el("span"); w.innerHTML='▶ 현재 작업: ';
    const a=el("b","link","#"+cw.id); a.onclick=()=>post({command:"open",id:cw.id});
    w.appendChild(a); w.appendChild(document.createTextNode(" "+cw.subject+" "));
    if(d.statuses&&d.statuses.length){
      const sel=el("select");
      for(const st of d.statuses){ const o=el("option",null,st.name); o.value=st.id; if(st.id===cw.statusId)o.selected=true; sel.appendChild(o); }
      sel.onchange=()=>post({command:"changeStatus",id:cw.id,statusId:Number(sel.value)});
      w.appendChild(sel);
    }
    const up=el("span","iconbtn","↗"); up.title="브라우저"; up.onclick=()=>post({command:"openInBrowser",id:cw.id}); w.appendChild(up);
    strip.appendChild(w);
  } else strip.appendChild(el("span","dim","현재 작업 없음 (활성 파일 커밋 #번호 기준)"));
  strip.appendChild(stripDesc());
  strip.appendChild(el("span","spacer"));
  const c=d.counts;
  strip.appendChild(queueChip("신규",c.new,"new",""));
  strip.appendChild(queueChip("진행",c.prog,"prog",""));
  strip.appendChild(queueChip("임박",c.dueSoon,"duefilter","due"));
  strip.appendChild(queueChip("지연",c.overdue,"latefilter","late"));
  const acc=el("span","dim"); acc.style.fontSize="11px";
  acc.appendChild(document.createTextNode(" │ "+(d.host||"")+" "));
  if(d.account){ const on=el("span","chip on","● "+d.account); acc.appendChild(on); }
  strip.appendChild(acc);

  const bar=document.getElementById("bar"); bar.innerHTML="";
  const search=el("input","search"); search.placeholder="일감 검색 (Enter) — 예: #1234 status:진행중 assignee:me due:<7d";
  search.value=S.filters.search;
  search.onkeydown=(e)=>{ if(e.key==="Enter"){ S.filters.search=search.value; S.offset=0; save(); reqLoad(); } };
  bar.appendChild(search);
  bar.appendChild(dd("프로젝트", S.filters.project, [{id:"",name:"전체"},...projTreeOpts(d.projects)], v=>{S.filters.project=v;S.offset=0;save();reqLoad();}));
  const stOpts=[{id:"open",name:"열림"},{id:"all",name:"전체"},...(d.statuses||[]).map(s=>({id:String(s.id),name:s.name}))];
  bar.appendChild(dd("상태", S.filters.status, stOpts, v=>{S.filters.status=v;S.offset=0;save();reqLoad();}));
  const asOpts=[{id:"me",name:"나"},{id:"all",name:"전체"},...(d.assignees||[]).map(a=>({id:String(a.id),name:a.name}))];
  bar.appendChild(dd("담당자", S.filters.assignee, asOpts, v=>{S.filters.assignee=v;S.offset=0;save();reqLoad();}));
  const rf=el("span","iconbtn","⟳"); rf.title="새로고침"; rf.onclick=()=>{S.offset=0;reqLoad();}; bar.appendChild(rf);
  const po=el("span","iconbtn","↗"); po.title="에디터 탭으로 열기"; po.onclick=()=>post({command:"popout"}); bar.appendChild(po);

  const content=document.getElementById("content"); content.innerHTML="";
  const grid=el("div","grid");
  grid.appendChild(issueTable(d));
  content.appendChild(grid);
  attachAside(content, issueAside());

  const foot=document.getElementById("foot"); foot.innerHTML="";
  const filtered=d.clientFiltered||!!S.filters._preset;
  const left=el("span"); left.textContent=d.rows.length+"건 표시 (총 "+d.totalCount+"건)"+(filtered?" · 필터 적용":"");
  if(d.hasMore){
    left.appendChild(document.createTextNode(" — "));
    const more=el("span","link","더 불러오기"); more.onclick=()=>{ S.offset=(d.offset||0)+50; save(); reqLoad(); }; left.appendChild(more);
  }
  foot.appendChild(left);
  foot.appendChild(el("span",null,"정렬: "+S.sort.col+(S.sort.dir==="asc"?" ↑":" ↓")));
  S.last.issues=d; save();
  if(S.selId) post({command:"selectIssue",id:S.selId});
}
function queueChip(label,n,filterKey,cls){
  const c=el("span","chip cchip"+(cls?" "+cls:""));
  c.appendChild(document.createTextNode(label)); c.appendChild(el("b",null,String(n||0)));
  if(S.filters._preset===filterKey) c.classList.add("sel");
  c.onclick=()=>applyPreset(filterKey); return c;
}
// 프리셋 기준선 = 내 열린 일감(서버), 세부(신규/진행/임박/지연)는 클라 필터. 토글식.
function applyPreset(key){
  const f=S.filters; f._preset=(f._preset===key)?"":key;
  f.assignee="me"; f.status="open"; f.search=""; S.offset=0; save(); reqLoad();
}
function presetPred(r){
  const p=S.filters._preset; if(!p) return true;
  if(p==="new") return r.cat==="new";
  if(p==="prog") return r.cat==="prog";
  if(p==="duefilter") return r.due.text.indexOf("D-")>=0;
  if(p==="latefilter") return r.due.text.indexOf("지연")>=0;
  return true;
}
function issueTable(d){
  const tbl=el("table");
  const cols=[["#","id"],["제목","subject"],["상태","status"],["우선순위","priority"],["담당자","assignee"],["진척도","done"],["예정일","due"],["갱신","updated"]];
  const thead=el("tr");
  cols.forEach(([label,key])=>{ const th=el("th",null,label+(S.sort.col===key?(S.sort.dir==="asc"?" ↑":" ↓"):"")); th.onclick=()=>{ if(S.sort.col===key)S.sort.dir=S.sort.dir==="asc"?"desc":"asc"; else{S.sort.col=key;S.sort.dir="asc";} save(); renderIssues(S.last.issues); }; thead.appendChild(th); });
  tbl.appendChild(thead);
  const shown=d.rows.filter(presetPred);
  const pinned=shown.filter(r=>r.mine&&r.cat==="prog");
  const rest=shown.filter(r=>!(r.mine&&r.cat==="prog"));
  sortRows(rest);
  if(pinned.length){ const g=el("tr","grp"); const td=el("td","","● 내 진행중 ("+pinned.length+")"); td.colSpan=8; g.appendChild(td); tbl.appendChild(g); sortRows(pinned); pinned.forEach(r=>tbl.appendChild(issueRow(r))); }
  rest.forEach(r=>tbl.appendChild(issueRow(r)));
  if(!shown.length){ const tr=el("tr"); const td=el("td","dim","결과 없음"); td.colSpan=8; tr.appendChild(td); tbl.appendChild(tr); }
  return tbl;
}
function sortRows(rows){
  const {col,dir}=S.sort; const k=dir==="asc"?1:-1;
  rows.sort((a,b)=>{
    let x=a[col],y=b[col];
    if(col==="due"){ x=a.due.text; y=b.due.text; }
    if(typeof x==="number"&&typeof y==="number") return (x-y)*k;
    return String(x).localeCompare(String(y))*k;
  });
}
function issueRow(r){
  const tr=el("tr","row"+(S.selId===r.id?" sel":""));
  tr.appendChild(el("td",null,"#"+r.id));
  const t=el("td"); const dot=el("span","st "+r.cat); t.appendChild(dot); t.appendChild(document.createTextNode(r.subject)); tr.appendChild(t);
  tr.appendChild(el("td",null,r.status));
  tr.appendChild(el("td",null,r.priority));
  tr.appendChild(el("td",null,r.assignee));
  const pg=el("td"); const bar=el("span","pg"); const i=el("i"); i.style.width=(r.done||0)+"%"; bar.appendChild(i); pg.appendChild(bar); tr.appendChild(pg);
  tr.appendChild(el("td",r.due.cls,r.due.text));
  tr.appendChild(el("td","dim",r.updated));
  tr.onclick=()=>{ S.selId=r.id; save(); post({command:"selectIssue",id:r.id}); document.querySelectorAll("tr.row").forEach(x=>x.classList.remove("sel")); tr.classList.add("sel"); };
  tr.ondblclick=()=>post({command:"open",id:r.id});
  tr.oncontextmenu=(e)=>{ e.preventDefault(); rowMenu(e,r.id); };
  hoverable(tr,(c)=>{
    const bl=el("div","brow");
    bl.appendChild(el("span","badge id","#"+r.id)); bl.appendChild(el("span","badge st "+r.cat,r.status)); if(r.priority)bl.appendChild(el("span","badge pr",r.priority));
    c.appendChild(bl);
    const t=el("div",null,r.subject); t.style.fontWeight="600"; c.appendChild(t);
    const meta=el("div","m",[r.project,r.assignee!=="—"?r.assignee:null].filter(Boolean).join(" · "));
    if(r.due.text!=="—") meta.appendChild(el("span",r.due.cls||null," · 예정 "+r.due.text));
    c.appendChild(meta);
    c.appendChild(el("div","m","진척 "+(r.done||0)+"% · 갱신 "+r.updated));
  });
  return tr;
}
function issueAside(){
  const a=el("div","aside"); a.id="issueAside";
  a.appendChild(el("div","dim","행을 선택하면 상세 표시"));
  return a;
}
function renderIssueDetail(dt){
  const a=document.getElementById("issueAside"); if(!a) return; a.innerHTML="";
  const bl=el("div","brow");
  bl.appendChild(el("span","badge id","#"+dt.id));
  bl.appendChild(el("span","badge st "+dt.cat,dt.status));
  if(dt.priority) bl.appendChild(el("span","badge pr",dt.priority));
  a.appendChild(bl);
  a.appendChild(el("h3",null,dt.subject));
  a.appendChild(el("div","m",dt.meta));
  if(dt.desc) a.appendChild(el("div","box",dt.desc));
  if(dt.comment) a.appendChild(el("div","m","최근 댓글 — "+dt.comment));
  const act=el("div"); act.style.marginTop="10px";
  act.appendChild(mkBtn("상세 열기",null,()=>post({command:"open",id:dt.id})));
  act.appendChild(mkBtn("↗","ghost",()=>post({command:"openInBrowser",id:dt.id})));
  a.appendChild(act);
}
// 간단 커스텀 우클릭 메뉴 (트리 컨텍스트 대응)
let menuEl=null;
function menuAt(e,items){
  closeMenu();
  const m=el("div"); m.style.cssText="position:fixed;z-index:50;background:var(--vscode-menu-background,var(--vscode-editorWidget-background));border:1px solid var(--vscode-menu-border,var(--vscode-panel-border));border-radius:4px;padding:4px 0;font-size:12px;box-shadow:0 2px 8px rgba(0,0,0,.4);";
  m.style.left=e.clientX+"px"; m.style.top=e.clientY+"px";
  items.forEach(([label,fn])=>{
    const it=el("div",null,label); it.style.cssText="padding:4px 16px;cursor:pointer;"; it.onmouseenter=()=>it.style.background="var(--vscode-list-hoverBackground)"; it.onmouseleave=()=>it.style.background=""; it.onclick=()=>{fn();closeMenu();}; m.appendChild(it);
  });
  document.body.appendChild(m); menuEl=m;
}
function rowMenu(e,id){
  menuAt(e,[["상세 열기",()=>post({command:"open",id})],["브라우저에서 열기",()=>post({command:"openInBrowser",id})],["상태 변경…",()=>post({command:"changeStatusPick",id})],["링크 복사",()=>post({command:"copyLink",id})]]);
}
function closeMenu(){ if(menuEl){ menuEl.remove(); menuEl=null; } }
document.addEventListener("click",closeMenu);

// hover 0.5초 리치 카드 — 카드 1개 재사용, 화면 경계 클램프, 스크롤 시 닫힘
let hcEl=null,hcTimer=null;
function hoverable(tr,build){
  tr.addEventListener("mouseenter",(e)=>{
    clearTimeout(hcTimer);
    hcTimer=setTimeout(()=>{
      if(!hcEl){ hcEl=el("div","hcard"); document.body.appendChild(hcEl); }
      hcEl.innerHTML=""; build(hcEl); hcEl.style.display="block";
      const r=tr.getBoundingClientRect();
      let x=e.clientX+12, y=r.bottom+4;
      if(x+hcEl.offsetWidth>window.innerWidth-8) x=Math.max(8,window.innerWidth-hcEl.offsetWidth-8);
      if(y+hcEl.offsetHeight>window.innerHeight-8) y=r.top-hcEl.offsetHeight-4;
      if(y<0) y=8;
      hcEl.style.left=x+"px"; hcEl.style.top=y+"px";
    },500);
  });
  tr.addEventListener("mouseleave",()=>{ clearTimeout(hcTimer); if(hcEl)hcEl.style.display="none"; });
}
document.addEventListener("scroll",()=>{ if(hcEl)hcEl.style.display="none"; },true);

// 프로젝트 계층 정렬 + 들여쓰기 라벨 (Redmine 웹 스타일). 부모가 안 보이는 고아=루트 취급.
function projTreeOpts(projects){
  const list=projects||[]; const byId=new Map(list.map(p=>[p.id,p]));
  const kids=new Map(); const roots=[];
  for(const p of list){
    const pid=p.parent&&byId.has(p.parent.id)?p.parent.id:null;
    if(pid==null) roots.push(p); else { if(!kids.has(pid)) kids.set(pid,[]); kids.get(pid).push(p); }
  }
  const out=[];
  const walk=(nodes,depth)=>{ nodes.slice().sort((a,b)=>a.name.localeCompare(b.name)).forEach(p=>{
    out.push({id:String(p.id),name:"　".repeat(depth)+(depth?"└ ":"")+p.name});
    walk(kids.get(p.id)||[],depth+1);
  }); };
  walk(roots,0); return out;
}

// ---- time ----
function renderTime(d){
  if(!S.chartMode) S.chartMode="bar"; // 구 state 호환
  const st0=document.getElementById("strip"); st0.className="bar strip"; st0.innerHTML=""; st0.appendChild(stripDesc());
  const bar=document.getElementById("bar"); bar.className="bar"; bar.innerHTML="";
  const uOpts=[{id:"me",name:"나"},{id:"all",name:"전체"},...(d.users||[]).map(u=>({id:String(u.id),name:u.name}))];
  bar.appendChild(dd("사용자", S.filters.assignee, uOpts, v=>{S.filters.assignee=v;save();reqLoad();}));
  const seg=el("span","seg");
  [["7","7일"],["14","14일"],["month","이번 달"]].forEach(([v,lbl])=>{ const s=el("span",S.filters.period===v?"on":null,lbl); s.onclick=()=>{S.filters.period=v;save();reqLoad();}; seg.appendChild(s); });
  bar.appendChild(seg);
  const cseg=el("span","seg");
  [["bar","바"],["line","라인"]].forEach(([v,lbl])=>{ const s=el("span",S.chartMode===v?"on":null,lbl); s.onclick=()=>{ S.chartMode=v; save(); if(S.last.time) renderTime(S.last.time); }; cseg.appendChild(s); }); // 같은 데이터 → 로컬 재렌더 (재조회 X)
  bar.appendChild(cseg);
  bar.appendChild(el("span","spacer"));
  const rf=el("span","iconbtn","⟳"); rf.onclick=()=>reqLoad(); bar.appendChild(rf);
  const po=el("span","iconbtn","↗"); po.title="에디터 탭"; po.onclick=()=>post({command:"popout"}); bar.appendChild(po);

  const content=document.getElementById("content"); content.innerHTML="";
  const left=el("div","grid"); left.style.cssText="padding:14px;display:flex;flex-direction:column;overflow:hidden;"; // 차트를 가용 높이에 맞춤
  if(d.error){ left.appendChild(el("div","dim","오류: "+d.error)); content.appendChild(left); return; }
  const stats=el("div","stats");
  stats.appendChild(statTile(fmtH(d.today),"오늘"));
  stats.appendChild(statTile(fmtH(d.total),"기간 합계"));
  stats.appendChild(statTile(fmtH(d.avg),"일평균"));
  left.appendChild(stats);
  if(d.truncated) left.appendChild(el("div","dim","⚠ 1,000건 초과 — 일부만 집계됨"));
  if(d.multi&&(d.series||[]).length){ const leg=el("div","legend"); d.series.forEach(se=>{ const li=el("div","li"); const sw=el("span","sw"); sw.style.background=seriesColor(se); li.appendChild(sw); li.appendChild(document.createTextNode(se.name)); leg.appendChild(li); }); left.appendChild(leg); }
  const wrap=el("div","chartwrap"); wrap.innerHTML=buildChart(d.days, S.chartMode, d.series, d.multi);
  const tip=el("div","tip"); wrap.appendChild(tip);
  wrap.querySelectorAll(".hit").forEach(r=>{
    r.addEventListener("mousemove",(ev)=>{ const u=r.getAttribute("data-user"); tip.textContent=r.getAttribute("data-date")+(u?" · "+u:"")+" · "+r.getAttribute("data-hours")+"시간"; tip.style.display="block"; const b=wrap.getBoundingClientRect(); tip.style.left=(ev.clientX-b.left+8)+"px"; tip.style.top=(ev.clientY-b.top-8)+"px"; });
    r.addEventListener("mouseleave",()=>tip.style.display="none");
  });
  left.appendChild(wrap);
  content.appendChild(left);

  const right=el("div","aside wide");
  const tbl=el("table"); const th=el("tr"); ["일자","일감","활동","코멘트","시간"].forEach((h,i)=>{const e=el("th",null,h); if(i===4)e.className="num"; th.appendChild(e);}); tbl.appendChild(th);
  if(!d.entries.length) { const tr=el("tr"); const td=el("td","dim","기록 없음"); td.colSpan=5; tr.appendChild(td); tbl.appendChild(tr); }
  for(const e of d.entries){
    const tr=el("tr");
    tr.appendChild(el("td",null,mmddLabel(e.date)));
    const idc=el("td"); if(e.issueId){ const a=el("span","link","#"+e.issueId); a.onclick=()=>post({command:"open",id:e.issueId}); idc.appendChild(a); } else idc.textContent="—"; tr.appendChild(idc);
    tr.appendChild(el("td",null,e.activity));
    tr.appendChild(el("td","dim",e.comments||"—"));
    tr.appendChild(el("td","num",fmtH(e.hours)));
    tbl.appendChild(tr);
  }
  right.appendChild(tbl);
  attachAside(content,right);
  document.getElementById("foot").innerHTML="";
  S.last.time=d; save();
}
function statTile(v,lbl){ const s=el("div","stat"); s.appendChild(el("b",null,v)); s.appendChild(el("span",null,lbl)); return s; }
function mmddLabel(iso){ return iso; }
function esc(v){ return String(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
// VS Code charts 팔레트 고정 순서 — 사용자 색은 등장순 colorIdx로 백엔드가 고정 배정
var CHART_PAL=["--vscode-charts-blue","--vscode-charts-yellow","--vscode-charts-green","--vscode-charts-purple","--vscode-charts-orange","--vscode-charts-red"];
var CHART_FB=["#4fa3ff","#e2c08d","#3fb950","#b180f0","#e0873c","#ff8f8f"];
function seriesColor(se){ if(se.other) return "var(--vscode-descriptionForeground,#888)"; var k=((se.colorIdx%6)+6)%6; return "var("+CHART_PAL[k]+","+CHART_FB[k]+")"; }
function buildChart(days, mode, series, multi){
  const line=mode==="line";
  const ser=(multi&&series&&series.length)?series:null;
  const W=Math.max(300, days.length*40), H=170,padL=26,padR=6,padT=16,padB=22;
  const plotW=W-padL-padR, plotH=H-padT-padB, baseY=padT+plotH;
  const n=days.length;
  // yMax: 단일=일 합계 최대, 멀티=시리즈 개별값 최대 (grouped/멀티라인 → 누적 아님)
  let maxH=1;
  if(ser) ser.forEach(se=>se.values.forEach(v=>{ if(v>maxH) maxH=v; }));
  else maxH=Math.max(1,...days.map(d=>d.hours));
  const yMax=maxH<=1?1:Math.ceil(maxH);
  const slot=plotW/n, gap=Math.max(2,slot*0.28), barW=slot-gap; const yFor=v=>baseY-(v/yMax)*plotH;
  const cx=i=>padL+i*slot+slot/2; // 라인 포인트 중앙 x
  let s='<svg viewBox="0 0 '+W+' '+H+'" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="소요시간 '+(line?"라인":"바")+' 차트">';
  for(const t of [0,yMax/2,yMax]){ const y=yFor(t); s+='<line class="grid" x1="'+padL+'" y1="'+y+'" x2="'+(W-padR)+'" y2="'+y+'"/>'; s+='<text class="ylab" x="'+(padL-4)+'" y="'+(y+3)+'" text-anchor="end">'+fmtH(t)+'</text>'; }

  if(ser){
    const k=ser.length;
    if(line){
      ser.forEach(se=>{ const col=seriesColor(se);
        const pts=se.values.map((v,i)=>cx(i)+','+yFor(v)).join(" ");
        s+='<polyline points="'+pts+'" style="fill:none;stroke:'+col+';stroke-width:2"/>';
        se.values.forEach((v,i)=>{ s+='<circle cx="'+cx(i)+'" cy="'+yFor(v)+'" r="2.5" style="fill:'+col+'"/>'; });
      });
      ser.forEach(se=>{ se.values.forEach((v,i)=>{ s+='<circle class="hit" cx="'+cx(i)+'" cy="'+yFor(v)+'" r="6" fill="transparent" data-date="'+days[i].date+'" data-user="'+esc(se.name)+'" data-hours="'+fmtH(v)+'"/>'; }); });
    } else {
      const sub=(slot-gap)/k, inner=Math.min(2,sub*0.25), bw=Math.max(1,sub-inner);
      days.forEach((d,i)=>{ ser.forEach((se,j)=>{ const v=se.values[i];
        const x=padL+i*slot+gap/2+j*sub+inner/2; const h=(v/yMax)*plotH; const topY=baseY-h; const r=Math.min(3,bw/2,h); const col=seriesColor(se);
        if(h>0.4) s+='<path style="fill:'+col+'" d="M'+x+','+baseY+' L'+x+','+(topY+r)+' Q'+x+','+topY+' '+(x+r)+','+topY+' L'+(x+bw-r)+','+topY+' Q'+(x+bw)+','+topY+' '+(x+bw)+','+(topY+r)+' L'+(x+bw)+','+baseY+' Z"/>';
        s+='<rect class="hit" x="'+(padL+i*slot+gap/2+j*sub)+'" y="'+padT+'" width="'+sub+'" height="'+plotH+'" fill="transparent" data-date="'+d.date+'" data-user="'+esc(se.name)+'" data-hours="'+fmtH(v)+'"/>';
      }); });
    }
    // x라벨 + 오늘 표시: 멀티는 시리즈별 대신 오늘 xlab 강조 + 그룹 총합 라벨(상단 고정) 1개
    days.forEach((d,i)=>{ const lx=cx(i);
      s+='<text class="xlab'+(d.isToday?' tod':'')+'" x="'+lx+'" y="'+(baseY+11)+'" text-anchor="middle">'+d.label+'</text>';
      if(d.isToday&&d.hours>0) s+='<text class="vlab" x="'+lx+'" y="'+(padT-4)+'" text-anchor="middle">'+fmtH(d.hours)+'</text>';
    });
    return s+'</svg>';
  }

  if(line){
    const pts=days.map((d,i)=>cx(i)+','+yFor(d.hours)).join(" ");
    s+='<polyline class="line" points="'+pts+'"/>';
    days.forEach((d,i)=>{ s+='<circle class="pt" cx="'+cx(i)+'" cy="'+yFor(d.hours)+'" r="3"/>'; });
  }
  days.forEach((d,i)=>{
    if(!line){
      const x=padL+i*slot+gap/2; const h=(d.hours/yMax)*plotH; const topY=baseY-h; const r=Math.min(4,barW/2,h);
      if(h>0.4) s+='<path class="bar" d="M'+x+','+baseY+' L'+x+','+(topY+r)+' Q'+x+','+topY+' '+(x+r)+','+topY+' L'+(x+barW-r)+','+topY+' Q'+(x+barW)+','+topY+' '+(x+barW)+','+(topY+r)+' L'+(x+barW)+','+baseY+' Z"/>';
    }
    const lx=line?cx(i):(padL+i*slot+gap/2+barW/2); // 라벨 x: 라인=점 중앙, 바=막대 중앙
    s+='<text class="xlab" x="'+lx+'" y="'+(baseY+11)+'" text-anchor="middle">'+d.label+'</text>';
    if(d.isToday&&d.hours>0) s+='<text class="vlab" x="'+lx+'" y="'+(yFor(d.hours)-6)+'" text-anchor="middle">'+fmtH(d.hours)+'</text>';
    s+='<rect class="hit" x="'+(padL+i*slot)+'" y="'+padT+'" width="'+slot+'" height="'+plotH+'" fill="transparent" data-date="'+d.date+'" data-hours="'+fmtH(d.hours)+'"/>';
  });
  return s+'</svg>';
}

// ---- commits ----
function renderCommits(d){
  const st0=document.getElementById("strip"); st0.className="bar strip"; st0.innerHTML=""; st0.appendChild(stripDesc());
  const bar=document.getElementById("bar"); bar.className="bar"; bar.innerHTML="";
  if((d.repos||[]).length>1) bar.appendChild(dd("저장소", String(d.repoIndex), d.repos.map((r,i)=>({id:String(i),name:r})), v=>{S.filters.repo=Number(v);S.filters.branch="";save();reqLoad();}));
  if((d.branches||[]).length) bar.appendChild(dd("⎇", d.branch, d.branches.map(b=>({id:b,name:b})), v=>{S.filters.branch=v;save();reqLoad();}));
  const search=el("input","search"); search.placeholder="커밋 검색 — 메시지 또는 #302"; search.value=S.filters.search;
  search.onkeydown=(e)=>{ if(e.key==="Enter"){ S.filters.search=search.value; save(); reqLoad(); } }; bar.appendChild(search);
  const cb=el("label","cb"); const box=el("input"); box.type="checkbox"; box.checked=S.filters.linkedOnly; box.onchange=()=>{S.filters.linkedOnly=box.checked;save();reqLoad();}; cb.appendChild(box); cb.appendChild(document.createTextNode("일감 연결만")); bar.appendChild(cb);
  bar.appendChild(el("span","spacer"));
  const rf=el("span","iconbtn","⟳"); rf.onclick=()=>reqLoad(); bar.appendChild(rf);
  const po=el("span","iconbtn","↗"); po.title="에디터 탭"; po.onclick=()=>post({command:"popout"}); bar.appendChild(po);

  const content=document.getElementById("content"); content.innerHTML="";
  if(!(d.repos||[]).length){ content.appendChild(el("div","pad dim","워크스페이스에 git 저장소 없음")); document.getElementById("foot").innerHTML=""; return; }
  const grid=el("div","grid");
  const tbl=el("table"); const th=el("tr"); ["해시","메시지","일감","작성자","날짜","변경"].forEach(h=>th.appendChild(el("th",null,h))); tbl.appendChild(th);
  // 작업 중 변경 고정 행
  const w=d.working; const wip=el("tr","wip");
  wip.appendChild(el("td","dim","●"));
  wip.appendChild(el("td",null,"작업 중 변경 ("+w.fileCount+"개 파일)"));
  const wc=el("td"); const link=el("button","btn ghost","# 일감 연결…"); link.style.cssText="font-size:10px;padding:1px 8px;"; link.onclick=()=>post({command:"insertRef"}); wc.appendChild(link); wip.appendChild(wc);
  wip.appendChild(el("td","dim","—")); wip.appendChild(el("td","dim","지금"));
  wip.appendChild(changeCell(w.added,w.deleted,w.modified));
  wip.style.cursor="pointer"; wip.title="클릭하면 변경 파일 목록";
  wip.onclick=()=>{ S.selHash=null; save(); post({command:"selectWorking",repoPath:d.repoPath}); document.querySelectorAll("tr.row").forEach(x=>x.classList.remove("sel")); };
  tbl.appendChild(wip);

  for(const c of d.commits){
    const tr=el("tr","row"+(S.selHash===c.hash?" sel":""));
    tr.appendChild(el("td","dim",c.shortHash)); tr.firstChild.style.fontFamily="monospace";
    tr.appendChild(el("td",null,c.subject));
    const ic=el("td"); if(c.issueIds.length){ c.issueIds.forEach(id=>{ const ib=el("span","ib","#"+id); ib.onclick=(e)=>{e.stopPropagation();post({command:"open",id});}; ic.appendChild(ib); }); } else ic.className="dim",ic.textContent="—"; tr.appendChild(ic);
    tr.appendChild(el("td",null,c.author));
    tr.appendChild(el("td","dim",c.date));
    tr.appendChild(changeCell(c.added,c.deleted));
    tr.onclick=()=>{ S.selHash=c.hash; save(); post({command:"selectCommit",repoPath:d.repoPath,hash:c.hash,issueId:c.issueIds[0]}); document.querySelectorAll("tr.row").forEach(x=>x.classList.remove("sel")); tr.classList.add("sel"); };
    tr.oncontextmenu=(e)=>{ e.preventDefault(); commitMenu(e,d,c); };
    hoverable(tr,(cd)=>{
      const l1=el("div");
      l1.appendChild(el("span","who",c.author));
      l1.appendChild(el("span","m"," · "+c.date+" "));
      l1.appendChild(el("span","m abs","("+new Date(c.dateIso).toLocaleString()+")"));
      cd.appendChild(l1);
      const l2=el("div"); l2.style.fontFamily="monospace";
      l2.appendChild(el("span","dim",c.shortHash+"  "));
      l2.appendChild(el("span","ga","+"+c.added));
      l2.appendChild(el("span","gd"," −"+c.deleted));
      l2.appendChild(el("span","m"," ("+c.files+" files)"));
      cd.appendChild(l2);
      cd.appendChild(el("div","subj",c.subject));
      if(c.body) cd.appendChild(el("div","msg",c.body));
    });
    tbl.appendChild(tr);
  }
  grid.appendChild(tbl); content.appendChild(grid);
  const aside=el("div","aside wide"); aside.id="commitAside"; aside.appendChild(el("div","dim","커밋을 선택하면 상세 표시")); attachAside(content, aside);
  document.getElementById("foot").innerHTML=""; document.getElementById("foot").appendChild(el("span",null,d.commits.length+"개 커밋"));
  S.last.commits=d; save();
}
function changeCell(a,dn,mod){
  const td=el("td"); const chg=el("span","chg");
  const scale=v=>Math.max(v>0?2:0,Math.min(40,Math.round(v/4)));
  const ai=el("i","a"); ai.style.width=scale(a)+"px"; ai.style.height="7px";
  const di=el("i","d"); di.style.width=scale(dn)+"px"; di.style.height="7px";
  if(a)chg.appendChild(ai); if(dn)chg.appendChild(di); td.appendChild(chg);
  td.appendChild(el("span","ga","+"+a));
  if(mod!=null) td.appendChild(el("span","gm"," ~"+mod));
  td.appendChild(el("span","gd"," −"+dn));
  return td;
}
// 상태문자 색: 추가·신규=초록, 삭제=빨강, 그 외(M/R/C)=노랑
function stCls(s){ return (s==="A"||s==="?")?"ga":(s==="D"?"gd":"gm"); }
// 래퍼런스앱식 파일 행: [파일명 + 경로(dim)] [+n −n] [상태]
function fileRow(f,onDiff){
  const row=el("div","file");
  const fn=el("span","fn"); const idx=f.path.lastIndexOf("/");
  fn.appendChild(el("span",null,idx<0?f.path:f.path.slice(idx+1)));
  if(idx>0) fn.appendChild(el("span","dir",f.path.slice(0,idx)));
  fn.style.cursor="pointer"; fn.title="diff 열기"; fn.onclick=onDiff;
  row.appendChild(fn);
  const num=el("span","fnum");
  num.appendChild(el("span","ga","+"+(f.added||0)));
  num.appendChild(el("span","gd"," −"+(f.deleted||0)));
  row.appendChild(num);
  row.appendChild(el("span","fst "+stCls(f.status),f.status));
  return row;
}
// FILES CHANGED 헤더 + 필터 인풋 + 행 목록 (래퍼런스앱 FILES CHANGED 대응)
function fileList(a,title,files,rowFor){
  const fh=el("div","fh",title); fh.appendChild(el("span","cnt",String(files.length))); a.appendChild(fh);
  const flt=el("input","ffilter"); flt.placeholder="Filter files..."; a.appendChild(flt);
  const box=el("div"); a.appendChild(box);
  const draw=()=>{ box.innerHTML=""; const q=flt.value.toLowerCase();
    files.filter(f=>!q||f.path.toLowerCase().includes(q)).forEach(f=>box.appendChild(rowFor(f)));
    if(!files.length) box.appendChild(el("div","dim","변경 없음"));
  };
  flt.oninput=draw; draw();
}
function commitMenu(e,d,c){
  const items=[];
  if(c.issueIds.length) items.push(["일감 상세 열기 (#"+c.issueIds[0]+")",()=>post({command:"open",id:c.issueIds[0]})]);
  items.push(["원격 저장소에서 열기",()=>post({command:"openCommitRemote",repoPath:d.repoPath,hash:c.hash})]);
  if(d.hasRevision) items.push(["Redmine 리비전 열기",()=>post({command:"openCommitRevision",hash:c.hash})]);
  menuAt(e,items);
}
function renderCommitDetail(m){
  const a=document.getElementById("commitAside"); if(!a) return; a.innerHTML="";
  const d=S.last.commits; const c=(d&&d.commits||[]).find(x=>x.hash===m.hash);
  if(c){
    // 헤더: 아바타 + 작성자 + 상대시간
    const hd=el("div","cdhead");
    const ini=(c.author||"?").trim().split(/\s+/).map(w=>w[0]).join("").slice(0,2).toUpperCase();
    hd.appendChild(el("span","av",ini));
    hd.appendChild(el("span","who",c.author));
    hd.appendChild(el("span","dim",c.date));
    a.appendChild(hd);
    // 커밋 행: ◇sha + 브랜치 칩 + 색 스탯
    const cr=el("div","cdrow");
    const sh=el("span","dim","◇ "+c.shortHash); sh.style.fontFamily="monospace"; sh.style.cursor="pointer"; sh.title="SHA 복사"; sh.onclick=()=>post({command:"copyText",text:m.hash}); cr.appendChild(sh);
    if(d.branch) cr.appendChild(el("span","brchip","⎇ "+d.branch));
    cr.appendChild(el("span","spacer"));
    cr.appendChild(el("span","ga","+"+c.added));
    cr.appendChild(el("span","gm","✎"+c.files));
    cr.appendChild(el("span","gd","−"+c.deleted));
    a.appendChild(cr);
    // 메시지 박스 (제목 굵게 + 본문 + 복사)
    const mb=el("div","msgbox");
    mb.appendChild(el("div","subj",c.subject));
    if(c.body) mb.appendChild(el("div","body",c.body));
    const cp=el("span","cpy","⧉"); cp.title="메시지 복사"; cp.onclick=()=>post({command:"copyText",text:c.subject+(c.body?"\n\n"+c.body:"")}); mb.appendChild(cp);
    a.appendChild(mb);
    const act0=el("div"); act0.style.margin="0 0 4px";
    act0.appendChild(mkBtn("↗ 원격","ghost",()=>post({command:"openCommitRemote",repoPath:d.repoPath,hash:m.hash})));
    if(d.hasRevision) act0.appendChild(mkBtn("Redmine 리비전","ghost",()=>post({command:"openCommitRevision",hash:m.hash})));
    a.appendChild(act0);
  } else a.appendChild(el("h3",null,m.hash.slice(0,7)));
  fileList(a,"Files Changed",m.files,f=>fileRow(f,()=>post({command:"diffFile",repoPath:d.repoPath,hash:m.hash,file:f.path})));
  if(m.issue){ const card=el("div","card");
    card.appendChild(el("span","badge st "+m.issue.cat,m.issue.status)); const b=el("b","link","#"+m.issue.id); b.onclick=()=>post({command:"open",id:m.issue.id}); card.appendChild(b); card.appendChild(document.createTextNode(" "+m.issue.subject));
    if(m.issue.meta) card.appendChild(el("div","m",m.issue.meta));
    const act=el("div"); act.style.marginTop="6px"; act.appendChild(mkBtn("일감 상세",null,()=>post({command:"open",id:m.issue.id}))); card.appendChild(act);
    a.appendChild(card);
  }
}
function renderWorkingDetail(m){
  const a=document.getElementById("commitAside"); if(!a) return; a.innerHTML="";
  const d=S.last.commits;
  fileList(a,"작업 중 변경",m.files,f=>fileRow(f,()=>post({command:"diffWorkingFile",repoPath:d.repoPath,file:f.path,del:f.del})));
}

// ---- shared ui ----
function dd(label,value,opts,onchange){
  const wrap=el("span"); wrap.style.cssText="display:inline-flex;align-items:center;gap:3px;";
  wrap.appendChild(el("span","dim",label+":")); const sel=el("select");
  for(const o of opts){ const op=el("option",null,o.name); op.value=o.id; if(String(o.id)===String(value))op.selected=true; sel.appendChild(op); }
  sel.onchange=()=>onchange(sel.value); wrap.appendChild(sel); return wrap;
}
function mkBtn(text,cls,onclick){ const b=el("button","btn"+(cls?" "+cls:""),text); b.onclick=onclick; return b; }
// 그리드↔aside 세로 드래그 리사이즈. 폭은 S.asideW에 persist (레일 전환/재오픈 유지). 더블클릭=기본폭 복원.
function attachAside(content,aside){
  if(S.asideW) aside.style.width=S.asideW+"px";
  const h=el("div","rez"); h.title="드래그해서 폭 조절 · 더블클릭 복원";
  h.onpointerdown=(e)=>{
    e.preventDefault(); h.setPointerCapture(e.pointerId);
    const startX=e.clientX, startW=aside.getBoundingClientRect().width;
    document.body.style.userSelect="none";
    const move=(ev)=>{
      const max=Math.round((document.querySelector(".main").clientWidth)*0.6);
      const w=Math.max(220,Math.min(max,startW+(startX-ev.clientX))); // 왼쪽 드래그 → aside 확대
      aside.style.width=w+"px"; S.asideW=w;
    };
    const up=()=>{ document.removeEventListener("pointermove",move); document.removeEventListener("pointerup",up); document.body.style.userSelect=""; save(); };
    document.addEventListener("pointermove",move); document.addEventListener("pointerup",up);
  };
  h.ondblclick=()=>{ aside.style.width=""; S.asideW=null; save(); };
  content.appendChild(h); content.appendChild(aside);
}

window.addEventListener("message",(e)=>{
  const d=e.data;
  if(d.command==="error"){ document.getElementById("content").innerHTML='<div class="pad dim">오류: '+d.message+'</div>'; return; }
  if(d.command==="refresh"){ S.offset=0; reqLoad(); return; }
  if(d.command==="issueDetail"){ renderIssueDetail(d.detail); return; }
  if(d.command==="commitDetail"){ renderCommitDetail(d); return; }
  if(d.command==="workingDetail"){ renderWorkingDetail(d); return; }
  if(d.command!=="data") return;
  if(d.view!==S.view) return;
  if(!d.connected){ document.getElementById("strip").innerHTML=""; document.getElementById("bar").innerHTML=""; document.getElementById("foot").innerHTML=""; document.getElementById("content").innerHTML='<div class="pad dim">Redmine 연결 후 이용 (URL·API 키 설정)</div>'; return; }
  if(d.view==="issues"){
    // offset>0 = "더 불러오기" → 이전 페이지에 append (교체 아님). 필터 변경은 모두 offset=0 리셋.
    if(d.offset>0 && S.last.issues && S.last.issues.rows) d.rows=S.last.issues.rows.concat(d.rows);
    renderIssues(d);
  }
  else if(d.view==="time") renderTime(d);
  else if(d.view==="commits") renderCommits(d);
});
syncRail();
reqLoad();
</script>
</body>
</html>`;
}
