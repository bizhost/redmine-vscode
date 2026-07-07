import type { Issue, IssueStatus } from "./types.js";

export interface RedmineClientOptions {
  url: string;
  apiKey: string;
  /** 생략 시 전체 프로젝트 대상 */
  projectIdentifier?: string;
}

export interface ListIssuesOptions {
  assignedToMe?: boolean;
  statusId?: string;
  limit?: number;
}

export interface UpdateIssueChanges {
  statusId?: number;
  notes?: string;
  doneRatio?: number;
  priorityId?: number;
}

export class RedmineApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "RedmineApiError";
  }
}

export class RedmineClient {
  private readonly baseUrl: string;

  constructor(private readonly opts: RedmineClientOptions) {
    this.baseUrl = opts.url.replace(/\/+$/, ""); // 서브패스 보존 위해 문자열 결합
  }

  async listIssues(options: ListIssuesOptions = {}): Promise<Issue[]> {
    const params = new URLSearchParams({
      status_id: options.statusId ?? "open",
      sort: "updated_on:desc",
      limit: String(options.limit ?? 50),
    });
    if (this.opts.projectIdentifier) params.set("project_id", this.opts.projectIdentifier);
    if (options.assignedToMe ?? true) params.set("assigned_to_id", "me");
    const data = await this.request<{ issues: Issue[] }>(`/issues.json?${params}`);
    return data.issues;
  }

  async getIssue(id: number): Promise<Issue> {
    const data = await this.request<{ issue: Issue }>(
      `/issues/${id}.json?include=journals,attachments`,
    );
    return data.issue;
  }

  async listStatuses(): Promise<IssueStatus[]> {
    const data = await this.request<{ issue_statuses: IssueStatus[] }>("/issue_statuses.json");
    return data.issue_statuses;
  }

  async listPriorities(): Promise<IssueStatus[]> {
    const data = await this.request<{ issue_priorities: IssueStatus[] }>(
      "/enumerations/issue_priorities.json",
    );
    return data.issue_priorities;
  }

  async updateIssue(id: number, changes: UpdateIssueChanges): Promise<void> {
    const issue: Record<string, unknown> = {};
    if (changes.statusId !== undefined) issue.status_id = changes.statusId;
    if (changes.notes !== undefined) issue.notes = changes.notes;
    if (changes.doneRatio !== undefined) issue.done_ratio = changes.doneRatio;
    if (changes.priorityId !== undefined) issue.priority_id = changes.priorityId;
    await this.request(`/issues/${id}.json`, {
      method: "PUT",
      body: JSON.stringify({ issue }),
    });
  }

  private async request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      "X-Redmine-API-Key": this.opts.apiKey,
      Accept: "application/json",
    };
    if (init.body !== undefined) headers["Content-Type"] = "application/json";

    const res = await fetch(this.baseUrl + path, { ...init, headers });
    if (!res.ok) {
      const hint = res.status === 401 ? " — API key를 확인하세요" : "";
      throw new RedmineApiError(res.status, `Redmine API 오류 ${res.status}${hint}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}
