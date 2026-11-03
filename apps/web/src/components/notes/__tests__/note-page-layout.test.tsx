// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NotePageLayout } from '../note-page-layout';
import type { UseNoteReturn } from '@/hooks/use-notes';

const BANNER = 'このノートは、開いた後に別の場所（エージェントなど）で更新されました。';
const RELOAD = '最新を読み込む';
const RELOAD_HINT = 'この画面で保存していない変更は消えます';
const OVERWRITE = 'この内容で上書き';

const mockUseNote = jest.fn();
let panelMounts = 0;

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('@/hooks/use-notes', () => ({
  useNote: (...args: unknown[]) => mockUseNote(...args),
}));

jest.mock('../context-note-panel', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    ContextNotePanel: ({ content }: { content: string }) => {
      useEffect(() => {
        panelMounts += 1;
      }, []);
      return <article aria-label="note panel">{content}</article>;
    },
  };
});

function hookState(overrides: Partial<UseNoteReturn> = {}): UseNoteReturn {
  return {
    note: {
      id: 'note-1',
      project_id: 'project-1',
      goal_id: null,
      task_id: null,
      content: '<p>note</p>',
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

function renderPage() {
  return render(
    <NotePageLayout
      entityType="project"
      entityId="project-1"
      entityTitle="Project"
      breadcrumb={<span>Projects</span>}
      backUrl="/projects/project-1"
    />
  );
}

describe('NotePageLayout conflict banner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    panelMounts = 0;
  });

  it('shows no banner without a conflict', () => {
    mockUseNote.mockReturnValue(hookState());

    renderPage();

    expect(screen.queryByText(BANNER)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: RELOAD })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: OVERWRITE })).not.toBeInTheDocument();
  });

  it('shows the banner, both buttons and the hint on a conflict', () => {
    mockUseNote.mockReturnValue(hookState({ conflict: true }));

    renderPage();

    expect(screen.getByRole('alert')).toHaveTextContent(BANNER);
    expect(screen.getByText(BANNER)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: RELOAD })).toBeEnabled();
    expect(screen.getByText(RELOAD_HINT)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: OVERWRITE })).toBeEnabled();
    expect(screen.getByLabelText('note panel')).toBeInTheDocument();
  });

  it('calls reloadLatest and remounts the panel with the reloaded content', async () => {
    const state = hookState({ conflict: true });
    mockUseNote.mockReturnValue(state);

    renderPage();
    expect(panelMounts).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: RELOAD }));

    await waitFor(() => expect(state.reloadLatest).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(panelMounts).toBe(2));
    expect(state.overwrite).not.toHaveBeenCalled();
  });

  it('calls overwrite', async () => {
    const state = hookState({ conflict: true });
    mockUseNote.mockReturnValue(state);

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: OVERWRITE }));

    await waitFor(() => expect(state.overwrite).toHaveBeenCalledTimes(1));
    expect(state.reloadLatest).not.toHaveBeenCalled();
  });

  it('disables both buttons while a save is in flight', () => {
    mockUseNote.mockReturnValue(hookState({ conflict: true, saving: true }));

    renderPage();

    expect(screen.getByRole('button', { name: RELOAD })).toBeDisabled();
    expect(screen.getByRole('button', { name: OVERWRITE })).toBeDisabled();
  });
});
