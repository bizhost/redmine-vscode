import * as vscode from "vscode";
import type { CreateIssueFields, Issue, NamedRef, Project } from "@redmine-tools/core";
import { randomBytes } from "node:crypto";
import type { NewIssueInit } from "./webviewUi/shared/messages";

export interface ProjectFormData {
  trackers: NamedRef[];
  assignees: NamedRef[];
  categories: NamedRef[];
}

export interface NewIssueContext {
  extensionUri: vscode.Uri;
  projects: Project[];
  statuses: NamedRef[];
  priorities: NamedRef[];
  defaultProjectId?: number;
  loadProjectData: (projectId: number) => Promise<ProjectFormData>;
  uploadFile: (filename: string, data: Uint8Array) => Promise<string>;
  onCreate: (fields: CreateIssueFields) => Promise<Issue>;
}

export class NewIssuePanel {
  private static current: NewIssuePanel | undefined;

  static show(ctx: NewIssueContext): void {
    if (NewIssuePanel.current) {
      NewIssuePanel.current.panel.reveal();
      return;
    }
    NewIssuePanel.current = new NewIssuePanel(ctx);
  }

  private readonly panel: vscode.WebviewPanel;
  private pendingUploads: Array<{ name: string; data: Uint8Array }> = [];

  private constructor(private readonly ctx: NewIssueContext) {
    this.panel = vscode.window.createWebviewPanel(
      "redmineNewIssue",
      "새 일감 만들기",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(ctx.extensionUri, "dist", "webview")],
      },
    );
    this.panel.onDidDispose(() => {
      NewIssuePanel.current = undefined;
    });
    this.panel.webview.onDidReceiveMessage(async (msg: Record<string, unknown>) => {
      try {
        if (msg.command === "loadProject") {
          const data = await this.ctx.loadProjectData(Number(msg.projectId));
          void this.panel.webview.postMessage({ command: "projectData", ...data });
        } else if (msg.command === "create") {
          await this.create(msg);
        } else if (msg.command === "pickFiles") {
          const picked = await vscode.window.showOpenDialog({ canSelectMany: true, openLabel: "첨부" });
          for (const uri of picked ?? []) {
            this.pendingUploads.push({
              name: uri.path.split("/").pop() ?? "file",
              data: await vscode.workspace.fs.readFile(uri),
            });
          }
          this.postFiles();
        } else if (msg.command === "removeFile") {
          this.pendingUploads.splice(Number(msg.index), 1);
          this.postFiles();
        } else if (msg.command === "pasteImage") {
          this.pendingUploads.push({
            name: String(msg.name),
            data: new Uint8Array(Buffer.from(String(msg.base64), "base64")),
          });
          this.postFiles();
        }
      } catch (err) {
        void this.panel.webview.postMessage({ command: "idle" });
        vscode.window.showErrorMessage(`실패: ${err instanceof Error ? err.message : err}`);
      }
    });
    this.render();
    if (ctx.defaultProjectId) {
      // 초기 프로젝트 데이터 로드
      void ctx.loadProjectData(ctx.defaultProjectId).then((data) =>
        this.panel.webview.postMessage({ command: "projectData", ...data }),
      );
    }
  }

  private async create(msg: Record<string, unknown>): Promise<void> {
    const num = (v: unknown): number | undefined => (v === "" || v == null ? undefined : Number(v));
    const uploads = [];
    for (const f of this.pendingUploads) {
      uploads.push({ token: await this.ctx.uploadFile(f.name, f.data), filename: f.name });
    }
    const created = await this.ctx.onCreate({
      projectId: Number(msg.projectId),
      subject: String(msg.subject ?? "").trim(),
      description: String(msg.description ?? "") || undefined,
      trackerId: num(msg.trackerId),
      statusId: num(msg.statusId),
      priorityId: num(msg.priorityId),
      assignedToId: num(msg.assignedToId),
      categoryId: num(msg.categoryId),
      parentIssueId: num(msg.parentIssueId),
      doneRatio: num(msg.doneRatio),
      startDate: String(msg.startDate ?? ""),
      dueDate: String(msg.dueDate ?? ""),
      estimatedHours: num(msg.estimatedHours),
      isPrivate: msg.isPrivate === true,
      uploads,
    });
    this.pendingUploads = [];
    vscode.window.showInformationMessage(`#${created.id} 생성됨`);
    this.panel.dispose();
    void vscode.commands.executeCommand("redmine.openIssue", created.id);
  }

  private postFiles(): void {
    void this.panel.webview.postMessage({
      command: "files",
      names: this.pendingUploads.map((f) => f.name),
    });
  }

  private render(): void {
    const { projects, statuses, priorities, defaultProjectId } = this.ctx;
    const init: NewIssueInit = {
      projects: projects.map((p) => ({ id: p.id, name: p.name })),
      statuses,
      priorities,
      defaultProjectId,
    };
    const webview = this.panel.webview;
    const nonce = randomBytes(16).toString("hex");
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.ctx.extensionUri, "dist", "webview", "newIssue.js"),
    );
    // Svelte 앱 셸 — UI/클라 로직은 src/webviewUi/newIssue. init은 nonce 인라인 JSON(패널 재표시 시에도 생존).
    webview.html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
</head>
<body>
  <script nonce="${nonce}">window.__INIT__=${JSON.stringify(init).replace(/</g, "\\u003c")};</script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
