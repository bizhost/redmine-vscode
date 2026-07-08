import * as vscode from "vscode";
import type { Issue, Journal, NamedRef, TimeEntryActivity, UpdateIssueChanges } from "@redmine-tools/core";

function esc(text: string | undefined | null): string {
  return (text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function options(items: NamedRef[], selectedId: number | undefined, emptyLabel?: string): string {
  const empty =
    emptyLabel !== undefined
      ? `<option value=""${selectedId === undefined ? " selected" : ""}>${esc(emptyLabel)}</option>`
      : "";
  return (
    empty +
    items
      .map(
        (item) =>
          `<option value="${item.id}"${item.id === selectedId ? " selected" : ""}>${esc(item.name)}</option>`,
      )
      .join("")
  );
}

const HIGH_PRIORITY = /높음|긴급|즉시|urgent|high|immediate/i;

export interface IssueDetailContext {
  issue: Issue;
  statuses: NamedRef[];
  priorities: NamedRef[];
  trackers: NamedRef[];
  assignees: NamedRef[];
  categories: NamedRef[];
  /** attachment id → data URI (이미지 미리보기) */
  previews: Record<number, string>;
  /** 상위/연결 일감 id → 제목 (표시용) */
  relatedSubjects: Record<number, string>;
  timeEntryActivities: TimeEntryActivity[];
  onUpdate: (changes: UpdateIssueChanges) => Promise<void>;
  uploadFile: (filename: string, data: Uint8Array) => Promise<string>;
  /** 소요시간 기록 (통합 제출 폼) */
  logTime: (hours: number, activityId: number | undefined, comments: string) => Promise<void>;
  // --- 아래는 extension.ts가 채워야 관람자 편집이 활성화됨 (미제공 시 목록만 표시) ---
  /** 현재 사용자 — 관람자 '나 추가/제거' 토글 대상 */
  currentUser?: NamedRef;
  /** 관람자 추가 — client.addWatcher(issueId, userId) */
  addWatcher?: (userId: number) => Promise<void>;
  /** 관람자 제거 — client.removeWatcher(issueId, userId) */
  removeWatcher?: (userId: number) => Promise<void>;
}

const RELATION_LABEL: Record<string, string> = {
  relates: "관련됨",
  duplicates: "중복함",
  duplicated: "중복됨",
  blocks: "차단함",
  blocked: "차단됨",
  precedes: "선행",
  follows: "후행",
  copied_to: "복사됨",
  copied_from: "복사본",
};

// journal detail attr name → 한글 라벨
const DETAIL_LABEL: Record<string, string> = {
  status_id: "상태",
  priority_id: "우선순위",
  tracker_id: "유형",
  assigned_to_id: "담당자",
  category_id: "범주",
  done_ratio: "진척도",
  subject: "제목",
  description: "설명",
  start_date: "시작일",
  due_date: "예정일",
  estimated_hours: "추정시간",
  fixed_version_id: "대상 버전",
  parent_id: "상위 일감",
};

// 통합 제출: 웹뷰 field 키 → UpdateIssueChanges 매핑
const num = (v: unknown): number | "" => (v === "" || v == null ? "" : Number(v));
function fieldsToChanges(fields: Record<string, unknown>): UpdateIssueChanges {
  const c: UpdateIssueChanges = {};
  if ("subject" in fields) c.subject = String(fields.subject ?? "");
  if ("description" in fields) c.description = String(fields.description ?? "");
  if ("status" in fields) c.statusId = Number(fields.status);
  if ("priority" in fields) c.priorityId = Number(fields.priority);
  if ("tracker" in fields) c.trackerId = Number(fields.tracker);
  if ("assignee" in fields) c.assignedToId = num(fields.assignee);
  if ("category" in fields) c.categoryId = num(fields.category);
  if ("done" in fields) c.doneRatio = Number(fields.done);
  if ("start" in fields) c.startDate = String(fields.start ?? "");
  if ("due" in fields) c.dueDate = String(fields.due ?? "");
  if ("estimated" in fields) c.estimatedHours = fields.estimated === "" ? "" : Number(fields.estimated);
  return c;
}

export class IssueDetailPanel {
  private static panels = new Map<number, IssueDetailPanel>(); // 일감별 탭
  private ctx: IssueDetailContext;

  static show(ctx: IssueDetailContext): void {
    const existing = IssueDetailPanel.panels.get(ctx.issue.id);
    if (existing) {
      existing.ctx = ctx;
      existing.render();
      existing.panel.reveal();
      return;
    }
    IssueDetailPanel.panels.set(ctx.issue.id, new IssueDetailPanel(ctx));
  }

  static update(issue: Issue): void {
    const panel = IssueDetailPanel.panels.get(issue.id);
    if (panel) {
      panel.ctx.issue = issue;
      panel.render();
    }
  }

  private readonly panel: vscode.WebviewPanel;
  private pendingFlash: string | undefined; // 다음 render에 표시할 성공 배너
  private pendingUploads: Array<{ name: string; data: Uint8Array }> = []; // 댓글 첨부 대기

  private constructor(ctx: IssueDetailContext) {
    this.ctx = ctx;
    this.panel = vscode.window.createWebviewPanel(
      "redmineIssue",
      `#${ctx.issue.id}`,
      vscode.ViewColumn.One,
      { enableScripts: true },
    );
    this.panel.onDidDispose(() => {
      IssueDetailPanel.panels.delete(this.ctx.issue.id);
    });
    this.panel.webview.onDidReceiveMessage((msg: Record<string, unknown>) => this.onMessage(msg));
    this.render();
  }

  private async onMessage(msg: Record<string, unknown>): Promise<void> {
    try {
      switch (msg.command) {
        case "submit":
          await this.submit(msg);
          break;
        case "pickFiles": {
          const picked = await vscode.window.showOpenDialog({ canSelectMany: true, openLabel: "첨부" });
          for (const uri of picked ?? []) {
            this.pendingUploads.push({
              name: uri.path.split("/").pop() ?? "file",
              data: await vscode.workspace.fs.readFile(uri),
            });
          }
          this.postFiles();
          break;
        }
        case "removeFile":
          this.pendingUploads.splice(Number(msg.index), 1);
          this.postFiles();
          break;
        case "pasteImage":
          // 클립보드 이미지 → base64 → 첨부 대기열
          this.pendingUploads.push({
            name: String(msg.name),
            data: new Uint8Array(Buffer.from(String(msg.base64), "base64")),
          });
          this.postFiles();
          break;
        case "open":
          void vscode.commands.executeCommand("redmine.openIssue", Number(msg.id));
          break;
        case "refresh":
          // 전체 재조회 + 재렌더 (openIssue가 같은 탭 재사용)
          void vscode.commands.executeCommand("redmine.openIssue", this.ctx.issue.id);
          break;
        case "openInBrowser":
          void vscode.commands.executeCommand("redmine.openIssueInBrowser", {
            issueId: this.ctx.issue.id,
          });
          break;
        case "openExternal":
          // 이미지 우클릭 → 원본 첨부 URL 브라우저에서 열기
          if (typeof msg.url === "string") void vscode.env.openExternal(vscode.Uri.parse(msg.url));
          break;
        case "addWatcherPick":
          await this.addWatcherPick();
          break;
        case "removeWatcher":
          await this.changeWatcher(Number(msg.userId), false, "관람자 제거됨 ✓");
          break;
        case "toggleSelfWatcher":
          await this.toggleSelfWatcher();
          break;
      }
    } catch (err) {
      this.pendingFlash = undefined;
      void this.panel.webview.postMessage({ command: "idle" }); // 버튼 복구
      vscode.window.showErrorMessage(`저장 실패: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** 통합 제출: 대기 속성 변경 + 댓글 + 첨부 = updateIssue 1회(저널 1건), 소요시간은 병행 */
  private async submit(msg: Record<string, unknown>): Promise<void> {
    const changes = fieldsToChanges((msg.fields as Record<string, unknown>) ?? {});
    const notes = String(msg.notes ?? "").trim();
    const hours = Number(msg.hours);
    const hasTime = Number.isFinite(hours) && hours > 0;
    const files = this.pendingUploads;
    const hasAttr = Object.keys(changes).length > 0;
    const hasComment = !!notes || files.length > 0;
    if (!hasAttr && !hasComment && !hasTime) return;

    // 1) 속성 + 댓글/첨부 통합 PUT — 실패는 outer catch("저장 실패")로
    if (hasAttr || hasComment) {
      this.pendingFlash = hasTime ? undefined : "제출됨 ✓"; // 시간도 있으면 아래에서 통합 flash
      const uploads = [];
      for (const f of files) {
        uploads.push({ token: await this.ctx.uploadFile(f.name, f.data), filename: f.name });
      }
      this.pendingUploads = []; // 성공 렌더 전 비움, 실패 시 복구
      try {
        await this.ctx.onUpdate({
          ...changes,
          notes: notes || undefined,
          privateNotes: msg.privateNotes === true,
          uploads,
        });
        // onUpdate → IssueDetailPanel.update → render (대기 상태 초기화 + flash 소비)
      } catch (err) {
        this.pendingUploads = files;
        throw err;
      }
    }

    // 2) 소요시간 (기존 로직) — 실패는 변경/댓글 성공과 구분해 별도 안내
    if (hasTime) {
      const activityId =
        msg.activityId === "" || msg.activityId == null ? undefined : Number(msg.activityId);
      try {
        await this.ctx.logTime(hours, activityId, notes);
      } catch (err) {
        this.pendingFlash = undefined;
        void this.panel.webview.postMessage({ command: "idle" });
        vscode.window.showErrorMessage(
          `소요시간 기록 실패${hasAttr || hasComment ? " (변경·댓글은 저장됨)" : ""}: ${err instanceof Error ? err.message : err}`,
        );
        return;
      }
      // 방금 기록한 hours만큼 낙관적 합산 → 재렌더 시 사이드바 소요시간 즉시 반영 (stale 방지).
      // 통합 제출 경로의 onUpdate 재조회는 시간 기록 이전 값이라 로컬 합산이 필요.
      this.ctx.issue.spent_hours = (this.ctx.issue.spent_hours ?? 0) + hours;
      if (this.ctx.issue.total_spent_hours != null) this.ctx.issue.total_spent_hours += hours;
      this.pendingFlash = hasAttr || hasComment ? "제출 · 소요시간 기록됨 ✓" : "소요시간 기록됨 ✓";
      this.render();
    }
  }

  /** [+ 추가] — 프로젝트 멤버(=assignees) 중 미등록자 QuickPick → addWatcher */
  private async addWatcherPick(): Promise<void> {
    if (!this.ctx.addWatcher) {
      vscode.window.showInformationMessage("관람자 추가는 확장 업데이트 후 사용 가능합니다");
      return;
    }
    const existing = new Set((this.ctx.issue.watchers ?? []).map((w) => w.id));
    const candidates = this.ctx.assignees.filter((a) => !existing.has(a.id));
    if (candidates.length === 0) {
      vscode.window.showInformationMessage("추가할 프로젝트 멤버가 없습니다");
      return;
    }
    const picked = await vscode.window.showQuickPick(
      candidates.map((c) => ({ label: c.name, id: c.id })),
      { placeHolder: "관람자로 추가할 멤버 선택" },
    );
    if (!picked) return;
    await this.ctx.addWatcher(picked.id);
    this.ctx.issue.watchers = [...(this.ctx.issue.watchers ?? []), { id: picked.id, name: picked.label }];
    this.postWatchers("관람자 추가됨 ✓"); // 목록만 in-place 갱신 (작성 중 댓글/시간/대기 편집 보존)
  }

  /** 관람자 추가/제거 후 로컬 낙관적 반영 (전체 재조회 회피) */
  private async changeWatcher(userId: number, add: boolean, flash: string): Promise<void> {
    const fn = add ? this.ctx.addWatcher : this.ctx.removeWatcher;
    if (!fn) return;
    await fn(userId);
    const cur = this.ctx.issue.watchers ?? [];
    if (add) {
      const name = this.ctx.currentUser?.id === userId ? this.ctx.currentUser.name : `user#${userId}`;
      if (!cur.some((w) => w.id === userId)) this.ctx.issue.watchers = [...cur, { id: userId, name }];
    } else {
      this.ctx.issue.watchers = cur.filter((w) => w.id !== userId);
    }
    this.postWatchers(flash); // 목록만 in-place 갱신 (작성 중 댓글/시간/대기 편집 보존)
  }

  private async toggleSelfWatcher(): Promise<void> {
    const me = this.ctx.currentUser;
    if (!me) return;
    const watching = (this.ctx.issue.watchers ?? []).some((w) => w.id === me.id);
    await this.changeWatcher(me.id, !watching, watching ? "관람자 해제됨 ✓" : "관람자 추가됨 ✓");
  }

  private postFiles(): void {
    void this.panel.webview.postMessage({
      command: "files",
      names: this.pendingUploads.map((f) => f.name),
    });
  }

  /** 관람자 목록만 in-place 갱신 (전체 render 회피 → 작성 중 편집 보존) */
  private postWatchers(flash?: string): void {
    void this.panel.webview.postMessage({ command: "watchers", html: this.watcherBoxHtml(), flash });
  }

  /** 관람자 섹션 내부 HTML — render()와 in-place 갱신이 공유. 제거 버튼은 inline onclick(innerHTML 주입 후에도 동작) */
  private watcherBoxHtml(): string {
    const watchers = this.ctx.issue.watchers ?? [];
    const canManage = !!(this.ctx.addWatcher && this.ctx.removeWatcher);
    const me = this.ctx.currentUser;
    const selfWatching = !!me && watchers.some((w) => w.id === me.id);
    const rows =
      watchers
        .map(
          (w) =>
            `<div class="wrow"><span>👁 ${esc(w.name)}</span>${canManage ? `<button class="wx" title="제거" onclick="vscode.postMessage({command:'removeWatcher',userId:${w.id}})">×</button>` : ""}</div>`,
        )
        .join("") || '<div class="dim">관람자 없음</div>';
    const actions = canManage
      ? `<div class="wactions"><button class="ghost sm" onclick="vscode.postMessage({command:'addWatcherPick'})">+ 추가</button>${
          me
            ? `<button class="ghost sm" onclick="vscode.postMessage({command:'toggleSelfWatcher'})">${selfWatching ? "나 제거" : "나 추가"}</button>`
            : ""
        }</div>`
      : '<div class="dim" style="font-size:.85em">관람자 편집은 확장 업데이트 후 가능</div>';
    return `<h2>관람자 (${watchers.length})</h2>${rows}${actions}`;
  }

  private render(): void {
    const { issue, statuses, priorities, trackers, assignees, categories } = this.ctx;
    const flash = this.pendingFlash;
    this.pendingFlash = undefined;
    this.panel.title = `#${issue.id} ${issue.subject}`;
    const highPriority = HIGH_PRIORITY.test(issue.priority?.name ?? "");
    const activityOptions = this.ctx.timeEntryActivities
      .map((a) => `<option value="${a.id}"${a.is_default ? " selected" : ""}>${esc(a.name)}</option>`)
      .join("");
    const canLogTime = this.ctx.timeEntryActivities.length > 0;

    const doneOptions = Array.from({ length: 11 }, (_, i) => i * 10)
      .map(
        (v) => `<option value="${v}"${v === (issue.done_ratio ?? 0) ? " selected" : ""}>${v}%</option>`,
      )
      .join("");

    const renderAttachment = (a: NonNullable<Issue["attachments"]>[number]): string => {
      const preview = this.ctx.previews[a.id];
      const label = `${esc(a.filename)} <span class="dim">(${fmtSize(a.filesize)})</span>`;
      if (preview) {
        return `<li class="att"><img class="lb" src="${preview}" data-url="${esc(a.content_url)}" alt="${esc(a.filename)}" title="클릭: 크게 보기 · 우클릭: 브라우저에서 열기"><div>${label}</div></li>`;
      }
      return `<li><a href="${esc(a.content_url)}">${esc(a.filename)}</a> <span class="dim">(${fmtSize(a.filesize)})</span></li>`;
    };
    const attachmentById = new Map((issue.attachments ?? []).map((a) => [a.id, a]));
    // 댓글(journal)에 첨부된 파일 id — side 컬럼(본문 첨부)에서 제외, 타임라인 해당 댓글에 표시
    const commentAttIds = new Set(
      (issue.journals ?? []).flatMap((j) =>
        (j.details ?? []).filter((d) => d.property === "attachment").map((d) => Number(d.name)),
      ),
    );
    const attachments = (issue.attachments ?? [])
      .filter((a) => !commentAttIds.has(a.id))
      .map(renderAttachment)
      .join("");

    const issueLink = (id: number, text: string): string =>
      `<a href="#" class="ilink" data-id="${id}">${esc(text)}</a>`;
    const subjectOf = (id: number): string => {
      const subject = this.ctx.relatedSubjects[id];
      return subject ? `#${id} ${subject}` : `#${id}`;
    };

    const parentHtml = issue.parent
      ? `<p class="meta">상위 일감: ${issueLink(issue.parent.id, subjectOf(issue.parent.id))}</p>`
      : "";

    const children = (issue.children ?? [])
      .map(
        (c) =>
          `<div class="rel-row"><span>↳ ${issueLink(c.id, `#${c.id} ${c.subject}`)}</span><span class="m">${esc(c.tracker?.name ?? "")}</span></div>`,
      )
      .join("");
    const relations = (issue.relations ?? [])
      .map((r) => {
        const otherId = r.issue_id === issue.id ? r.issue_to_id : r.issue_id;
        const label = RELATION_LABEL[r.relation_type] ?? r.relation_type;
        return `<div class="rel-row"><span>⇄ ${issueLink(otherId, subjectOf(otherId))}</span><span class="m">${esc(label)}</span></div>`;
      })
      .join("");
    const csRows = (issue.changesets ?? []).map((c) => {
      const when = esc(c.committed_on ?? "");
      return `<div class="rel-row"><span><code>${esc(c.revision.slice(0, 10))}</code> ${esc((c.comments ?? "").split("\n")[0])}</span><span class="m">${when}</span></div>`;
    });
    const CS_HEAD = 3; // 기본 노출 커밋 수, 초과분은 접기
    const changesets =
      csRows.length <= CS_HEAD
        ? csRows.join("")
        : csRows.slice(0, CS_HEAD).join("") +
          `<div id="cs-rest" class="hidden">${csRows.slice(CS_HEAD).join("")}</div>` +
          `<button class="togglebtn" id="cs-toggle" data-total="${csRows.length}" onclick="toggleCommits(this)">펼치기 (전체 ${csRows.length}건)</button>`;
    const relatedSection =
      children || relations || changesets
        ? `<div class="sec"><h2>하위 · 연결 일감 · 커밋</h2>${children}${relations}${changesets}</div>`
        : "";

    // --- 활동 타임라인 (댓글 + 속성 변경 통합, 최신순) ---
    const nameMap: Record<string, Map<string, string>> = {
      status_id: new Map(statuses.map((s) => [String(s.id), s.name])),
      priority_id: new Map(priorities.map((p) => [String(p.id), p.name])),
      tracker_id: new Map(trackers.map((t) => [String(t.id), t.name])),
      assigned_to_id: new Map(assignees.map((a) => [String(a.id), a.name])),
      category_id: new Map(categories.map((c) => [String(c.id), c.name])),
    };
    const fmtVal = (name: string, v: string | null | undefined): string => {
      if (v == null || v === "") return "없음";
      const m = nameMap[name];
      if (m) return m.get(String(v)) ?? String(v); // 목록에 없으면 원값 (삭제/이전 멤버)
      if (name === "done_ratio") return `${v}%`;
      if (name === "estimated_hours") return `${v}h`;
      return String(v);
    };
    const renderDetail = (d: NonNullable<Journal["details"]>[number]): string | null => {
      if (d.property === "attachment" || d.property === "relation") return null; // 첨부는 이미지로, 관계는 생략
      if (d.name === "description") return "설명 수정";
      const label = DETAIL_LABEL[d.name] ?? d.name;
      return `${esc(label)}: ${esc(fmtVal(d.name, d.old_value))} → ${esc(fmtVal(d.name, d.new_value))}`;
    };
    const events = (issue.journals ?? [])
      .slice()
      .reverse()
      .map((j) => {
        const changeLines = (j.details ?? [])
          .map(renderDetail)
          .filter((x): x is string => !!x);
        const journalAtts = (j.details ?? [])
          .filter((d) => d.property === "attachment" && d.new_value)
          .map((d) => attachmentById.get(Number(d.name)))
          .filter((a): a is NonNullable<typeof a> => !!a)
          .map(renderAttachment)
          .join("");
        const hasNote = !!j.notes;
        if (!hasNote && changeLines.length === 0 && !journalAtts) return "";
        return `
        <div class="ev${hasNote ? " c" : ""}" data-note="${hasNote ? "1" : "0"}">
          <div class="m">${esc(j.user?.name)} · ${esc(j.created_on)}</div>
          ${changeLines.length ? `<div class="chg">${changeLines.join(" · ")}</div>` : ""}
          ${hasNote ? `<div class="body"><pre>${esc(j.notes)}</pre></div>` : ""}
          ${journalAtts ? `<ul class="catts">${journalAtts}</ul>` : ""}
        </div>`;
      })
      .join("");
    // --- 소요시간 요약 (issue.spent_hours 있을 때만) ---
    const spent = issue.spent_hours;
    const est = issue.estimated_hours;
    const spentSection =
      spent == null && est == null
        ? ""
        : `<h2>소요시간</h2><div class="spent"><span><b>합계</b> ${spent ?? 0}h${est ? ` / 추정 ${est}h` : ""}</span>${
            est ? `<div class="bar"><span style="width:${Math.min(100, Math.round(((spent ?? 0) / est) * 100))}%"></span></div>` : ""
          }</div>`;

    // 예정일 D-day
    const dday = ((): string => {
      if (!issue.due_date) return "";
      const due = new Date(`${issue.due_date}T00:00:00`);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const diff = Math.round((due.getTime() - today.getTime()) / 86400000);
      if (!Number.isFinite(diff)) return "";
      const cls = diff < 0 ? "overdue" : diff <= 3 ? "soon" : "";
      return `<span class="dday ${cls}">${diff >= 0 ? `D-${diff}` : `D+${-diff}`}</span>`;
    })();

    const descRead = issue.description
      ? esc(issue.description)
      : '<span class="dim">(설명 없음)</span>';

    this.panel.webview.html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 0 0 2em; margin: 0; }
  .dim, .meta { color: var(--vscode-descriptionForeground); }
  .meta { font-size: .9em; }
  code { font-family: var(--vscode-editor-font-family, monospace); }
  pre { white-space: pre-wrap; word-break: break-word; font-family: var(--vscode-font-family); margin: 0; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: .45em 1.1em; border-radius: 3px; cursor: pointer; font-size: .95em; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.ghost { background: transparent; border: 1px solid var(--vscode-panel-border); color: var(--vscode-foreground); }
  button.ghost:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.15)); }
  button.sm { padding: .2em .6em; font-size: .85em; }
  input, select, textarea {
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 3px; padding: .35em;
    font-family: var(--vscode-font-family); box-sizing: border-box;
  }
  .hidden { display: none !important; }

  /* sticky 액션 바 */
  .sticky { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: .5em;
    padding: .5em 1.2em; background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
    border-bottom: 1px solid var(--vscode-panel-border); }
  .sticky .sp { flex: 1; }
  .badge { display: inline-block; border-radius: 10px; padding: .1em .7em; font-size: .82em; font-weight: 600; }
  .b-id { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  select.badge-select { border-radius: 10px; font-size: .82em; font-weight: 600; padding: .12em 1.4em .12em .7em; border: none; }
  select.b-st { background: var(--vscode-inputValidation-warningBackground, #7a5b0f); color: var(--vscode-inputValidation-warningForeground, #ffe9ad); }
  select.b-pri { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  select.b-pri.high { background: var(--vscode-inputValidation-errorBackground, #7a2222); color: var(--vscode-inputValidation-errorForeground, #ffc2c2); }
  .pending-count { color: var(--vscode-inputValidation-warningForeground, #e8a838); font-size: .85em; font-weight: 600; }

  .layout { display: flex; flex-wrap: wrap; gap: 0 2em; align-items: flex-start; padding: 0 1.2em; }
  .main { flex: 1 1 40em; max-width: 60em; min-width: 0; }
  .side { flex: 0 1 22em; min-width: 16em; }
  .sec { margin: 1em 0; }
  .sec + .sec { border-top: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); padding-top: 1em; }
  .togglebtn { display: block; background: none; border: none; color: var(--vscode-textLink-foreground); cursor: pointer; font-size: .85em; padding: .3em 0 0; }
  h2 { font-size: .78em; color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: .05em; margin: 1.3em 0 .5em; font-weight: 600; }
  .side h2:first-child, .main .sec:first-child h2 { margin-top: .8em; }
  #subject { width: 100%; font-size: 1.25em; font-weight: 600; margin: .7em 0 .2em; border: 1px dashed var(--vscode-input-border, var(--vscode-panel-border)); background: transparent; }

  /* 설명 */
  .desc-read { border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: .8em; white-space: pre-wrap; word-break: break-word; background: var(--vscode-textBlockQuote-background); min-height: 2em; }
  #description { width: 100%; min-height: 200px; resize: vertical; }
  .linkbtn { background: none; border: none; color: var(--vscode-textLink-foreground); cursor: pointer; font-size: .82em; padding: 0; float: right; text-transform: none; }

  /* 하위·연결 */
  .rel-row { display: flex; justify-content: space-between; gap: 1em; padding: .25em 0; font-size: .92em; border-bottom: 1px solid var(--vscode-panel-border); }
  .rel-row .m { color: var(--vscode-descriptionForeground); white-space: nowrap; }
  a.ilink { color: var(--vscode-textLink-foreground); text-decoration: none; }
  a.ilink:hover { text-decoration: underline; }

  /* 타임라인 */
  .seg { display: inline-flex; border: 1px solid var(--vscode-panel-border); border-radius: 3px; overflow: hidden; font-size: .8em; float: right; }
  .seg span { padding: .15em .7em; cursor: pointer; }
  .seg span.on { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .tl { border-left: 2px solid var(--vscode-panel-border); margin-left: .4em; padding-left: 1em; }
  .tl.notes-only .ev[data-note="0"] { display: none; }
  .ev { position: relative; margin-bottom: .9em; font-size: .92em; }
  .ev::before { content: ""; position: absolute; left: -1.32em; top: .35em; width: .55em; height: .55em; border-radius: 50%; background: var(--vscode-descriptionForeground); }
  .ev.c::before { background: var(--vscode-textLink-foreground); }
  .ev .m { color: var(--vscode-descriptionForeground); font-size: .82em; }
  .ev .chg { color: var(--vscode-descriptionForeground); font-style: italic; margin-top: .1em; }
  .ev .body { background: var(--vscode-editorWidget-background, var(--vscode-textBlockQuote-background)); border: 1px solid var(--vscode-panel-border); border-radius: 3px; padding: .4em .6em; margin-top: .25em; }
  ul.catts { padding-left: 0; margin: .3em 0 0; }
  li.att { list-style: none; margin: .5em 0; }
  li.att img { max-width: 100%; max-height: 240px; border-radius: 4px; border: 1px solid var(--vscode-panel-border); cursor: pointer; display: block; }

  /* 통합 제출 */
  .submit { margin-top: 1em; border-top: 1px solid var(--vscode-panel-border); padding-top: .8em; }
  #pending-summary:not(:empty) { border: 1px solid var(--vscode-inputValidation-warningBorder, #e8a838); border-radius: 4px; padding: .5em .7em; margin-bottom: .6em; }
  .pending-row { display: flex; justify-content: space-between; gap: 1em; font-size: .88em; padding: .12em 0; }
  .pending-row .pill-x { background: none; border: none; color: var(--vscode-descriptionForeground); cursor: pointer; padding: 0 .3em; font-size: 1em; }
  #notes { width: 100%; min-height: 4.5em; resize: vertical; }
  .row { display: flex; gap: .8em; align-items: center; margin-top: .5em; flex-wrap: wrap; }
  .timelog label { display: inline-flex; align-items: center; gap: .4em; font-size: .88em; color: var(--vscode-descriptionForeground); }
  #hours { width: 5em; }

  /* 사이드바 속성 */
  .props { display: grid; gap: .5em; }
  .props label { display: flex; flex-direction: column; gap: .2em; font-size: .82em; color: var(--vscode-descriptionForeground); }
  .props .dday { align-self: flex-start; }
  .dday { font-size: .82em; margin-left: .4em; }
  .dday.soon { color: var(--vscode-inputValidation-warningForeground, #e8a838); }
  .dday.overdue { color: var(--vscode-inputValidation-errorForeground, #f14c4c); font-weight: 600; }
  .spent { font-size: .9em; }
  .spent .bar { height: 5px; border-radius: 3px; background: var(--vscode-panel-border); margin-top: .3em; overflow: hidden; }
  .spent .bar span { display: block; height: 100%; background: var(--vscode-progressBar-background, var(--vscode-button-background)); }
  .wrow { display: flex; justify-content: space-between; align-items: center; font-size: .9em; padding: .15em 0; }
  .wrow .wx { background: none; border: none; color: var(--vscode-descriptionForeground); cursor: pointer; padding: 0 .3em; }
  .wactions { margin-top: .4em; display: flex; gap: .4em; }

  button.busy { opacity: .7; pointer-events: none; }
  button.busy::after { content: ""; display: inline-block; width: .8em; height: .8em; margin-left: .5em; border: 2px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: spin .8s linear infinite; vertical-align: -.1em; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .flash { position: fixed; top: .8em; left: 50%; transform: translateX(-50%); background: var(--vscode-button-background); color: var(--vscode-button-foreground); padding: .6em 1.6em; border-radius: 4px; font-weight: 600; box-shadow: 0 2px 8px rgba(0,0,0,.3); pointer-events: none; z-index: 10; animation: flashfade 2.2s ease forwards; }
  @keyframes flashfade { 0%,60% { opacity: 1; } 100% { opacity: 0; visibility: hidden; } }
  .chip { display: inline-block; margin: 0 .35em .3em 0; padding: .15em .6em; border-radius: 10px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); font-size: .85em; cursor: pointer; }
  .chip:hover { opacity: .75; }

  /* 이미지 라이트박스 */
  .lightbox { position: fixed; inset: 0; background: rgba(0,0,0,.82); display: flex; align-items: center; justify-content: center; z-index: 50; cursor: zoom-out; }
  .lightbox img { max-width: 90vw; max-height: 90vh; border-radius: 4px; box-shadow: 0 4px 24px rgba(0,0,0,.5); cursor: default; }
  .lb-close { position: fixed; top: .2em; right: .5em; font-size: 2em; line-height: 1; color: #fff; cursor: pointer; user-select: none; }
</style>
</head>
<body>
  ${flash ? `<div class="flash">${esc(flash)}</div>` : ""}
  <div class="sticky">
    <span class="badge b-id">#${issue.id}</span>
    <select id="status" class="badge-select b-st">${options(statuses, issue.status?.id)}</select>
    <select id="priority" class="badge-select b-pri${highPriority ? " high" : ""}">${options(priorities, issue.priority?.id)}</select>
    <span class="sp"></span>
    <span id="pending-count" class="pending-count"></span>
    <button class="ghost sm" onclick="vscode.postMessage({command:'refresh'})" title="새로고침">↻</button>
    <button class="ghost sm" onclick="vscode.postMessage({command:'openInBrowser'})" title="브라우저에서 열기">↗</button>
  </div>

  <div class="layout">
  <div class="main">
    <input id="subject" value="${esc(issue.subject)}">
    <p class="meta">${esc(issue.project?.name ?? "")} · 작성 ${esc(issue.author?.name ?? "-")}${issue.created_on ? " " + esc(issue.created_on) : ""} · 수정 ${esc(issue.updated_on ?? "-")}</p>
    ${parentHtml}

    <div class="sec">
      <h2>설명 <button class="linkbtn" id="desc-edit-btn" onclick="toggleDesc()">✏ 편집</button></h2>
      <div id="desc-read" class="desc-read">${descRead}</div>
      <textarea id="description" class="hidden">${esc(issue.description)}</textarea>
    </div>

    ${relatedSection}

    <div class="sec">
      <h2>활동 <span class="seg"><span id="seg-all" class="on" onclick="filterTl(false)">전체</span><span id="seg-notes" onclick="filterTl(true)">댓글만</span></span></h2>
      ${events ? `<div id="timeline" class="tl">${events}</div>` : '<p class="dim">활동 없음</p>'}
    </div>

    <div class="submit">
      <div id="pending-summary"></div>
      <textarea id="notes" placeholder="댓글 입력... (선택)"></textarea>
      <div id="files"></div>
      <div class="row timelog">
        ${
          canLogTime
            ? `<label>⏱ 소요시간 <input type="number" id="hours" min="0" step="0.25" placeholder="h"></label>
        <label>활동 <select id="activity">${activityOptions}</select></label>`
            : `<span class="dim">활동 목록을 불러올 수 없어 시간 기록 불가</span>`
        }
        <label><input type="checkbox" id="private"> 비공개</label>
      </div>
      <div class="row">
        <button onclick="submit(this)">확인 — 변경·댓글 제출</button>
        <button class="ghost" onclick="cancelAll()">취소</button>
        <button class="ghost" onclick="vscode.postMessage({command:'pickFiles'})">파일 첨부</button>
      </div>
    </div>
  </div>

  <div class="side">
    <h2>속성</h2>
    <div class="props">
      <label>유형 <select id="tracker">${options(trackers, issue.tracker?.id)}</select></label>
      <label>담당자 <select id="assignee">${options(assignees, issue.assigned_to?.id, "(없음)")}</select></label>
      <label>범주 <select id="category">${options(categories, issue.category?.id, "(없음)")}</select></label>
      <label>진척도 <select id="done">${doneOptions}</select></label>
      <label>시작일 <input type="date" id="start" value="${esc(issue.start_date)}"></label>
      <label>예정일 <input type="date" id="due" value="${esc(issue.due_date)}">${dday}</label>
      <label>추정시간 <input type="number" id="estimated" min="0" step="0.5" value="${issue.estimated_hours ?? ""}"></label>
    </div>
    ${spentSection}
    <div id="watchers-box">${this.watcherBoxHtml()}</div>
    ${attachments ? `<h2>첨부파일</h2><ul>${attachments}</ul>` : ""}
  </div>
  </div>

  <div id="lightbox" class="lightbox hidden"><span class="lb-close">×</span><img id="lightbox-img" alt=""></div>

  <script>
    const vscode = acquireVsCodeApi();
    const FIELD_LABELS = { subject:"제목", status:"상태", priority:"우선순위", tracker:"유형", assignee:"담당자", category:"범주", done:"진척도", start:"시작일", due:"예정일", estimated:"추정시간", description:"설명" };
    const FIELD_IDS = Object.keys(FIELD_LABELS);
    const controls = {}, original = {}, origText = {}, pending = {};
    const countEl = document.getElementById("pending-count");
    const summaryEl = document.getElementById("pending-summary");

    function ctrlText(el) {
      if (el.tagName === "SELECT") return el.options[el.selectedIndex] ? el.options[el.selectedIndex].text : el.value;
      return el.value;
    }
    function refreshPending() {
      const keys = Object.keys(pending);
      countEl.textContent = keys.length ? "● 변경 대기 " + keys.length + "건" : "";
      summaryEl.textContent = "";
      keys.forEach((id) => {
        const row = document.createElement("div");
        row.className = "pending-row";
        const span = document.createElement("span");
        span.textContent = id === "description"
          ? FIELD_LABELS[id] + ": 수정됨"
          : FIELD_LABELS[id] + ": " + origText[id] + " → " + ctrlText(controls[id]);
        const x = document.createElement("button");
        x.className = "pill-x"; x.textContent = "×"; x.title = "개별 취소";
        x.onclick = () => revert(id);
        row.appendChild(span); row.appendChild(x);
        summaryEl.appendChild(row);
      });
    }
    function markPriorityHigh() {
      const pr = controls.priority;
      if (!pr) return;
      pr.classList.toggle("high", /높음|긴급|즉시|urgent|high|immediate/i.test(ctrlText(pr)));
    }
    function onChange(id) {
      if (controls[id].value !== original[id]) pending[id] = true; else delete pending[id];
      if (id === "priority") markPriorityHigh();
      refreshPending();
    }
    function revert(id) {
      controls[id].value = original[id];
      delete pending[id];
      if (id === "priority") markPriorityHigh();
      refreshPending();
    }
    function cancelAll() {
      Object.keys(pending).forEach((id) => { controls[id].value = original[id]; });
      for (const k in pending) delete pending[k];
      // 설명 편집 종료
      const ta = document.getElementById("description");
      if (!ta.classList.contains("hidden")) toggleDesc();
      markPriorityHigh();
      refreshPending();
    }
    FIELD_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      controls[id] = el;
      original[id] = el.value;
      origText[id] = ctrlText(el);
      el.addEventListener(el.tagName === "SELECT" ? "change" : "input", () => onChange(id));
    });

    function toggleDesc() {
      const read = document.getElementById("desc-read");
      const ta = document.getElementById("description");
      const btn = document.getElementById("desc-edit-btn");
      const editing = !ta.classList.contains("hidden");
      if (editing) { ta.classList.add("hidden"); read.classList.remove("hidden"); btn.textContent = "✏ 편집"; }
      else { read.classList.add("hidden"); ta.classList.remove("hidden"); btn.textContent = "↩ 읽기"; ta.focus(); }
    }
    function filterTl(notesOnly) {
      const tl = document.getElementById("timeline");
      if (tl) tl.classList.toggle("notes-only", notesOnly);
      document.getElementById("seg-all").classList.toggle("on", !notesOnly);
      document.getElementById("seg-notes").classList.toggle("on", notesOnly);
    }
    function toggleCommits(btn) {
      const rest = document.getElementById("cs-rest");
      if (!rest) return;
      const hidden = rest.classList.toggle("hidden");
      btn.textContent = hidden ? "펼치기 (전체 " + btn.dataset.total + "건)" : "접기";
    }

    function busy(btn) { btn.classList.add("busy"); btn.disabled = true; }
    function showFlash(t) { const d = document.createElement("div"); d.className = "flash"; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 2300); }
    function renderFiles(names) {
      const el = document.getElementById("files");
      el.textContent = "";
      names.forEach((n, i) => {
        const chip = document.createElement("span");
        chip.className = "chip"; chip.textContent = n + " ✕"; chip.title = "제거";
        chip.onclick = () => vscode.postMessage({ command: "removeFile", index: i });
        el.appendChild(chip);
      });
    }
    renderFiles(${JSON.stringify(this.pendingUploads.map((f) => f.name)).replace(/</g, "\\u003c")});

    document.querySelectorAll("a.ilink").forEach((a) => {
      a.addEventListener("click", (e) => { e.preventDefault(); vscode.postMessage({ command: "open", id: Number(a.dataset.id) }); });
    });

    // 이미지 라이트박스: 클릭=확대 레이어, 우클릭=브라우저. previews는 원본 data URI라 재요청 불필요.
    const lb = document.getElementById("lightbox");
    const lbImg = document.getElementById("lightbox-img");
    function openLightbox(src) { lbImg.src = src; lb.classList.remove("hidden"); if (document.activeElement) document.activeElement.blur(); }
    function closeLightbox() { lb.classList.add("hidden"); lbImg.src = ""; }
    document.querySelectorAll("img.lb").forEach((im) => {
      im.addEventListener("click", () => openLightbox(im.src));
      im.addEventListener("contextmenu", (e) => { e.preventDefault(); vscode.postMessage({ command: "openExternal", url: im.dataset.url }); });
    });
    lb.addEventListener("click", (e) => { if (e.target === lb || e.target.classList.contains("lb-close")) closeLightbox(); });
    document.addEventListener("keydown", (e) => {
      if (lb.classList.contains("hidden")) return;
      e.stopPropagation(); e.preventDefault(); // 열림 중 키 입력이 편집 폼에 새지 않게 차단
      if (e.key === "Escape") closeLightbox();
    }, true);
    document.getElementById("notes").addEventListener("paste", (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (const item of items) {
        if (!item.type.startsWith("image/")) continue;
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const ext = (item.type.split("/")[1] || "png").replace("jpeg", "jpg").split("+")[0];
        const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
        const reader = new FileReader();
        reader.onload = () => {
          vscode.postMessage({ command: "pasteImage", name: "paste-" + ts + "." + ext, base64: String(reader.result).split(",")[1] });
        };
        reader.readAsDataURL(file);
      }
    });

    window.addEventListener("message", (e) => {
      if (e.data.command === "idle") {
        document.querySelectorAll("button").forEach((b) => { b.classList.remove("busy"); b.disabled = false; });
      } else if (e.data.command === "files") {
        renderFiles(e.data.names);
      } else if (e.data.command === "watchers") {
        const box = document.getElementById("watchers-box");
        if (box) box.innerHTML = e.data.html;
        if (e.data.flash) showFlash(e.data.flash);
      }
    });

    function submit(btn) {
      const fields = {};
      Object.keys(pending).forEach((id) => { fields[id] = controls[id].value; });
      const notes = document.getElementById("notes").value;
      const hoursEl = document.getElementById("hours");
      const actEl = document.getElementById("activity");
      const hasTime = hoursEl && parseFloat(hoursEl.value) > 0;
      const hasFiles = document.getElementById("files").childElementCount > 0;
      if (Object.keys(fields).length === 0 && !notes.trim() && !hasFiles && !hasTime) return;
      busy(btn);
      vscode.postMessage({
        command: "submit",
        fields,
        notes,
        privateNotes: document.getElementById("private").checked,
        hours: hoursEl ? hoursEl.value : "",
        activityId: actEl ? actEl.value : "",
      });
    }
  </script>
</body>
</html>`;
  }
}
