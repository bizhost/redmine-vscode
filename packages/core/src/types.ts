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
  created_on?: string;
  updated_on?: string;
  journals?: Journal[];
  attachments?: Attachment[];
}

export interface Project {
  id: number;
  name: string;
  identifier: string;
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
