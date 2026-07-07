import type { Issue, IssueStatus, NamedRef, Project, SearchResult } from "./types.js";

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
  /** 숫자 프로젝트 id — 설정된 identifier보다 우선 */
  projectId?: number;
  offset?: number;
}

export interface IssuePage {
  issues: Issue[];
  totalCount: number;
}

export interface UpdateIssueChanges {
  subject?: string;
  description?: string;
  statusId?: number;
  priorityId?: number;
  trackerId?: number;
  categoryId?: number | "";
  assignedToId?: number | "";
  doneRatio?: number;
  startDate?: string;
  dueDate?: string;
  estimatedHours?: number | "";
  notes?: string;
  privateNotes?: boolean;
  uploads?: Array<{ token: string; filename: string; contentType?: string }>;
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

  async listIssues(options: ListIssuesOptions = {}): Promise<IssuePage> {
    const params = new URLSearchParams({
      status_id: options.statusId ?? "open",
      sort: "updated_on:desc",
      limit: String(options.limit ?? 50),
      offset: String(options.offset ?? 0),
    });
    const project = options.projectId ?? this.opts.projectIdentifier;
    if (project) params.set("project_id", String(project));
    if (options.assignedToMe ?? true) params.set("assigned_to_id", "me");
    const data = await this.request<{ issues: Issue[]; total_count?: number }>(
      `/issues.json?${params}`,
    );
    return { issues: data.issues, totalCount: data.total_count ?? data.issues.length };
  }

  async getIssue(id: number): Promise<Issue> {
    const data = await this.request<{ issue: Issue }>(
      `/issues/${id}.json?include=journals,attachments,children,relations`,
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

  async listProjects(): Promise<Project[]> {
    const data = await this.request<{ projects: Project[] }>("/projects.json?limit=100");
    return data.projects;
  }

  async listTrackers(): Promise<NamedRef[]> {
    const data = await this.request<{ trackers: NamedRef[] }>("/trackers.json");
    return data.trackers;
  }

  async listAssignees(projectId: number): Promise<NamedRef[]> {
    const data = await this.request<{ memberships: Array<{ user?: NamedRef }> }>(
      `/projects/${projectId}/memberships.json?limit=100`,
    );
    return data.memberships.map((m) => m.user).filter((u): u is NamedRef => !!u);
  }

  async listCategories(projectId: number): Promise<NamedRef[]> {
    const data = await this.request<{ issue_categories: NamedRef[] }>(
      `/projects/${projectId}/issue_categories.json`,
    );
    return data.issue_categories;
  }

  async searchIssues(query: string): Promise<SearchResult[]> {
    const params = new URLSearchParams({ q: query, issues: "1", limit: "25" });
    const data = await this.request<{ results: Array<{ id: number; title: string }> }>(
      `/search.json?${params}`,
    );
    return data.results.map(({ id, title }) => ({ id, title }));
  }

  /** 파일 업로드 → 첨부 토큰 (updateIssue uploads에 사용) */
  async uploadFile(filename: string, data: ArrayBuffer | Uint8Array): Promise<string> {
    const res = await fetch(
      `${this.baseUrl}/uploads.json?filename=${encodeURIComponent(filename)}`,
      {
        method: "POST",
        headers: {
          "X-Redmine-API-Key": this.opts.apiKey,
          "Content-Type": "application/octet-stream",
        },
        body: data as BodyInit,
      },
    );
    if (!res.ok) {
      throw new RedmineApiError(res.status, `업로드 실패 ${res.status}`);
    }
    const json = (await res.json()) as { upload: { token: string } };
    return json.upload.token;
  }

  /** 첨부 다운로드 — content_url 절대경로 사용 */
  async downloadAttachment(contentUrl: string): Promise<ArrayBuffer> {
    const res = await fetch(contentUrl, {
      headers: { "X-Redmine-API-Key": this.opts.apiKey },
    });
    if (!res.ok) {
      throw new RedmineApiError(res.status, `첨부 다운로드 실패 ${res.status}`);
    }
    return res.arrayBuffer();
  }

  async updateIssue(id: number, changes: UpdateIssueChanges): Promise<void> {
    const issue: Record<string, unknown> = {};
    if (changes.subject !== undefined) issue.subject = changes.subject;
    if (changes.description !== undefined) issue.description = changes.description;
    if (changes.statusId !== undefined) issue.status_id = changes.statusId;
    if (changes.priorityId !== undefined) issue.priority_id = changes.priorityId;
    if (changes.trackerId !== undefined) issue.tracker_id = changes.trackerId;
    if (changes.categoryId !== undefined) issue.category_id = changes.categoryId;
    if (changes.assignedToId !== undefined) issue.assigned_to_id = changes.assignedToId;
    if (changes.doneRatio !== undefined) issue.done_ratio = changes.doneRatio;
    if (changes.startDate !== undefined) issue.start_date = changes.startDate;
    if (changes.dueDate !== undefined) issue.due_date = changes.dueDate;
    if (changes.estimatedHours !== undefined) issue.estimated_hours = changes.estimatedHours;
    if (changes.notes !== undefined) issue.notes = changes.notes;
    if (changes.privateNotes) issue.private_notes = true;
    if (changes.uploads?.length) {
      issue.uploads = changes.uploads.map((u) => ({
        token: u.token,
        filename: u.filename,
        ...(u.contentType ? { content_type: u.contentType } : {}),
      }));
    }
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
