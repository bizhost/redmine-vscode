import * as vscode from "vscode";
import type { RedmineClient, TimeEntry } from "@redmine-tools/core";

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// 소요시간 패널 — 필터 · 오늘 스탯 · 최근 7일 바 차트(인라인 SVG) · 엔트리 테이블
export class TimeLogView implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private filter = "me"; // "me" | "all" | "<userId>"
  private knownUsers = new Map<number, string>(); // 조회된 엔트리 distinct 사용자 누적
  private generation = 0; // stale 응답 폐기용 요청 세대

  constructor(private readonly getClient: () => Promise<RedmineClient | undefined>) {}

  refresh(): void {
    void this.render();
  }

  /** URL/서버 변경 시 누적 사용자·필터 초기화 */
  resetUsers(): void {
    this.knownUsers.clear();
    this.filter = "me";
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = buildHtml();
    view.webview.onDidReceiveMessage(async (msg: Record<string, unknown>) => {
      try {
        if (msg.command === "ready") await this.render();
        else if (msg.command === "filter") {
          this.filter = String(msg.value);
          await this.render();
        } else if (msg.command === "open") {
          void vscode.commands.executeCommand("redmine.openIssue", Number(msg.id));
        }
      } catch (err) {
        this.post({ command: "error", message: err instanceof Error ? err.message : String(err) });
      }
    });
  }

  private post(msg: unknown): void {
    void this.view?.webview.postMessage(msg);
  }

  private async render(): Promise<void> {
    if (!this.view) return;
    const gen = ++this.generation; // 이 요청 세대
    const filter = this.filter; // 요청 시점 필터 캡처
    const client = await this.getClient();
    if (!client) {
      this.knownUsers.clear();
      this.filter = "me";
      if (gen === this.generation) this.post({ command: "data", connected: false });
      return;
    }
    const now = new Date();
    const to = ymd(now);
    const fromDate = new Date(now);
    fromDate.setDate(now.getDate() - 6);
    const from = ymd(fromDate);
    const userId = filter === "me" ? "me" : filter === "all" ? undefined : Number(filter);

    let result: { entries: TimeEntry[]; truncated: boolean };
    try {
      result = await client.listTimeEntries({ from, to, userId });
    } catch (err) {
      if (gen === this.generation) {
        this.post({ command: "error", message: err instanceof Error ? err.message : String(err) });
      }
      return;
    }
    if (gen !== this.generation) return; // 최신 요청이 아니면 폐기
    const entries = result.entries;
    for (const e of entries) if (e.user) this.knownUsers.set(e.user.id, e.user.name);

    const days: Array<{ date: string; label: string; hours: number; isToday: boolean }> = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const key = ymd(d);
      const hours = entries.filter((e) => e.spent_on === key).reduce((s, e) => s + (e.hours || 0), 0);
      days.push({
        date: key,
        label: `${d.getMonth() + 1}/${d.getDate()}`,
        hours: Math.round(hours * 100) / 100,
        isToday: i === 0,
      });
    }
    const today = days[days.length - 1].hours;

    const table = entries
      .slice()
      .sort((a, b) => (a.spent_on < b.spent_on ? 1 : a.spent_on > b.spent_on ? -1 : b.id - a.id))
      .map((e) => ({
        date: e.spent_on,
        issueId: e.issue?.id,
        activity: e.activity?.name ?? "",
        hours: e.hours,
      }));

    const users = [...this.knownUsers.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    this.post({
      command: "data",
      connected: true,
      filter,
      users,
      today,
      days,
      entries: table,
      truncated: result.truncated,
    });
  }
}

