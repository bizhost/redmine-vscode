// .mcpb 번들 조립: manifest + 번들된 서버 → mcpb pack
import { cp, mkdir, rm } from "node:fs/promises";
import { execSync } from "node:child_process";

await rm("dist-mcpb", { recursive: true, force: true });
await mkdir("dist-mcpb/server", { recursive: true });
await cp("mcpb-manifest.json", "dist-mcpb/manifest.json");
await cp("dist/server.js", "dist-mcpb/server/index.js");

execSync("npx --yes @anthropic-ai/mcpb pack dist-mcpb redmine.mcpb", { stdio: "inherit" });
