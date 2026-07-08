export interface NamedRef {
  id: number;
  name: string;
}

export interface Attachment {
  id: number;
  filename: string;
  filesize: number;
  content_url: string;
  content_type?: string;
  created_on?: string;
  author?: NamedRef;
}

export interface JournalDetail {
  property: string;
  name: string;
  old_value?: string | null;
  new_value?: string | null;
}

export interface Journal {
  id: number;
  user: NamedRef;
  notes: string;
  created_on: string;
  details?: JournalDetail[];
}

/** 저장소 연동 시 이슈에 연결된 커밋. diff는 API 미제공 — 메타만 */
export interface Changeset {
  revision: string;
  user?: NamedRef;
  comments?: string;
  committed_on?: string;
}

export interface Issue {
  id: number;
  subject: string;
  description?: string;
  project?: NamedRef;
  status: NamedRef;
  priority?: NamedRef;
  tracker?: NamedRef;
  category?: NamedRef;
  author?: NamedRef;
  assigned_to?: NamedRef;
  done_ratio?: number;
  start_date?: string;
  due_date?: string;
  estimated_hours?: number;
  /** 기록된 소요시간 합계 (issue 상세에 기본 포함, 없을 수 있음) */
  spent_hours?: number;
  total_spent_hours?: number;
  created_on?: string;
  updated_on?: string;
  parent?: { id: number };
  children?: Array<{ id: number; subject: string; tracker?: NamedRef }>;
  relations?: IssueRelation[];
  journals?: Journal[];
  attachments?: Attachment[];
  changesets?: Changeset[];
  /** include=watchers 조회 시 채워짐 */
  watchers?: NamedRef[];
}

export interface IssueRelation {
  id: number;
  issue_id: number;
  issue_to_id: number;
  relation_type: string;
  delay?: number | null;
}

export interface Project {
  id: number;
  name: string;
  identifier: string;
  /** 상위 프로젝트 (권한상 안 보이면 undefined → 고아=루트 취급) */
  parent?: { id: number; name?: string };
}

export interface SearchResult {
  id: number;
  title: string;
}

export interface IssueStatus {
  id: number;
  name: string;
  is_closed?: boolean;
}

export interface CurrentUser {
  id: number;
  name: string;
}

export interface TimeEntry {
  id: number;
  issue?: { id: number };
  user?: NamedRef;
  activity?: NamedRef;
  hours: number;
  spent_on: string;
  comments?: string;
}

export interface TimeEntryActivity {
  id: number;
  name: string;
  is_default?: boolean;
}