function buildHtml(): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<style>
  body { padding: 0; margin: 0; color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: 13px; }
  .sec { padding: 10px 12px; border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-widget-border)); }
  .sec:last-child { border-bottom: none; }
  select { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border); font-size: 12px; padding: 2px; border-radius: 2px; }
  .flt { display: flex; align-items: center; gap: 6px; }
  .flt label { color: var(--vscode-descriptionForeground); font-size: 11px; }
  .hero { display: flex; align-items: baseline; gap: 6px; }
  .hero .lbl { color: var(--vscode-descriptionForeground); font-size: 12px; }
  .hero .num { font-size: 30px; font-weight: 700; line-height: 1; }
  .hero .unit { color: var(--vscode-descriptionForeground); font-size: 13px; }
  .warn { margin-top: 6px; color: var(--vscode-editorWarning-foreground, var(--vscode-inputValidation-warningForeground, var(--vscode-descriptionForeground))); font-size: 11px; }
  .chartwrap { position: relative; }
  svg .grid { stroke: var(--vscode-widget-border, var(--vscode-panel-border)); stroke-width: 1; opacity: .6; }
  svg .bar { fill: var(--vscode-charts-blue); }
  svg .ylab, svg .xlab { fill: var(--vscode-descriptionForeground); font-size: 8px; }
  svg .vlab { fill: var(--vscode-foreground); font-size: 8px; font-weight: 600; }
  svg .hit { cursor: default; }
  .tip { position: absolute; display: none; pointer-events: none; z-index: 5;
    background: var(--vscode-editorWidget-background, var(--vscode-input-background));
    border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    color: var(--vscode-foreground); font-size: 11px; padding: 2px 6px; border-radius: 3px; white-space: nowrap; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; color: var(--vscode-descriptionForeground); font-weight: 400; font-size: 10px; text-transform: uppercase; padding: 2px 4px; border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-widget-border)); }
  td { padding: 3px 4px; border-bottom: 1px solid var(--vscode-panel-border, transparent); }
  td.num { text-align: right; }
  .ilink { color: var(--vscode-textLink-foreground); cursor: pointer; }
  .ilink:hover { text-decoration: underline; }
  h2 { font-size: 11px; color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: .05em; margin: 0 0 6px; }
  .dim { color: var(--vscode-descriptionForeground); padding: 10px 12px; }
