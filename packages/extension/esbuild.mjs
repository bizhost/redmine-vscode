import { build } from "esbuild";
import esbuildSvelte from "esbuild-svelte";

await build({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: "dist/extension.js",
  external: ["vscode"],
});

// 웹뷰 UI (브라우저 세계) — 패널별 entry 추가
await build({
  entryPoints: ["src/webviewUi/newIssue/main.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  outfile: "dist/webview/newIssue.js",
  mainFields: ["svelte", "browser", "module", "main"],
  conditions: ["svelte", "browser"],
  plugins: [esbuildSvelte({ compilerOptions: { css: "injected", runes: true } })],
});
