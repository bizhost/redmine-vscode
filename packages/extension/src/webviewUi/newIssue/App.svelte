<script lang="ts">
  import { post } from "../shared/vscodeApi";
  import type { NamedRef, NewIssueToExtension, NewIssueToWebview } from "../shared/messages";

  const init = window.__INIT__;
  const doneOptions = Array.from({ length: 11 }, (_, i) => i * 10);

  // 기본 프로젝트가 목록에 없으면 브라우저 기본 동작(첫 옵션)과 동일하게
  const initialProject =
    init.defaultProjectId != null && init.projects.some((p) => p.id === init.defaultProjectId)
      ? String(init.defaultProjectId)
      : init.projects[0]
        ? String(init.projects[0].id)
        : "";

  let projectId = $state(initialProject);
  let trackerId = $state("");
  let statusId = $state(init.statuses[0] ? String(init.statuses[0].id) : "");
  let priorityId = $state(init.priorities[0] ? String(init.priorities[0].id) : "");
  let subject = $state("");
  let description = $state("");
  let assigneeId = $state("");
  let categoryId = $state("");
  let parentIssueId = $state("");
  let startDate = $state("");
  let dueDate = $state("");
  let estimatedHours = $state("");
  let doneRatio = $state("0");
  let isPrivate = $state(false);

  let trackers = $state<NamedRef[]>([]);
  let assignees = $state<NamedRef[]>([]);
  let categories = $state<NamedRef[]>([]);
  let files = $state<string[]>([]);
  let busy = $state(false);
  let invalidId = $state("");

  let projectEl: HTMLSelectElement;
  let trackerEl: HTMLSelectElement;
  let subjectEl: HTMLInputElement;

  function loadProject() {
    post<NewIssueToExtension>({ command: "loadProject", projectId: Number(projectId) });
  }

  $effect(() => {
    const onMessage = (e: MessageEvent) => {
      const msg = e.data as NewIssueToWebview;
      if (msg.command === "projectData") {
        trackers = msg.trackers;
        assignees = msg.assignees;
        categories = msg.categories;
        // 기존 fill()과 동일: 트래커는 첫 항목, 담당자/범주는 (없음)으로 리셋
        trackerId = msg.trackers[0] ? String(msg.trackers[0].id) : "";
        assigneeId = "";
        categoryId = "";
      } else if (msg.command === "files") {
        files = msg.names;
      } else if (msg.command === "idle") {
        busy = false;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  });

  loadProject(); // 초기 프로젝트 데이터 (확장의 선제 projectData와 레이스 self-heal)

  function clearInvalid(id: string) {
    if (invalidId === id) invalidId = "";
  }

  function onPaste(e: ClipboardEvent) {
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
        post<NewIssueToExtension>({
          command: "pasteImage",
          name: `paste-${ts}.${ext}`,
          base64: String(reader.result).split(",")[1],
        });
      };
      reader.readAsDataURL(file);
    }
  }

  function create() {
    // 필수(프로젝트/유형/제목) 미입력 → 저장 차단 + 첫 미입력 필드 포커스·강조
    const required: Array<[string, HTMLElement | undefined, string]> = [
      ["project", projectEl, projectId],
      ["tracker", trackerEl, trackerId],
      ["subject", subjectEl, subject],
    ];
    for (const [id, el, value] of required) {
      if (!value.trim()) {
        invalidId = id;
        el?.focus();
        el?.scrollIntoView({ block: "center" });
        return;
      }
    }
    busy = true;
    post<NewIssueToExtension>({
      command: "create",
      projectId,
      trackerId,
      statusId,
      priorityId,
      subject,
      description,
      assignedToId: assigneeId,
      categoryId,
      parentIssueId,
      startDate,
      dueDate,
      estimatedHours,
      doneRatio,
      isPrivate,
    });
  }
</script>

