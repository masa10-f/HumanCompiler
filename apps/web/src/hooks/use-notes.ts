import { useQueryClient } from '@tanstack/react-query';
import { notesApi } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useNoteDocument, type UseNoteDocumentReturn } from './use-note-document';
import type {
  ContextNote,
  ContextNoteUpdate,
  NoteEntityType,
  NoteSection,
} from '@/types/context-note';

export type UseNoteReturn = UseNoteDocumentReturn<ContextNote>;

interface UseNoteConfig {
  entityType: NoteEntityType;
  entityId: string;
  /** Which of the item's two notes; the overview when left out. */
  section?: NoteSection;
}

function loadNote(
  entityType: NoteEntityType,
  entityId: string,
  section: NoteSection
): Promise<ContextNote> {
  switch (entityType) {
    case 'project':
      return notesApi.getProjectNote(entityId, section);
    case 'goal':
      return notesApi.getGoalNote(entityId, section);
    case 'task':
      return notesApi.getTaskNote(entityId, section);
    default:
      throw new Error(`Invalid entity type: ${entityType}`);
  }
}

function saveNote(
  entityType: NoteEntityType,
  entityId: string,
  body: ContextNoteUpdate,
  section: NoteSection
): Promise<ContextNote> {
  switch (entityType) {
    case 'project':
      return notesApi.updateProjectNote(entityId, body, section);
    case 'goal':
      return notesApi.updateGoalNote(entityId, body, section);
    case 'task':
      return notesApi.updateTaskNote(entityId, body, section);
    default:
      throw new Error(`Invalid entity type: ${entityType}`);
  }
}

/**
 * Hook for managing context notes on projects, goals, or tasks.
 * Provides automatic loading and saving of note content, with the conflict
 * handling of `useNoteDocument`. An item has two notes, its overview and its
 * log; each use of the hook is for one of them.
 */
export function useNote({
  entityType,
  entityId,
  section = 'overview',
}: UseNoteConfig): UseNoteReturn {
  const queryClient = useQueryClient();
  return useNoteDocument<ContextNote>({
    noteKey: entityId ? `${entityType}:${entityId}:${section}` : '',
    hookName: `useNote:${entityType}:${section}`,
    logContext: { entityType, entityId, section },
    load: () => loadNote(entityType, entityId, section),
    save: async (body) => {
      const saved = await saveNote(entityType, entityId, body, section);
      if (entityType === 'task' && section === 'overview') {
        // Task lists show the opening of the overview (note_excerpt). The editor
        // autosaves while the user types, so the task queries are only marked
        // stale: they refetch when a list next mounts or the window regains
        // focus, not after every save.
        void queryClient.invalidateQueries({
          queryKey: queryKeys.tasks.all,
          refetchType: 'none',
        });
      }
      return saved;
    },
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
