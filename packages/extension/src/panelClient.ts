// String.raw 필수: 웹뷰 JS의 \n·\d 등이 TS 템플릿 이스케이프로 소실되는 것 방지 (실제 SyntaxError 사고 이력)
export const panelClientJs = String.raw`const vscode = acquireVsCodeApi();
// 웹뷰 JS 에러 → 호스트 OutputChannel(출력 탭 "Redmine")로 표면화
window.onerror=function(msg,src,line,col,err){ try{ vscode.postMessage({command:"jsError",message:String(msg)+" @"+line+":"+col+(err&&err.stack?"\n"+err.stack:"")}); }catch(e){} };
window.addEventListener("unhandledrejection",function(e){ try{ vscode.postMessage({command:"jsError",message:"unhandledrejection: "+String(e.reason)}); }catch(x){} });
vscode.postMessage({command:"jsError",message:"[boot] webview script started"});
const FRESH = !vscode.getState(); // 신규 웹뷰 → 호스트 defaults로 필터 시드(최초 1회)
const S = vscode.getState() || {
  view:"issues",
  filters:{project:"",status:"open",assignee:"me",search:"",period:"7",repo:0,branch:"",linkedOnly:false},
  sort:{col:"updated",dir:"desc"}, offset:0, selId:null, selHash:null, asideW:null, chartMode:"bar", last:{}, seeded:false
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
const VIEW_DESC={issues:"일감 — 검색·필터 탐색, 행 클릭=상세, 우클릭=액션",time:"소요시간 — 기간·작업자별 작업시간 집계",commits:"커밋 — 워크스페이스 커밋 ↔ #일감 연결, 파일 클릭=diff",options:"옵션 — 표시·검색 기본값 (redmine.* 설정과 동기화)"};
function stripDesc(){ return el("span","vdesc",VIEW_DESC[S.view]||""); }
// 레일 배지(기한임박+지연 수). 빈 문자열=CSS :empty로 숨김. 값 0/undefined도 숨김.
function applyRailBadge(n){ const b=document.getElementById("railBadge"); if(b) b.textContent=n?String(n):""; }
function sortFromDefault(s){ if(s==="due") return {col:"due",dir:"asc"}; if(s==="priority") return {col:"priority",dir:"desc"}; return {col:"updated",dir:"desc"}; }
// 최초 로드 시 호스트 defaults를 필터에 시드. 값 변경 시 true 반환(재조회 필요) — 호출부가 렌더 대신 재로드.
function seedDefaults(df){
  S.seeded=true;
  const before=JSON.stringify([S.filters.assignee,S.filters.status,S.filters.linkedOnly,S.sort]);
  if(df.assignee) S.filters.assignee=df.assignee;
  if(df.status) S.filters.status=df.status;
  if(df.linkedOnly!=null) S.filters.linkedOnly=df.linkedOnly;
  if(df.sort) S.sort=sortFromDefault(df.sort);
  save();
  if(JSON.stringify([S.filters.assignee,S.filters.status,S.filters.linkedOnly,S.sort])!==before){ S.offset=0; reqLoad(); return true; }
  return false;
}

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
  if((d.branches||[]).length){ const bopts=d.branches.map(b=>({id:b,name:b})); bopts.push({id:"--all",name:"--all (그래프)"}); bar.appendChild(dd("⎇", d.branch, bopts, v=>{S.filters.branch=v;save();reqLoad();})); }
  const search=el("input","search"); search.placeholder="커밋 검색 — 메시지 또는 #302"; search.value=S.filters.search;
  search.onkeydown=(e)=>{ if(e.key==="Enter"){ S.filters.search=search.value; save(); reqLoad(); } }; bar.appendChild(search);
  const cb=el("label","cb"); const box=el("input"); box.type="checkbox"; box.checked=S.filters.linkedOnly; box.onchange=()=>{S.filters.linkedOnly=box.checked;save();reqLoad();}; cb.appendChild(box); cb.appendChild(document.createTextNode("일감 연결만")); bar.appendChild(cb);
  bar.appendChild(el("span","spacer"));
  const rf=el("span","iconbtn","⟳"); rf.onclick=()=>reqLoad(); bar.appendChild(rf);
  const po=el("span","iconbtn","↗"); po.title="에디터 탭"; po.onclick=()=>post({command:"popout"}); bar.appendChild(po);

  const content=document.getElementById("content"); content.innerHTML="";
  if(!(d.repos||[]).length){ content.appendChild(el("div","pad dim","워크스페이스에 git 저장소 없음")); document.getElementById("foot").innerHTML=""; return; }
  const grid=el("div","grid");
  // lane 그래프 컬럼: 전체 목록(비필터)일 때만 커밋에 graph 동봉 → 있으면 첫 컬럼 삽입. 컬럼 폭은 전 커밋 최대 lane수 기준 고정.
  const hasGraph=(d.commits||[]).some(c=>c.graph);
  let gw=0;
  if(hasGraph){ let gmax=0; for(const c of d.commits){ if(!c.graph)continue; const g=c.graph; const m=Math.max(g.lane,...(g.up||[]),...(g.down||[]),...(g.thru||[])); if(m>gmax)gmax=m; } gw=(gmax+1)*14+8; }
  const tbl=el("table"); if(hasGraph)tbl.className="graph";
  const th=el("tr"); (hasGraph?["",...["해시","메시지","일감","작성자","날짜","변경"]]:["해시","메시지","일감","작성자","날짜","변경"]).forEach(h=>th.appendChild(el("th",null,h))); tbl.appendChild(th);
  // 작업 중 변경 고정 행
  const w=d.working; const wip=el("tr","wip");
  if(hasGraph) wip.appendChild(el("td","g"));
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
    if(hasGraph){ const gtd=el("td","g"); if(c.graph) gtd.innerHTML=graphCell(c.graph,gw); tr.appendChild(gtd); }
    const htd=el("td","dim",c.shortHash); htd.style.fontFamily="monospace"; tr.appendChild(htd);
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
// 행별 자족 lane SVG: thru=관통 수직선, up=상단→점(중앙) 수렴, down=점→하단 부모 분기, 점=자기 lane. 색=lane%4.
var GL=["--gl0","--gl1","--gl2","--gl3"];
function laneColor(l){ return "var("+GL[((l%4)+4)%4]+")"; }
function graphCell(g,w){
  var H=30, mid=15, cx=function(l){ return l*14+8; };
  var s='<svg width="'+w+'" height="'+H+'" viewBox="0 0 '+w+' '+H+'">';
  (g.thru||[]).forEach(function(t){ s+='<line x1="'+cx(t)+'" y1="0" x2="'+cx(t)+'" y2="'+H+'" stroke="'+laneColor(t)+'" stroke-width="1.5"/>'; });
  (g.up||[]).forEach(function(i){
    if(i===g.lane) s+='<line x1="'+cx(i)+'" y1="0" x2="'+cx(g.lane)+'" y2="'+mid+'" stroke="'+laneColor(i)+'" stroke-width="1.5"/>';
    else s+='<path d="M'+cx(i)+' 0 C'+cx(i)+' '+mid+', '+cx(g.lane)+' 0, '+cx(g.lane)+' '+mid+'" fill="none" stroke="'+laneColor(i)+'" stroke-width="1.5"/>';
  });
  (g.down||[]).forEach(function(o){
    if(o===g.lane) s+='<line x1="'+cx(g.lane)+'" y1="'+mid+'" x2="'+cx(o)+'" y2="'+H+'" stroke="'+laneColor(o)+'" stroke-width="1.5"/>';
    else s+='<path d="M'+cx(g.lane)+' '+mid+' C'+cx(g.lane)+' '+H+', '+cx(o)+' '+mid+', '+cx(o)+' '+H+'" fill="none" stroke="'+laneColor(o)+'" stroke-width="1.5"/>';
  });
  s+='<circle cx="'+cx(g.lane)+'" cy="'+mid+'" r="4" fill="'+laneColor(g.lane)+'"/>';
  return s+'</svg>';
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

// ---- options ----
function renderOptions(d){
  const o=d.options||{};
  const strip=document.getElementById("strip"); strip.className=""; strip.innerHTML="";
  const bar=document.getElementById("bar"); bar.className="bar"; bar.innerHTML=""; bar.appendChild(stripDesc());
  document.getElementById("foot").innerHTML="";
  const content=document.getElementById("content"); content.innerHTML="";
  const opt=el("div","opt");
  opt.appendChild(el("h3",null,"표시"));
  opt.appendChild(toggleRow("사이드바 상단 '오늘 소요시간' 표시","내 일감 트리 위 스트립 — 끄면 트리만 표시",!!o.showTodayTime,v=>setOpt("sidebar.showTodayTime",v)));
  opt.appendChild(toggleRow("패널 탭 배지","기한 임박 + 지연 일감 수를 패널 탭에 표시",!!o.showBadge,v=>setOpt("panel.showBadge",v)));
  opt.appendChild(toggleRow("커밋 뷰: 일감 연결 커밋만 기본 표시","#번호 없는 커밋 숨김 (뷰에서 일시 전환 가능)",!!o.linkedOnly,v=>setOpt("commits.linkedOnly",v)));
  opt.appendChild(el("h3",null,"검색 기본값"));
  opt.appendChild(selectRow("기본 담당자",[["me","나"],["all","전체"]],o.defaultAssignee||"me",v=>setOpt("search.defaultAssignee",v)));
  opt.appendChild(selectRow("기본 상태",[["open","진행 중만"],["all","전체(완료 포함)"]],o.defaultStatus||"open",v=>setOpt("search.defaultStatus",v)));
  opt.appendChild(selectRow("기본 정렬",[["updated","수정일 ↓"],["due","기한 ↑"],["priority","우선순위 ↓"]],o.defaultSort||"updated",v=>setOpt("search.defaultSort",v)));
  opt.appendChild(el("div","ohint","설정은 VSCode 설정(redmine.*)에 저장 — settings.json과 양방향 동기화. 변경 즉시 반영."));
  content.appendChild(opt);
}
function setOpt(key,value){ post({command:"setOption",key,value}); }
function toggleRow(label,desc,on,onToggle){
  const row=el("div","orow"); const l=el("div","lbl"); l.appendChild(document.createTextNode(label));
  if(desc) l.appendChild(el("small",null,desc)); row.appendChild(l);
  const tg=el("div","tg"+(on?" on":"")); tg.onclick=()=>{ const nv=!tg.classList.contains("on"); tg.classList.toggle("on",nv); onToggle(nv); };
  row.appendChild(tg); return row;
}
function selectRow(label,opts,value,onChange){
  const row=el("div","orow"); row.appendChild(el("div","lbl",label));
  const sel=el("select"); for(const o of opts){ const op=el("option",null,o[1]); op.value=o[0]; if(o[0]===value)op.selected=true; sel.appendChild(op); }
  sel.onchange=()=>onChange(sel.value); row.appendChild(sel); return row;
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
  if(d.command==="switchView"){ if(d.view){ S.view=d.view; S.offset=0; S.selId=null; S.selHash=null; save(); syncRail(); showLoading(); reqLoad(); } return; }
  if(d.command==="issueDetail"){ renderIssueDetail(d.detail); return; }
  if(d.command==="commitDetail"){ renderCommitDetail(d); return; }
  if(d.command==="workingDetail"){ renderWorkingDetail(d); return; }
  if(d.command!=="data") return;
  if(d.view!==S.view) return;
  applyRailBadge(d.badge);
  if(FRESH && !S.seeded && d.defaults && seedDefaults(d.defaults)) return; // 시드로 필터 변경 → 재조회 대기(현 데이터 렌더 스킵)
  if(d.view==="options"){ renderOptions(d); return; } // 옵션은 인증 불필요 → connected 가드 이전
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
reqLoad();`;
