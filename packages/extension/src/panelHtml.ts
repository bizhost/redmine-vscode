import { panelClientJs } from "./panelClient";

export function buildHtml(): string {
  // String.raw: 웹뷰 JS의 \n·\d 등이 TS 템플릿 이스케이프로 소실되는 것 방지 (실제 SyntaxError 사고 이력)
  return String.raw`<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<style>
  :root{--nl:#4fa3ff;--pr:#e2b93d;--dn:#3fb950;--late:#ff8f8f;
    --gl0:var(--vscode-charts-blue,#4fa3ff);--gl1:var(--vscode-charts-green,#3fb950);--gl2:var(--vscode-charts-yellow,#e2b93d);--gl3:var(--vscode-charts-purple,#b180f0);}
  *{box-sizing:border-box;}
  body{margin:0;padding:0;color:var(--vscode-foreground);font-family:var(--vscode-font-family);font-size:13px;}
  .wrap{display:flex;height:100vh;}
  .rail{width:44px;flex:none;border-right:1px solid var(--vscode-panel-border,var(--vscode-widget-border));display:flex;flex-direction:column;align-items:center;padding:6px 0;gap:2px;}
  .rail span{position:relative;width:36px;height:36px;display:flex;align-items:center;justify-content:center;border-radius:5px;cursor:pointer;color:var(--vscode-descriptionForeground);}
  .rail span:hover{background:var(--vscode-list-hoverBackground);color:var(--vscode-foreground);}
  .rail span.on{background:var(--vscode-list-hoverBackground);color:var(--vscode-foreground);}
  .rail span.on::before{content:"";position:absolute;left:-6px;top:6px;bottom:6px;width:2px;background:var(--vscode-foreground);border-radius:1px;}
  .rail svg{width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:1.3;stroke-linecap:round;stroke-linejoin:round;}
  .rail hr{width:24px;border:none;border-top:1px solid var(--vscode-panel-border,var(--vscode-widget-border));margin:6px 0;}
  .rail .badge{position:absolute;top:2px;right:2px;min-width:14px;height:14px;border-radius:7px;background:var(--vscode-activityBarBadge-background);color:var(--vscode-activityBarBadge-foreground);font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 3px;margin:0;line-height:1;}
  .rail .badge:empty{display:none;}
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
  /* 옵션 뷰 */
  .opt{flex:1;overflow:auto;padding:18px 26px;max-width:640px;}
  .opt h3{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--vscode-descriptionForeground);margin:22px 0 10px;border-bottom:1px solid var(--vscode-panel-border,var(--vscode-widget-border));padding-bottom:6px;font-weight:600;}
  .opt h3:first-child{margin-top:0;}
  .orow{display:flex;align-items:center;gap:12px;padding:7px 0;}
  .orow .lbl{flex:1;}
  .orow .lbl small{display:block;color:var(--vscode-descriptionForeground);font-size:11px;}
  .tg{width:34px;height:18px;border-radius:9px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,var(--vscode-dropdown-border));position:relative;flex:none;cursor:pointer;}
  .tg::after{content:"";position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:var(--vscode-descriptionForeground);transition:left .1s;}
  .tg.on{background:var(--vscode-button-background);border-color:var(--vscode-button-background);}
  .tg.on::after{left:18px;background:var(--vscode-button-foreground);}
  .ohint{color:var(--vscode-descriptionForeground);font-size:11px;margin-top:20px;border-top:1px dashed var(--vscode-panel-border,var(--vscode-widget-border));padding-top:10px;}
  /* 커밋 lane 그래프 */
  table.graph tr{height:30px;}
  td.g{padding:0;vertical-align:top;}
  td.g svg{display:block;}
</style>
</head>
<body>
<div class="wrap">
  <div class="rail">
    <span data-view="issues" title="일감"><svg viewBox="0 0 18 18"><circle cx="3" cy="4.5" r=".9" fill="currentColor" stroke="none"/><path d="M6.5 4.5H16"/><circle cx="3" cy="9" r=".9" fill="currentColor" stroke="none"/><path d="M6.5 9H16"/><circle cx="3" cy="13.5" r=".9" fill="currentColor" stroke="none"/><path d="M6.5 13.5H16"/></svg><b class="badge" id="railBadge"></b></span>
    <span data-view="commits" title="커밋"><svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="3"/><path d="M1.5 9H6M12 9h4.5"/></svg></span>
    <span data-view="time" title="소요시간"><svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="6.8"/><path d="M9 5.5V9l2.6 1.8"/></svg></span>
    <div class="spacer"></div>
    <hr>
    <span data-view="options" title="옵션"><svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="2.4"/><path d="M9 1.8v2.4M9 13.8v2.4M1.8 9h2.4M13.8 9h2.4M3.9 3.9l1.7 1.7M12.4 12.4l1.7 1.7M14.1 3.9l-1.7 1.7M5.6 12.4l-1.7 1.7"/></svg></span>
  </div>
  <div class="main">
    <div id="strip"></div>
    <div class="bar" id="bar"></div>
    <div class="content" id="content"><div class="pad dim">불러오는 중...</div></div>
    <div class="foot" id="foot"></div>
  </div>
</div>
<script>
${panelClientJs}
</script>
</body>
</html>`;
}
