import { sharedCss } from "./webviewShared";

// 일감 상세 웹뷰 <style> 내용. 패널 공용 규칙(input/button:hover/busy/spin)은 ${sharedCss}로 주입.
export const issueDetailCss = `  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 0 0 2em; margin: 0; }
  .dim, .meta { color: var(--vscode-descriptionForeground); }
  .meta { font-size: .9em; }
  code { font-family: var(--vscode-editor-font-family, monospace); }
  pre { white-space: pre-wrap; word-break: break-word; font-family: var(--vscode-font-family); margin: 0; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: .45em 1.1em; border-radius: 3px; cursor: pointer; font-size: .95em; }
${sharedCss}
  button.ghost { background: transparent; border: 1px solid var(--vscode-panel-border); color: var(--vscode-foreground); }
  button.ghost:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.15)); }
  button.sm { padding: .2em .6em; font-size: .85em; }
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

  .flash { position: fixed; top: .8em; left: 50%; transform: translateX(-50%); background: var(--vscode-button-background); color: var(--vscode-button-foreground); padding: .6em 1.6em; border-radius: 4px; font-weight: 600; box-shadow: 0 2px 8px rgba(0,0,0,.3); pointer-events: none; z-index: 10; animation: flashfade 2.2s ease forwards; }
  @keyframes flashfade { 0%,60% { opacity: 1; } 100% { opacity: 0; visibility: hidden; } }
  .chip { display: inline-block; margin: 0 .35em .3em 0; padding: .15em .6em; border-radius: 10px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); font-size: .85em; cursor: pointer; }
  .chip:hover { opacity: .75; }

  /* 이미지 라이트박스 */
  .lightbox { position: fixed; inset: 0; background: rgba(0,0,0,.82); display: flex; align-items: center; justify-content: center; z-index: 50; cursor: zoom-out; }
  .lightbox img { max-width: 90vw; max-height: 90vh; border-radius: 4px; box-shadow: 0 4px 24px rgba(0,0,0,.5); cursor: default; }
  .lb-close { position: fixed; top: .2em; right: .5em; font-size: 2em; line-height: 1; color: #fff; cursor: pointer; user-select: none; }`;

// 일감 상세 웹뷰 클라이언트 스크립트. String.raw — 브라우저 정규식/이스케이프 소실로 웹뷰 사망 방지.
// uploadsJson: render()가 넘기는 JSON.stringify(...).replace(...) 결과 (첨부 대기 파일명 목록).
export const issueDetailClientJs = (uploadsJson: string) => String.raw`    const vscode = acquireVsCodeApi();
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
    renderFiles(${uploadsJson});

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
    }`;
