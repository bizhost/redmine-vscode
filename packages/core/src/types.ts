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
  status: NamedRef;
  priority?: NamedRef;
  tracker?: NamedRef;
  author?: NamedRef;
  assigned_to?: NamedRef;
  done_ratio?: number;
  created_on?: string;
  updated_on?: string;
  journals?: Journal[];
  attachments?: Attachment[];
}

export interface IssueStatus {
  id: number;
  name: string;
  is_closed?: boolean;
}
