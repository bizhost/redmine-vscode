import * as vscode from "vscode";
import type { RedmineClient } from "@redmine-tools/core";
import { issueIdsForFile } from "./gitIssues";

const RECENT_KEY = "redmine.recentIssues";
const DAY = 86_400_000;

/** 최근 본 일감 기록 (최신순, 중복 제거, 5건) */
export function pushRecentIssue(context: vscode.ExtensionContext, id: number): void {
  const prev = context.globalState.get<number[]>(RECENT_KEY, []);
  const next = [id, ...prev.filter((x) => x !== id)].slice(0, 5);
  void context.globalState.update(RECENT_KEY, next);
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

// 사이드바 최상단 허브. 트리와 달리 요약/빠른 실행 중심 웹뷰
export class HomeView implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;

  constructor(
    private readonly getClient: () => Promise<RedmineClient | undefined>,
    private readonly context: vscode.ExtensionContext,
    private readonly notify: () => void,
  ) {}

  isVisible(): boolean {
    return this.view?.visible ?? false;
  }

  refresh(): void {
    void this.render();
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = buildHtml();
    view.webview.onDidReceiveMessage(async (msg: Record<string, unknown>) => {
      try {
        switch (msg.command) {
          case "ready":
            await this.render();
            break;
          case "open":
            void vscode.commands.executeCommand("redmine.openIssue", Number(msg.id));
            break;
          case "openInBrowser":
            void vscode.commands.executeCommand("redmine.openIssueInBrowser", {
              issueId: Number(msg.id),
            });
            break;
          case "changeStatus":
            await this.changeStatus(Number(msg.id), Number(msg.statusId));
            break;
          case "setUrl":
            void vscode.commands.executeCommand("workbench.action.openSettings", "redmine.url");
            break;
          case "run":
            void vscode.commands.executeCommand(String(msg.cmd));
            break;
        }
      } catch (err) {
        this.post({ command: "error", message: err instanceof Error ? err.message : String(err) });
      }
    });
  }

  private post(msg: unknown): void {
    void this.view?.webview.postMessage(msg);
  }

  private async changeStatus(id: number, statusId: number): Promise<void> {
    const client = await this.getClient();
    if (!client || !Number.isInteger(id) || !Number.isInteger(statusId)) return;
    await client.updateIssue(id, { statusId });
    this.notify(); // 트리 + 허브 갱신
  }

  private async render(): Promise<void> {
    if (!this.view) return;
    const url = vscode.workspace.getConfiguration("redmine").get<string>("url", "").trim();
    if (!url) {
      this.post({ command: "data", connected: false, reason: "unset" });
      return;
    }
    const client = await this.getClient();
    if (!client) {
      this.post({ command: "data", connected: false, reason: "auth" });
      return;
    }
    let host = url;
    try {
      host = new URL(url).host;
    } catch {
      /* URL 파싱 실패 → 원문 표시 */
    }

    try {
      const activeUri = vscode.window.activeTextEditor?.document.uri;
      const [user, page, gitIds] = await Promise.all([
        client.getCurrentUser().catch(() => undefined),
        client.listIssues({ assignedToMe: true, limit: 50 }),
        activeUri
          ? issueIdsForFile(activeUri).catch(() => [] as number[])
          : Promise.resolve([] as number[]),
      ]);

      // 카운트 — 내 일감 목록 1회 조회 기반
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const t0 = today.getTime();
      const in7 = t0 + 7 * DAY;
      const counts = { new: 0, prog: 0, dueSoon: 0, overdue: 0 };
      for (const i of page.issues) {
        if (/신규|new/i.test(i.status.name)) counts.new++;
        else counts.prog++;
        if (i.due_date) {
          const due = new Date(`${i.due_date}T00:00:00`).getTime();
          if (due < t0) counts.overdue++;
          else if (due <= in7) counts.dueSoon++;
        }
      }

      // 현재 작업 — 활성 파일 연관 일감 1건 (없으면 섹션 숨김)
      let currentWork: unknown;
      let statuses: { id: number; name: string }[] | undefined;
      if (gitIds.length) {
        const [issue, sts] = await Promise.all([
          client.getIssue(gitIds[0]).catch(() => undefined),
          client.listStatuses().catch(() => [] as { id: number; name: string }[]),
        ]);
        if (issue) {
          currentWork = {
            id: issue.id,
            subject: issue.subject,
            statusId: issue.status.id,
            meta: [issue.status?.name, issue.priority?.name].filter(Boolean).join(" · "),
          };
          statuses = sts.map((s) => ({ id: s.id, name: s.name }));
        }
      }

      const last = page.issues[0];
      this.post({
        command: "data",
        connected: true,
        host,
        account: user?.name,
        currentWork,
        statuses,
        counts,
        myCount: page.totalCount,
        recent: this.context.globalState.get<number[]>(RECENT_KEY, []),
        lastUpdated: last
          ? { id: last.id, subject: last.subject, rel: relTime(last.updated_on) }
          : undefined,
      });
    } catch {
      // 키 무효/네트워크 오류 → 인증 배너 폴백('API 키 입력' 복구)
      this.post({ command: "data", connected: false, reason: "auth" });
    }
  }
}

