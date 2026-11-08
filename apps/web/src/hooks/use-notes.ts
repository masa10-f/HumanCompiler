import { notesApi } from '@/lib/api';
import { useNoteDocument, type UseNoteDocumentReturn } from './use-note-document';
import type { ContextNote, ContextNoteUpdate, NoteEntityType } from '@/types/context-note';

export type UseNoteReturn = UseNoteDocumentReturn<ContextNote>;

interface UseNoteConfig {
  entityType: NoteEntityType;
  entityId: string;
}

function loadNote(entityType: NoteEntityType, entityId: string): Promise<ContextNote> {
  switch (entityType) {
    case 'project':
      return notesApi.getProjectNote(entityId);
    case 'goal':
      return notesApi.getGoalNote(entityId);
    case 'task':
      return notesApi.getTaskNote(entityId);
    default:
      throw new Error(`Invalid entity type: ${entityType}`);
  }
}

function saveNote(
  entityType: NoteEntityType,
  entityId: string,
  body: ContextNoteUpdate
): Promise<ContextNote> {
  switch (entityType) {
    case 'project':
      return notesApi.updateProjectNote(entityId, body);
    case 'goal':
      return notesApi.updateGoalNote(entityId, body);
    case 'task':
      return notesApi.updateTaskNote(entityId, body);
    default:
      throw new Error(`Invalid entity type: ${entityType}`);
  }
}

/**
 * Hook for managing context notes on projects, goals, or tasks.
 * Provides automatic loading and saving of note content, with the conflict
 * handling of `useNoteDocument`.
 */
export function useNote({ entityType, entityId }: UseNoteConfig): UseNoteReturn {
  return useNoteDocument<ContextNote>({
    noteKey: entityId ? `${entityType}:${entityId}` : '',
    hookName: `useNote:${entityType}`,
    logContext: { entityType, entityId },
    load: () => loadNote(entityType, entityId),
    save: (body) => saveNote(entityType, entityId, body),
  });
}

/**
 * Convenience hook for project notes.
 */
export function useProjectNote(projectId: string): UseNoteReturn {
  return useNote({ entityType: 'project', entityId: projectId });
}

/**
 * Convenience hook for goal notes.
 */
export function useGoalNote(goalId: string): UseNoteReturn {
  return useNote({ entityType: 'goal', entityId: goalId });
}

/**
 * Convenience hook for task notes.
 */
export function useTaskNote(taskId: string): UseNoteReturn {
  return useNote({ entityType: 'task', entityId: taskId });
}
