/**
 * Context note types for rich text notes on projects, goals, and tasks
 */

export interface NoteAttachment {
  id: string;
  note_id: string;
  filename: string;
  content_type: string;
  file_size: number;
  storage_path: string;
  created_at: string;
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
  attachments: NoteAttachment[];
}

export interface ContextNoteUpdate {
  content?: string;
  content_type?: 'markdown' | 'html' | 'tiptap_json';
}

export type NoteEntityType = 'project' | 'goal' | 'task';
