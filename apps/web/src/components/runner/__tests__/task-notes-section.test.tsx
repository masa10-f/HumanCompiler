// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { TaskNotesSection } from '../task-notes-section';
import type { UseNoteReturn } from '@/hooks/use-notes';

const BANNER = 'このノートは、開いた後に別の場所（エージェントなど）で更新されました。';
const RELOAD = '最新を読み込む';
const OVERWRITE = 'この内容で上書き';

const mockUseTaskNote = jest.fn();

jest.mock('@/hooks/use-notes', () => ({
  useTaskNote: (...args: unknown[]) => mockUseTaskNote(...args),
}));

jest.mock('@/components/notes/context-note-panel', () => ({
  ContextNotePanel: ({ content }: { content: string }) => (
    <article aria-label="note panel">{content}</article>
  ),
}));

function hookState(overrides: Partial<UseNoteReturn> = {}): UseNoteReturn {
  return {
    note: {
      id: 'note-1',
      project_id: null,
      goal_id: null,
      task_id: 'task-1',
      content: '<p>task note</p>',
      content_type: 'html',
      created_at: '2026-11-03T09:00:00+00:00',
      updated_at: '2026-11-03T09:00:00+00:00',
      attachments: [],
    },
    loading: false,
    error: null,
    saving: false,
    conflict: false,
    updateNote: jest.fn(),
    updateNoteImmediate: jest.fn().mockResolvedValue(undefined),
    refetch: jest.fn().mockResolvedValue(undefined),
    reloadLatest: jest.fn().mockResolvedValue(undefined),
    overwrite: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('TaskNotesSection conflict banner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows no banner without a conflict', () => {
    mockUseTaskNote.mockReturnValue(hookState());

    render(<TaskNotesSection taskId="task-1" />);

    expect(mockUseTaskNote).toHaveBeenCalledWith('task-1');
    expect(screen.getByLabelText('note panel')).toHaveTextContent('task note');
    expect(screen.queryByText(BANNER)).not.toBeInTheDocument();
  });

  it('shows the banner next to the editor and wires both buttons', () => {
    const state = hookState({ conflict: true });
    mockUseTaskNote.mockReturnValue(state);

    render(<TaskNotesSection taskId="task-1" />);

    expect(screen.getByRole('alert')).toHaveTextContent(BANNER);
    expect(screen.getByLabelText('note panel')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: RELOAD }));
    expect(state.reloadLatest).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: OVERWRITE }));
    expect(state.overwrite).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons while a save is in flight', () => {
    mockUseTaskNote.mockReturnValue(hookState({ conflict: true, saving: true }));

    render(<TaskNotesSection taskId="task-1" />);

    expect(screen.getByRole('button', { name: RELOAD })).toBeDisabled();
    expect(screen.getByRole('button', { name: OVERWRITE })).toBeDisabled();
  });
});
