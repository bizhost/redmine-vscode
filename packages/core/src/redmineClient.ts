import type {
  CurrentUser,
  Issue,
  IssueStatus,
  NamedRef,
  Project,
  SearchResult,
  TimeEntry,
  TimeEntryActivity,
} from "./types.js";

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
  /** 제목 부분일치 검색 */
  subjectQuery?: string;
  /** 일감 번호 직접 조회 */
  issueId?: number;
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

export interface CreateIssueFields {
  projectId: number;
  subject: string;
  description?: string;
  trackerId?: number;
  statusId?: number;
  priorityId?: number;
  assignedToId?: number;
  categoryId?: number;
  parentIssueId?: number;
  doneRatio?: number;
  startDate?: string;
  dueDate?: string;
  estimatedHours?: number;
  isPrivate?: boolean;
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
    if (options.subjectQuery) params.set("subject", `~${options.subjectQuery}`);
    if (options.issueId !== undefined) params.set("issue_id", String(options.issueId));
    const data = await this.request<{ issues: Issue[]; total_count?: number }>(
      `/issues.json?${params}`,
    );
    return { issues: data.issues, totalCount: data.total_count ?? data.issues.length };
  }

  async getIssue(id: number): Promise<Issue> {
    const data = await this.request<{ issue: Issue }>(
      `/issues/${id}.json?include=journals,attachments,children,relations,changesets`,
    );
    return data.issue;
  }

  /** 현재 API 키 소유 사용자 — 표시명(이름 우선, 없으면 login) */
  async getCurrentUser(): Promise<CurrentUser> {
    const data = await this.request<{
      user: { id: number; login?: string; firstname?: string; lastname?: string };
    }>("/users/current.json");
    const u = data.user;
    const name = [u.firstname, u.lastname].filter(Boolean).join(" ") || u.login || `user#${u.id}`;
    return { id: u.id, name };
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

  /** 프로젝트에 활성화된 유형만 */
  async listProjectTrackers(projectId: number): Promise<NamedRef[]> {
    const data = await this.request<{ project: { trackers?: NamedRef[] } }>(
      `/projects/${projectId}.json?include=trackers`,
    );
    return data.project.trackers ?? [];
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

  async createIssue(fields: CreateIssueFields): Promise<Issue> {
    const issue: Record<string, unknown> = {
      project_id: fields.projectId,
      subject: fields.subject,
    };
    if (fields.description !== undefined) issue.description = fields.description;
    if (fields.trackerId !== undefined) issue.tracker_id = fields.trackerId;
    if (fields.statusId !== undefined) issue.status_id = fields.statusId;
    if (fields.priorityId !== undefined) issue.priority_id = fields.priorityId;
    if (fields.assignedToId !== undefined) issue.assigned_to_id = fields.assignedToId;
    if (fields.categoryId !== undefined) issue.category_id = fields.categoryId;
    if (fields.parentIssueId !== undefined) issue.parent_issue_id = fields.parentIssueId;
    if (fields.doneRatio !== undefined) issue.done_ratio = fields.doneRatio;
    if (fields.startDate) issue.start_date = fields.startDate;
    if (fields.dueDate) issue.due_date = fields.dueDate;
    if (fields.estimatedHours !== undefined) issue.estimated_hours = fields.estimatedHours;
    if (fields.isPrivate) issue.is_private = true;
    if (fields.uploads?.length) {
      issue.uploads = fields.uploads.map((u) => ({
        token: u.token,
        filename: u.filename,
        ...(u.contentType ? { content_type: u.contentType } : {}),
      }));
    }
    const data = await this.request<{ issue: Issue }>("/issues.json", {
      method: "POST",
      body: JSON.stringify({ issue }),
    });
    return data.issue;
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

  /** 소요시간 조회. userId 'me'/숫자, 미지정=권한 내 전체. 페이지 루프로 전량 수집(안전 상한 1000) */
  async listTimeEntries(
    options: { from?: string; to?: string; userId?: number | "me"; offset?: number } = {},
  ): Promise<{ entries: TimeEntry[]; truncated: boolean }> {
    const PAGE = 100; // Redmine limit 상한
    const CAP = 1000; // 안전 상한
    const entries: TimeEntry[] = [];
    let offset = options.offset ?? 0;
    let total = 0;
    while (entries.length < CAP) {
      const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
      if (options.from) params.set("from", options.from);
      if (options.to) params.set("to", options.to);
      if (options.userId !== undefined) params.set("user_id", String(options.userId));
      const data = await this.request<{ time_entries: TimeEntry[]; total_count?: number }>(
        `/time_entries.json?${params}`,
      );
      entries.push(...data.time_entries);
      total = data.total_count ?? entries.length;
      offset += data.time_entries.length;
      if (data.time_entries.length === 0 || entries.length >= total) break;
    }
    return { entries: entries.slice(0, CAP), truncated: total > CAP };
  }

  async createTimeEntry(entry: {
    issueId: number;
    hours: number;
    activityId?: number;
    comments?: string;
    spentOn?: string;
  }): Promise<TimeEntry> {
    const timeEntry: Record<string, unknown> = { issue_id: entry.issueId, hours: entry.hours };
    if (entry.activityId !== undefined) timeEntry.activity_id = entry.activityId;
    if (entry.comments) timeEntry.comments = entry.comments;
    if (entry.spentOn) timeEntry.spent_on = entry.spentOn;
    const data = await this.request<{ time_entry: TimeEntry }>("/time_entries.json", {
      method: "POST",
      body: JSON.stringify({ time_entry: timeEntry }),
    });
    return data.time_entry;
  }

  async listTimeEntryActivities(): Promise<TimeEntryActivity[]> {
    const data = await this.request<{ time_entry_activities: TimeEntryActivity[] }>(
      "/enumerations/time_entry_activities.json",
    );
    return data.time_entry_activities;
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
      let detail = res.status === 401 ? " — API key를 확인하세요" : "";
      try {
        // 422 등 검증 에러 본문 { errors: [...] } 노출
        const body = (await res.json()) as { errors?: string[] };
        if (body.errors?.length) detail = ` — ${body.errors.join(", ")}`;
      } catch {
        // JSON 아님 → 상태코드만
      }
      throw new RedmineApiError(res.status, `Redmine API 오류 ${res.status}${detail}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}