<h1>새 일감 만들기</h1>
<div class="grid">
  <label class="req"
    ><span class="cap">프로젝트</span>
    <select
      bind:this={projectEl}
      bind:value={projectId}
      class:invalid={invalidId === "project"}
      onchange={() => {
        clearInvalid("project");
        loadProject();
      }}
    >
      {#each init.projects as p (p.id)}
        <option value={String(p.id)}>{p.name}</option>
      {/each}
    </select></label
  >
  <label class="req"
    ><span class="cap">유형</span>
    <select
      bind:this={trackerEl}
      bind:value={trackerId}
      class:invalid={invalidId === "tracker"}
      onchange={() => clearInvalid("tracker")}
    >
      {#each trackers as t (t.id)}
        <option value={String(t.id)}>{t.name}</option>
      {/each}
    </select></label
  >
  <label
    >상태
    <select bind:value={statusId}>
      {#each init.statuses as s (s.id)}
        <option value={String(s.id)}>{s.name}</option>
      {/each}
    </select></label
  >
  <label
    >우선순위
    <select bind:value={priorityId}>
      {#each init.priorities as p (p.id)}
        <option value={String(p.id)}>{p.name}</option>
      {/each}
    </select></label
  >
</div>
<label class="req"
  ><span class="cap">제목</span>
  <input
    id="subject"
    bind:this={subjectEl}
    bind:value={subject}
    class:invalid={invalidId === "subject"}
    oninput={() => clearInvalid("subject")}
  /></label
>
<div class="grid" style="margin-top:.8em">
  <label
    >담당자
    <select bind:value={assigneeId}>
      <option value="">(없음)</option>
      {#each assignees as a (a.id)}
        <option value={String(a.id)}>{a.name}</option>
      {/each}
    </select></label
  >
  <label
    >범주
    <select bind:value={categoryId}>
      <option value="">(없음)</option>
      {#each categories as c (c.id)}
        <option value={String(c.id)}>{c.name}</option>
      {/each}
    </select></label
  >
  <label>상위 일감 # <input type="number" min="1" bind:value={parentIssueId} /></label>
  <label>시작일 <input type="date" bind:value={startDate} /></label>
  <label>예정일 <input type="date" bind:value={dueDate} /></label>
  <label>추정시간 <input type="number" min="0" step="0.5" bind:value={estimatedHours} /></label>
  <label
    >진척도
    <select bind:value={doneRatio}>
      {#each doneOptions as v (v)}
        <option value={String(v)}>{v}%</option>
      {/each}
    </select></label
  >
  <label class="inline"><input type="checkbox" bind:checked={isPrivate} /> 비공개</label>
</div>
<label>설명 <textarea bind:value={description} placeholder="이미지 붙여넣기 가능" onpaste={onPaste}></textarea></label>
<div id="files" style="margin-top:.5em">
  {#each files as name, i (i)}
    <span
      class="chip"
      role="button"
      tabindex="0"
      onclick={() => post<NewIssueToExtension>({ command: "removeFile", index: i })}
      onkeydown={(e) => {
        if (e.key === "Enter") post<NewIssueToExtension>({ command: "removeFile", index: i });
      }}>{name} ✕</span
    >
  {/each}
</div>
<div class="row">
  <button class:busy disabled={busy} onclick={create}>저장</button>
  <button onclick={() => post<NewIssueToExtension>({ command: "pickFiles" })}>파일 첨부</button>
</div>

<style>
  :global(body) {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    padding: 0 1.5em 2em;
    max-width: 60em;
  }
  h1 { font-size: 1.2em; }
  select, textarea, input {
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 3px; padding: .35em;
    font-family: var(--vscode-font-family); box-sizing: border-box;
  }
  #subject { width: 100%; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(11em, 1fr)); gap: .7em; margin: .8em 0; }
  label { display: flex; flex-direction: column; gap: .25em; font-size: .85em; color: var(--vscode-descriptionForeground); }
  label.inline { flex-direction: row; align-items: center; gap: .4em; }
  textarea { width: 100%; min-height: 250px; resize: vertical; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: .45em 1.2em; border-radius: 3px; cursor: pointer; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.busy { opacity: .7; pointer-events: none; }
  button.busy::after {
    content: ""; display: inline-block; width: .8em; height: .8em; margin-left: .5em;
    border: 2px solid currentColor; border-top-color: transparent; border-radius: 50%;
    animation: spin .8s linear infinite; vertical-align: -.1em;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .row { display: flex; gap: 1em; align-items: center; margin-top: .8em; }
  .chip {
    display: inline-block; margin: 0 .35em .3em 0; padding: .15em .6em; border-radius: 10px;
    background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
    font-size: .85em; cursor: pointer;
  }
  .req { border-left: 2px solid var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground)); padding-left: .5em; }
  .req .cap::after { content: " *"; color: var(--vscode-errorForeground); }
  .invalid { outline: 2px solid var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground)); outline-offset: 1px; border-radius: 3px; }
</style>
