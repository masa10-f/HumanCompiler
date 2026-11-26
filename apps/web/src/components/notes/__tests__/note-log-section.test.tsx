// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NoteLogSection } from '../note-log-section';
import type { UseNoteReturn } from '@/hooks/use-notes';

const mockUseNote = jest.fn();
let panelMounts = 0;

jest.mock('@/hooks/use-notes', () => ({
  useNote: (...args: unknown[]) => mockUseNote(...args),
}));

jest.mock('../context-note-panel', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    ContextNotePanel: ({ content, emptyTitle }: { content: string; emptyTitle: string }) => {
      useEffect(() => {
        panelMounts += 1;
      }, []);
      return <article aria-label="log panel">{content || emptyTitle}</article>;
    },
  };
});

function hookState(overrides: Partial<UseNoteReturn> = {}): UseNoteReturn {
  return {
    note: {
      id: 'log-1',
      project_id: 'project-1',
      goal_id: null,
      task_id: null,
      section: 'log',
      content: '<p>did this</p>',
      content_type: 'html',
      created_at: '2026-11-03T09:00:00+00:00',
      updated_at: '2026-11-20T05:30:00+00:00',
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
    flush: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const toggle = () => screen.getByRole('button', { name: /ログ/ });

describe('NoteLogSection', () => {
  beforeEach(() => {
    mockUseNote.mockReset();
    mockUseNote.mockReturnValue(hookState());
    panelMounts = 0;
  });

  it('is closed at first and does not load the log', () => {
    render(
      <NoteLogSection
        entityType="project"
        entityId="project-1"
        summary={{ updated_at: '2026-11-20T05:30:00+00:00', characters: 12345 }}
      />
    );

    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    // How much there is, so the user can tell without opening it.
    expect(toggle()).toHaveTextContent('約12,345文字');
    expect(toggle()).toHaveTextContent('最終更新 2026-11-20');
    expect(screen.queryByLabelText('log panel')).not.toBeInTheDocument();
    expect(mockUseNote).not.toHaveBeenCalled();
  });

  it('says when there is no log yet', () => {
    render(<NoteLogSection entityType="goal" entityId="goal-1" summary={null} />);

    expect(toggle()).toHaveTextContent('まだありません');
  });

  it('loads the log of the item when opened', () => {
    render(
      <NoteLogSection
        entityType="task"
        entityId="task-1"
        summary={{ updated_at: '2026-11-20T05:30:00+00:00', characters: 8 }}
      />
    );

    fireEvent.click(toggle());

    expect(mockUseNote).toHaveBeenCalledWith({
      entityType: 'task',
      entityId: 'task-1',
      section: 'log',
    });
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('log panel')).toHaveTextContent('did this');
    // The figures came from the overview and go stale once the log is edited.
    expect(toggle()).not.toHaveTextContent('文字');
  });

  it('keeps the log mounted when closed again, so an edit is not lost', () => {
    render(<NoteLogSection entityType="project" entityId="project-1" summary={null} />);

    fireEvent.click(toggle());
    fireEvent.click(toggle());

    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    const panel = screen.getByLabelText('log panel', { hidden: true } as never);
    expect(panel).not.toBeVisible();

    fireEvent.click(toggle());
    expect(panel).toBeVisible();
    expect(panelMounts).toBe(1);
  });

  it('shows the empty log with its own hint', () => {
    mockUseNote.mockReturnValue(
      hookState({ note: { ...hookState().note!, content: '' } })
    );
    render(<NoteLogSection entityType="project" entityId="project-1" summary={null} />);

    fireEvent.click(toggle());

    expect(screen.getByLabelText('log panel')).toHaveTextContent('ログはまだありません');
  });

  it('offers a retry when the log fails to load', () => {
    const refetch = jest.fn().mockResolvedValue(undefined);
    mockUseNote.mockReturnValue(hookState({ note: null, error: 'boom', refetch }));
    render(<NoteLogSection entityType="project" entityId="project-1" />);

    fireEvent.click(toggle());
    expect(screen.getByText('ログの読み込みに失敗しました')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('starts the panel over after reloading a log that changed elsewhere', async () => {
    const reloadLatest = jest.fn().mockResolvedValue(undefined);
    mockUseNote.mockReturnValue(hookState({ conflict: true, reloadLatest }));
    render(<NoteLogSection entityType="project" entityId="project-1" />);
    fireEvent.click(toggle());
    expect(panelMounts).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: /最新を読み込む/ }));

    await waitFor(() => expect(panelMounts).toBe(2));
    expect(reloadLatest).toHaveBeenCalledTimes(1);
  });
});