function buildHtml(): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<style>
  body{padding:0;margin:0;color:var(--vscode-foreground);font-family:var(--vscode-font-family);font-size:13px;}
  .sec{padding:10px 12px;border-bottom:1px solid var(--vscode-panel-border,var(--vscode-editorWidget-border));}
  .sec:last-child{border-bottom:none;}
  .h2{font-size:11px;color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;}
  .header{display:flex;gap:6px;flex-wrap:wrap;align-items:center;}
  .chip{display:inline-block;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);border:1px solid var(--vscode-contrastBorder,transparent);border-radius:10px;padding:1px 10px;font-size:11px;}
  .chip.on{color:var(--vscode-charts-green,#3fb950);border-color:var(--vscode-charts-green,#3fb950);background:transparent;}
  .cnt{display:flex;gap:6px;flex-wrap:wrap;}
  .cchip{cursor:pointer;}
  .cchip b{margin-left:5px;color:var(--vscode-foreground);}
  .cchip.due{border-color:var(--vscode-charts-yellow,#b8860b);}
  .cchip.late{border-color:var(--vscode-charts-red,#a03232);}
  .card{background:var(--vscode-editorWidget-background,var(--vscode-input-background));border:1px solid var(--vscode-panel-border,transparent);border-radius:4px;padding:8px 10px;}
  .card .t{font-weight:600;cursor:pointer;}
  .card .t:hover{color:var(--vscode-textLink-foreground);}
  .card .m{color:var(--vscode-descriptionForeground);font-size:11px;margin-top:2px;}
  .ctl{margin-top:6px;display:flex;gap:6px;align-items:center;}
  .row{display:flex;justify-content:space-between;padding:3px 0;font-size:12px;gap:8px;}
  .row.clk{cursor:pointer;}
  .row.clk:hover .m{color:var(--vscode-textLink-foreground);}
  .row .m{color:var(--vscode-descriptionForeground);text-align:right;overflow:hidden;text-overflow:ellipsis;}
  .link{color:var(--vscode-textLink-foreground);cursor:pointer;}
  .link:hover{text-decoration:underline;}
  .btnrow{display:flex;gap:6px;flex-wrap:wrap;}
  .btn{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:2px;padding:4px 10px;font-size:12px;cursor:pointer;font-family:inherit;}
  .btn:hover{background:var(--vscode-button-hoverBackground);}
  .btn.ghost{background:var(--vscode-button-secondaryBackground,transparent);color:var(--vscode-button-secondaryForeground,var(--vscode-foreground));border:1px solid var(--vscode-button-border,var(--vscode-panel-border));}
  .btn.ghost:hover{background:var(--vscode-button-secondaryHoverBackground,var(--vscode-list-hoverBackground));}
  .banner{background:var(--vscode-inputValidation-warningBackground,#3b2e12);border:1px solid var(--vscode-inputValidation-warningBorder,#6b5518);padding:10px 12px;font-size:12px;border-radius:3px;}
  .banner .btnrow{margin-top:8px;}
  select{background:var(--vscode-dropdown-background);color:var(--vscode-dropdown-foreground);border:1px solid var(--vscode-dropdown-border);font-size:11px;padding:2px;border-radius:2px;}
  .dim{color:var(--vscode-descriptionForeground);padding:10px 12px;}
</style>
</head>
<body>
  <div id="app"><div class="dim">불러오는 중...</div></div>
  <script>
    const vscode = acquireVsCodeApi();
    const app = document.getElementById("app");
    function el(tag, cls, text){ const e=document.createElement(tag); if(cls)e.className=cls; if(text!=null)e.textContent=text; return e; }
    function chip(text, cls){ return el("span","chip"+(cls?" "+cls:""),text); }
    function section(title){ const s=el("div","sec"); if(title)s.appendChild(el("div","h2",title)); return s; }
    function btn(text, cls, onclick){ const b=el("button","btn"+(cls?" "+cls:""),text); b.onclick=onclick; return b; }
    function run(cmd){ vscode.postMessage({command:"run", cmd}); }
    function row(label,val){ const r=el("div","row"); r.appendChild(el("span",null,label)); r.appendChild(el("span","m",val)); return r; }

    function countChip(label,n,cls){
      const c=el("span","chip cchip"+(cls?" "+cls:""));
      c.appendChild(document.createTextNode(label));
      c.appendChild(el("b",null,String(n||0)));
      c.onclick=()=>run("redmineMyIssues.focus");
      return c;
    }
    function rowRecent(ids){
      const r=el("div","row"); r.appendChild(el("span",null,"최근 본 일감"));
      const wrap=el("span","m");
      if(!ids||!ids.length){ wrap.textContent="없음"; }
      else ids.forEach((id,i)=>{
        const a=el("a","link","#"+id); a.onclick=()=>vscode.postMessage({command:"open",id});
        wrap.appendChild(a); if(i<ids.length-1)wrap.appendChild(document.createTextNode(", "));
      });
      r.appendChild(wrap); return r;
    }

    function renderBanner(reason){
      const s=el("div","sec");
      const b=el("div","banner");
      const auth = reason === "auth";
      b.appendChild(el("div",null, auth ? "인증에 실패했거나 서버 오류가 발생했습니다." : "Redmine 서버가 설정되지 않았습니다."));
      const rw=el("div","btnrow");
      const setUrl = ()=>btn("서버 URL 설정", auth?"ghost":null, ()=>vscode.postMessage({command:"setUrl"}));
      const setKey = ()=>btn("API 키 입력", auth?null:"ghost", ()=>run("redmine.setApiKey"));
      if(auth){ rw.appendChild(setKey()); rw.appendChild(setUrl()); }
      else { rw.appendChild(setUrl()); rw.appendChild(setKey()); }
      b.appendChild(rw); s.appendChild(b); app.appendChild(s);
    }

    function renderConnected(d){
      const head=el("div","sec header");
      head.appendChild(chip(d.host||""));
      if(d.account) head.appendChild(chip("● "+d.account,"on"));
      app.appendChild(head);

      if(d.currentWork){
        const cw=d.currentWork;
        const s=section("현재 작업");
        const card=el("div","card");
        const t=el("div","t","#"+cw.id+" "+cw.subject);
        t.onclick=()=>vscode.postMessage({command:"open", id:cw.id});
        card.appendChild(t);
        card.appendChild(el("div","m",cw.meta));
        const ctl=el("div","ctl");
        if(d.statuses&&d.statuses.length){
          const sel=el("select");
          for(const st of d.statuses){ const o=el("option",null,st.name); o.value=st.id; if(st.id===cw.statusId)o.selected=true; sel.appendChild(o); }
          sel.onchange=()=>vscode.postMessage({command:"changeStatus", id:cw.id, statusId:Number(sel.value)});
          ctl.appendChild(sel);
        }
        ctl.appendChild(btn("↗ 브라우저","ghost",()=>vscode.postMessage({command:"openInBrowser", id:cw.id})));
        card.appendChild(ctl); s.appendChild(card); app.appendChild(s);
      }

      const q=section("할 일 대기열");
      const cnt=el("div","cnt");
      cnt.appendChild(countChip("신규",d.counts.new));
      cnt.appendChild(countChip("진행",d.counts.prog));
      cnt.appendChild(countChip("기한임박",d.counts.dueSoon,"due"));
      cnt.appendChild(countChip("지연",d.counts.overdue,"late"));
      q.appendChild(cnt); app.appendChild(q);

      const ov=section("개요");
      ov.appendChild(rowRecent(d.recent));
      ov.appendChild(row("내 일감",(d.myCount||0)+"건"));
      if(d.lastUpdated){
        const r=row("최근 업데이트","#"+d.lastUpdated.id+" · "+d.lastUpdated.rel);
        r.classList.add("clk");
        r.onclick=()=>vscode.postMessage({command:"open", id:d.lastUpdated.id});
        ov.appendChild(r);
      }
      app.appendChild(ov);

      const qa=section("빠른 실행");
      const rw=el("div","btnrow");
      rw.appendChild(btn("+ 새 일감",null,()=>run("redmine.newIssue")));
      rw.appendChild(btn("# 번호로 열기","ghost",()=>run("redmine.openIssueByNumber")));
      rw.appendChild(btn("프로젝트","ghost",()=>run("redmineProjects.focus")));
      rw.appendChild(btn("⚙ API 키","ghost",()=>run("redmine.setApiKey")));
      qa.appendChild(rw); app.appendChild(qa);
    }

    window.addEventListener("message",(e)=>{
      const d=e.data;
      if(d.command==="error"){ app.textContent=""; app.appendChild(el("div","dim","오류: "+d.message)); return; }
      if(d.command!=="data") return;
      app.textContent="";
      if(!d.connected){ renderBanner(d.reason); return; }
      renderConnected(d);
    });
    vscode.postMessage({command:"ready"});
  </script>
</body>
</html>`;
}