</style>
</head>
<body>
  <div id="app"><div class="dim">불러오는 중...</div></div>
  <script>
    const vscode = acquireVsCodeApi();
    const app = document.getElementById("app");
    function el(tag, cls, text){ const e=document.createElement(tag); if(cls)e.className=cls; if(text!=null)e.textContent=text; return e; }
    function fmtH(h){ return (Math.round((h||0)*10)/10).toFixed(1); }

    function buildChart(days){
      const W=300,H=150,padL=26,padR=6,padT=14,padB=20;
      const plotW=W-padL-padR, plotH=H-padT-padB, baseY=padT+plotH;
      const n=days.length;
      const maxH=Math.max(1, ...days.map(d=>d.hours));
      const yMax=maxH<=1?1:Math.ceil(maxH);
      const slot=plotW/n, gap=Math.max(2, slot*0.28), barW=slot-gap;
      const yFor=v=>baseY-(v/yMax)*plotH;
      let s='<svg viewBox="0 0 '+W+' '+H+'" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="최근 7일 소요시간 바 차트">';
      for(const t of [0, yMax/2, yMax]){
        const y=yFor(t);
        s+='<line class="grid" x1="'+padL+'" y1="'+y+'" x2="'+(W-padR)+'" y2="'+y+'"/>';
        s+='<text class="ylab" x="'+(padL-4)+'" y="'+(y+3)+'" text-anchor="end">'+fmtH(t)+'</text>';
      }
      days.forEach((d,i)=>{
        const x=padL+i*slot+gap/2;
        const h=(d.hours/yMax)*plotH;
        const topY=baseY-h;
        const r=Math.min(4, barW/2, h);
        if(h>0.4){
          s+='<path class="bar" d="M'+x+','+baseY+' L'+x+','+(topY+r)+' Q'+x+','+topY+' '+(x+r)+','+topY+' L'+(x+barW-r)+','+topY+' Q'+(x+barW)+','+topY+' '+(x+barW)+','+(topY+r)+' L'+(x+barW)+','+baseY+' Z"/>';
        }
        s+='<text class="xlab" x="'+(x+barW/2)+'" y="'+(baseY+11)+'" text-anchor="middle">'+d.label+'</text>';
        if(d.isToday && d.hours>0){
          s+='<text class="vlab" x="'+(x+barW/2)+'" y="'+(topY-3)+'" text-anchor="middle">'+fmtH(d.hours)+'</text>';
        }
        s+='<rect class="hit" x="'+(padL+i*slot)+'" y="'+padT+'" width="'+slot+'" height="'+plotH+'" fill="transparent" data-date="'+d.date+'" data-hours="'+fmtH(d.hours)+'"/>';
      });
      s+='</svg>';
      return s;
    }

    function renderConnected(d){
      // 필터
      const fSec=el("div","sec");
      const flt=el("div","flt");
      flt.appendChild(el("label",null,"사용자"));
      const sel=el("select");
      sel.appendChild(new Option("나", "me"));
      sel.appendChild(new Option("전체", "all"));
      for(const u of d.users) sel.appendChild(new Option(u.name, String(u.id)));
      sel.value = d.filter;
      sel.onchange=()=>vscode.postMessage({command:"filter", value: sel.value});
      flt.appendChild(sel);
      fSec.appendChild(flt);
      app.appendChild(fSec);

      // 오늘 스탯
      const hSec=el("div","sec");
      const hero=el("div","hero");
      hero.appendChild(el("span","lbl","오늘"));
      hero.appendChild(el("span","num", fmtH(d.today)));
      hero.appendChild(el("span","unit","시간"));
      hSec.appendChild(hero);
      if(d.truncated) hSec.appendChild(el("div","warn","⚠ 1,000건 초과 — 일부만 집계됨"));
      app.appendChild(hSec);

      // 차트
      const cSec=el("div","sec");
      cSec.appendChild(el("h2",null,"최근 7일"));
      const wrap=el("div","chartwrap");
      wrap.innerHTML=buildChart(d.days);
      const tip=el("div","tip");
      wrap.appendChild(tip);
      wrap.querySelectorAll(".hit").forEach(r=>{
        r.addEventListener("mousemove",(ev)=>{
          tip.textContent = r.getAttribute("data-date") + " · " + r.getAttribute("data-hours") + "시간";
          tip.style.display="block";
          const box=wrap.getBoundingClientRect();
          tip.style.left=(ev.clientX-box.left+8)+"px";
          tip.style.top=(ev.clientY-box.top-8)+"px";
        });
        r.addEventListener("mouseleave",()=>{ tip.style.display="none"; });
      });
      cSec.appendChild(wrap);
      app.appendChild(cSec);

      // 테이블
      const tSec=el("div","sec");
      tSec.appendChild(el("h2",null,"엔트리 (최근 7일)"));
      if(!d.entries.length){ tSec.appendChild(el("div","dim","기록 없음")); }
      else {
        const tbl=el("table");
        const thead=el("tr");
        ["일자","일감","활동","시간"].forEach(h=>thead.appendChild(el("th",null,h)));
        tbl.appendChild(thead);
        for(const e of d.entries){
          const tr=el("tr");
          tr.appendChild(el("td",null,e.date));
          const idTd=el("td");
          if(e.issueId){ const a=el("span","ilink","#"+e.issueId); a.onclick=()=>vscode.postMessage({command:"open", id:e.issueId}); idTd.appendChild(a); }
          else idTd.textContent="-";
          tr.appendChild(idTd);
          tr.appendChild(el("td",null,e.activity));
          tr.appendChild(el("td","num", fmtH(e.hours)));
          tbl.appendChild(tr);
        }
        tSec.appendChild(tbl);
      }
      app.appendChild(tSec);
    }

    window.addEventListener("message",(e)=>{
      const d=e.data;
      if(d.command==="error"){ app.textContent=""; app.appendChild(el("div","dim","오류: "+d.message)); return; }
      if(d.command!=="data") return;
      app.textContent="";
      if(!d.connected){ app.appendChild(el("div","dim","Redmine 연결 후 이용 (URL·API 키 설정)")); return; }
      renderConnected(d);
    });
    vscode.postMessage({command:"ready"});
  </script>
</body>
</html>`;
}
