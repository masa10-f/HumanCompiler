/**
 * Context note types for rich text notes on projects, goals, and tasks
 */

/**
 * An image attached to a note. The note's HTML refers to it by id,
 * `<img data-attachment-id="...">`; the image itself is behind a signed URL
 * (see `NoteAttachmentUrls`).
 */
export interface NoteAttachment {
  id: string;
  note_id: string | null;
  /** What the image shows; '' until the user writes one. */
  caption: string;
  width: number;
  height: number;
  byte_size: number;
  thumb_byte_size: number;
  created_at: string;
  /** The reference agents use in Markdown: `![caption](attachment:<id>)`. */
  markdown: string;
  /** True when the same image was already attached to the note. */
  reused: boolean;
}

/** Signed URLs of one attachment; they stop working at `expires_at`. */
export interface NoteAttachmentUrls {
  id: string;
  url: string;
  thumb_url: string;
  width: number;
  height: number;
  caption: string;
}

export interface NoteAttachmentUrlsResponse {
  /** Only the caller's own attachments; any other id is left out. */
  items: NoteAttachmentUrls[];
  expires_at: string;
}

/** The project, goal or task whose note an image is attached to. */
export interface NoteAttachmentTarget {
  type: NoteEntityType;
  id: string;
}

export interface ContextNote {
  id: string;
  project_id: string | null;
  goal_id: string | null;
  task_id: string | null;
  content: string;
  content_type: 'markdown' | 'html' | 'tiptap_json';
  created_at: string;
  updated_at: string;
}

export interface ContextNoteUpdate {
  content?: string;
  content_type?: 'markdown' | 'html' | 'tiptap_json';
  /** The note's updated_at as last read; a note changed since gives 409. */
  expected_updated_at?: string;
}

export type NoteEntityType = 'project' | 'goal' | 'task';

/** A task's title and its note as Markdown, as the clipboard copy uses them. */
export interface TaskNoteMarkdown {
  title: string;
  /** '' for a task without a note. */
  markdown: string;
}
