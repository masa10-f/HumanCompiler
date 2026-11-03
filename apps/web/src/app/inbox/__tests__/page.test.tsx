// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import { fireEvent, render, screen } from '@testing-library/react';
import InboxPage from '../page';
import { ApiError } from '@/lib/errors';
import type { Proposal } from '@/types/proposal';

const mockReplace = jest.fn();
const mockUseProposals = jest.fn();
const mockUseAuth = jest.fn();
const mockUseProjectOptions = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
}));

jest.mock('@/hooks/use-auth', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('@/hooks/use-proposals', () => ({
  useProposals: (...args: unknown[]) => mockUseProposals(...args),
}));

jest.mock('@/hooks/use-project-query', () => ({
  useProjectOptions: () => mockUseProjectOptions(),
}));

jest.mock('@/components/layout/app-header', () => ({
  AppHeader: ({ currentPage }: { currentPage?: string }) => (
    <div data-testid="app-header">{currentPage}</div>
  ),
}));

jest.mock('@/components/proposals', () => ({
  ProposalCard: ({ proposal }: { proposal: Proposal }) => (
    <div data-testid="proposal-card">{proposal.title}</div>
  ),
}));

// Radix Select needs these DOM APIs, which jsdom lacks.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

function makeProposal(id: string): Proposal {
  return {
    id,
    kind: 'task',
    status: 'pending',
    title: `Proposal ${id}`,
    rationale: 'Because.',
    payload: {},
    final_payload: null,
    sources: [],
    idempotency_key: `key-${id}`,
    agent_name: 'research-agent',
    project_id: null,
    reject_category: null,
    decision_note: null,
    decision_option: null,
    result: null,
    created_at: '2026-11-01T00:00:00Z',
    decided_at: null,
    updated_at: '2026-11-01T00:00:00Z',
    project_name: null,
    goal_title: null,
    task_title: null,
    task_goal_id: null,
  };
}

function listResult(items: Proposal[], total = items.length) {
  return {
    data: { items, total },
    isLoading: false,
    isError: false,
    error: null,
  };
}

function lastFilters() {
  const calls = mockUseProposals.mock.calls;
  return calls[calls.length - 1][0];
}

function chooseOption(comboboxName: string, optionName: string) {
  fireEvent.click(screen.getByRole('combobox', { name: comboboxName }));
  fireEvent.click(screen.getByRole('option', { name: optionName }));
}

describe('InboxPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuth.mockReturnValue({ loading: false, isAuthenticated: true });
    mockUseProjectOptions.mockReturnValue({
      data: [
        { id: 'p1', title: 'Project One' },
        { id: 'p2', title: 'Project Two' },
      ],
    });
    mockUseProposals.mockReturnValue(listResult([makeProposal('a'), makeProposal('b')]));
  });

  it('lists pending proposals with the first page filters', () => {
    render(<InboxPage />);

    expect(screen.getByRole('heading', { name: 'インボックス' })).toBeInTheDocument();
    expect(screen.getByTestId('app-header')).toHaveTextContent('inbox');
    expect(mockUseProposals).toHaveBeenLastCalledWith({
      status: 'pending',
      limit: 50,
      offset: 0,
    });
    expect(screen.getAllByTestId('proposal-card')).toHaveLength(2);
    expect(screen.getByText('1–2 / 2 件')).toBeInTheDocument();
  });

  it('switches to the decided tab and resets the offset', () => {
    mockUseProposals.mockReturnValue(listResult([makeProposal('a')], 120));
    render(<InboxPage />);
    fireEvent.click(screen.getByRole('button', { name: '次へ' }));
    expect(lastFilters()).toMatchObject({ status: 'pending', offset: 50 });

    fireEvent.mouseDown(screen.getByRole('tab', { name: '処理済み' }), { button: 0 });

    expect(lastFilters()).toEqual({ status: 'decided', limit: 50, offset: 0 });
  });

  it('passes the chosen kind and project and drops them for the all options', () => {
    render(<InboxPage />);

    chooseOption('種類', '実験');
    expect(lastFilters()).toEqual({
      status: 'pending',
      kind: 'experiment',
      limit: 50,
      offset: 0,
    });

    chooseOption('プロジェクト', 'Project Two');
    expect(lastFilters()).toMatchObject({ kind: 'experiment', project_id: 'p2' });

    chooseOption('種類', 'すべての種類');
    chooseOption('プロジェクト', 'すべてのプロジェクト');
    expect(lastFilters()).toEqual({ status: 'pending', limit: 50, offset: 0 });
    expect(lastFilters()).not.toHaveProperty('kind');
    expect(lastFilters()).not.toHaveProperty('project_id');
  });

  it('pages with 次へ / 前へ and resets to the first page when a filter changes', () => {
    mockUseProposals.mockReturnValue(listResult([makeProposal('a')], 120));
    render(<InboxPage />);

    expect(screen.getByRole('button', { name: '前へ' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '次へ' }));
    expect(lastFilters()).toMatchObject({ offset: 50 });
    expect(screen.getByText('51–51 / 120 件')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '前へ' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: '前へ' }));
    expect(lastFilters()).toMatchObject({ offset: 0 });

    fireEvent.click(screen.getByRole('button', { name: '次へ' }));
    fireEvent.click(screen.getByRole('button', { name: '次へ' }));
    expect(lastFilters()).toMatchObject({ offset: 100 });
    expect(screen.getByRole('button', { name: '次へ' })).toBeDisabled();

    chooseOption('種類', '実験');
    expect(lastFilters()).toMatchObject({ kind: 'experiment', offset: 0 });
  });

  it('steps back to the last page with items when the current page empties', () => {
    mockUseProposals.mockReturnValue(listResult([makeProposal('a')], 51));
    const { rerender } = render(<InboxPage />);
    fireEvent.click(screen.getByRole('button', { name: '次へ' }));
    expect(lastFilters()).toMatchObject({ offset: 50 });

    // The only item on page 2 was decided; 50 remain on page 1.
    // Page 1 has items again once the offset steps back.
    mockUseProposals.mockImplementation(({ offset }: { offset: number }) =>
      offset === 0
        ? listResult([makeProposal('a')], 50)
        : listResult([], 50),
    );
    rerender(<InboxPage />);

    expect(lastFilters()).toMatchObject({ offset: 0 });
    expect(screen.queryByText('未処理の提案はありません')).not.toBeInTheDocument();
  });

  it('shows the pending empty state without a range or paging buttons', () => {
    mockUseProposals.mockReturnValue(listResult([], 0));
    render(<InboxPage />);

    expect(screen.getByText('未処理の提案はありません')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '次へ' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '前へ' })).not.toBeInTheDocument();
    expect(screen.queryByText(/件$/)).not.toBeInTheDocument();
  });

  it('shows the decided empty state on the decided tab', () => {
    mockUseProposals.mockReturnValue(listResult([], 0));
    render(<InboxPage />);

    fireEvent.mouseDown(screen.getByRole('tab', { name: '処理済み' }), { button: 0 });

    expect(screen.getByText('処理済みの提案はありません')).toBeInTheDocument();
  });

  it('shows a spinner during the first load', () => {
    mockUseProposals.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
    });
    render(<InboxPage />);

    expect(screen.getByRole('status', { name: '読み込み中' })).toBeInTheDocument();
    expect(screen.queryByText('未処理の提案はありません')).not.toBeInTheDocument();
  });

  it('shows the error message when the list fails to load', () => {
    mockUseProposals.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError(500, 'boom', {}, '一覧を読み込めませんでした'),
    });
    render(<InboxPage />);

    expect(screen.getByRole('alert')).toHaveTextContent('一覧を読み込めませんでした');
    expect(screen.queryByText('未処理の提案はありません')).not.toBeInTheDocument();
  });

  it('redirects to /login when unauthenticated', () => {
    mockUseAuth.mockReturnValue({ loading: false, isAuthenticated: false });
    render(<InboxPage />);

    expect(mockReplace).toHaveBeenCalledWith('/login');
    expect(screen.queryByRole('heading', { name: 'インボックス' })).not.toBeInTheDocument();
  });

  it('waits while auth is loading', () => {
    mockUseAuth.mockReturnValue({ loading: true, isAuthenticated: false });
    render(<InboxPage />);

    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'インボックス' })).not.toBeInTheDocument();
  });
});
