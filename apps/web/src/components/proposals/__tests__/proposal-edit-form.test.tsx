// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ProposalEditForm } from '../proposal-edit-form';
import { ProposalCard } from '../proposal-card';
import { ApiError } from '@/lib/errors';
import type { Proposal } from '@/types/proposal';

const mockAccept = jest.fn();
const mockToast = jest.fn();
const mockGetProjects = jest.fn();
const mockGetGoals = jest.fn();

jest.mock('@/lib/api', () => ({
  proposalsApi: {
    accept: (...args: unknown[]) => mockAccept(...args),
    reject: jest.fn(),
  },
  projectsApi: { getAll: (...args: unknown[]) => mockGetProjects(...args) },
  goalsApi: { getByProject: (...args: unknown[]) => mockGetGoals(...args) },
}));

jest.mock('@/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

// Radix Select needs these DOM APIs, which jsdom lacks.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: 'prop-1',
    kind: 'task',
    status: 'pending',
    title: 'Proposal title',
    rationale: 'Because it helps.',
    payload: taskPayload,
    final_payload: null,
    sources: [],
    idempotency_key: 'key-1',
    agent_name: 'research-agent',
    project_id: 'p1',
    reject_category: null,
    decision_note: null,
    decision_option: null,
    result: null,
    created_at: '2026-11-03T03:00:00Z',
    decided_at: null,
    updated_at: '2026-11-03T03:00:00Z',
    project_name: 'Project One',
    goal_title: 'Goal One',
    task_title: null,
    task_goal_id: null,
    ...overrides,
  };
}

const taskPayload = {
  goal_id: 'g1',
  title: 'Old title',
  description: 'Old description',
  estimate_hours: 2,
  due_date: '2026-11-10T15:00:00Z',
  work_type: 'study',
  priority: 3,
};

const experimentPayload = {
  question: 'Does X help?',
  method: 'Try X',
  supports_if: 'faster',
  refutes_if: 'slower',
  effort: 'low',
};

const onCancel = jest.fn();

function renderForm(proposal: Proposal) {
  return renderWithClient(<ProposalEditForm proposal={proposal} onCancel={onCancel} />);
}

const submit = () => screen.getByRole('button', { name: 'この内容で承認' });

describe('ProposalEditForm', () => {
  beforeEach(() => {
    mockAccept.mockReset();
    mockToast.mockReset();
    onCancel.mockReset();
    mockGetProjects.mockResolvedValue([
      { id: 'p1', title: 'Project One' },
      { id: 'p2', title: 'Project Two' },
    ]);
    mockGetGoals.mockImplementation(async (projectId: string) =>
      projectId === 'p1'
        ? [{ id: 'g1', title: 'Goal One' }]
        : [{ id: 'g2', title: 'Goal Two' }]
    );
    mockAccept.mockResolvedValue(makeProposal({ status: 'edited' }));
  });

  it('starts from the proposal payload', () => {
    renderForm(makeProposal());

    expect(screen.getByLabelText('タイトル')).toHaveValue('Old title');
    expect(screen.getByLabelText('説明')).toHaveValue('Old description');
    expect(screen.getByLabelText('見積もり時間（時間）')).toHaveValue(2);
    expect(screen.getByLabelText('期限')).toHaveValue('2026-11-11');
  });

  it('sends only the changed title as an edited payload', async () => {
    renderForm(makeProposal());

    fireEvent.change(screen.getByLabelText('タイトル'), { target: { value: 'New title' } });
    fireEvent.click(submit());

    await waitFor(() => expect(mockAccept).toHaveBeenCalledTimes(1));
    expect(mockAccept).toHaveBeenCalledWith('prop-1', {
      payload: { ...taskPayload, title: 'New title' },
    });
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: '提案を承認しました' })
      )
    );
  });

  it('sends a plain accept when nothing changed', async () => {
    renderForm(makeProposal());

    fireEvent.click(submit());

    await waitFor(() => expect(mockAccept).toHaveBeenCalledTimes(1));
    expect(mockAccept).toHaveBeenCalledWith('prop-1', {});
  });

  it('disables the submit button while a required field is empty', () => {
    renderForm(makeProposal());

    fireEvent.change(screen.getByLabelText('タイトル'), { target: { value: '' } });
    expect(submit()).toBeDisabled();

    fireEvent.change(screen.getByLabelText('タイトル'), { target: { value: '  ' } });
    expect(submit()).toBeDisabled();
  });

  it('clears the goal when the project changes', async () => {
    renderForm(makeProposal());
    const goal = screen.getByRole('combobox', { name: 'Goal' });
    await waitFor(() => expect(goal).toHaveTextContent('Goal One'));

    fireEvent.click(screen.getByRole('combobox', { name: 'プロジェクト' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Project Two' }));

    await waitFor(() => expect(mockGetGoals).toHaveBeenCalledWith('p2', 0, 100, undefined));
    expect(goal).not.toHaveTextContent('Goal One');
    expect(submit()).toBeDisabled();

    fireEvent.click(goal);
    fireEvent.click(await screen.findByRole('option', { name: 'Goal Two' }));
    expect(submit()).toBeEnabled();

    fireEvent.click(submit());
    await waitFor(() => expect(mockAccept).toHaveBeenCalledTimes(1));
    // The project select is UI-only; only goal_id reaches the payload.
    expect(mockAccept).toHaveBeenCalledWith('prop-1', {
      payload: { ...taskPayload, goal_id: 'g2' },
    });
  });

  it('sends a cleared description as null and a changed estimate as a number', async () => {
    renderForm(makeProposal());

    fireEvent.change(screen.getByLabelText('説明'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('見積もり時間（時間）'), {
      target: { value: '2.5' },
    });
    fireEvent.click(submit());

    await waitFor(() => expect(mockAccept).toHaveBeenCalledTimes(1));
    expect(mockAccept).toHaveBeenCalledWith('prop-1', {
      payload: { ...taskPayload, description: null, estimate_hours: 2.5 },
    });
  });

  it('keeps the edited values and shows the error after a 422', async () => {
    mockAccept.mockRejectedValue(
      new ApiError(
        422,
        'Request failed',
        {
          responseData: {
            detail: [{ loc: ['body', 'payload', 'title'], msg: 'Too long' }],
          },
        },
        'Request failed'
      )
    );
    renderForm(makeProposal());

    fireEvent.change(screen.getByLabelText('タイトル'), { target: { value: 'Edited' } });
    fireEvent.click(submit());

    expect(await screen.findByRole('alert')).toHaveTextContent('payload.title: Too long');
    expect(screen.getByLabelText('タイトル')).toHaveValue('Edited');
    expect(mockToast).not.toHaveBeenCalled();
    expect(submit()).toBeEnabled();
  });

  it('sends one request on a double click', async () => {
    renderForm(makeProposal());

    fireEvent.click(submit());
    fireEvent.click(submit());

    await waitFor(() => expect(mockAccept).toHaveBeenCalledTimes(1));
  });

  it('calls onCancel from the cancel button', () => {
    renderForm(makeProposal());

    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('edits a goal, with the project from the payload', async () => {
    renderForm(
      makeProposal({
        kind: 'goal',
        payload: { project_id: 'p1', title: 'Goal title', description: null, due_date: null },
      })
    );
    expect(screen.queryByRole('combobox', { name: 'Goal' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('タイトル'), { target: { value: 'Renamed' } });
    fireEvent.click(submit());

    await waitFor(() => expect(mockAccept).toHaveBeenCalledTimes(1));
    expect(mockAccept).toHaveBeenCalledWith('prop-1', {
      payload: { project_id: 'p1', title: 'Renamed', description: null, due_date: null },
    });
  });

  it('edits a note append and shows the target read-only', async () => {
    const payload = { target: { project_id: 'p1' }, content_markdown: 'old note' };
    renderForm(makeProposal({ kind: 'note_append', payload }));

    expect(screen.getByText('Project One')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('内容'), { target: { value: 'new note' } });
    fireEvent.click(submit());

    await waitFor(() => expect(mockAccept).toHaveBeenCalledTimes(1));
    expect(mockAccept).toHaveBeenCalledWith('prop-1', {
      payload: { ...payload, content_markdown: 'new note' },
    });
  });

  describe('experiment', () => {
    const experiment = () =>
      makeProposal({ kind: 'experiment', payload: experimentPayload });

    it('sends the extra instructions as decision_note without a payload', async () => {
      renderForm(experiment());

      fireEvent.change(screen.getByLabelText('実行するエージェントへの追加の指示（任意）'), {
        target: { value: '  use staging  ' },
      });
      fireEvent.click(submit());

      await waitFor(() => expect(mockAccept).toHaveBeenCalledTimes(1));
      expect(mockAccept).toHaveBeenCalledWith('prop-1', { decision_note: 'use staging' });
    });

    it('sends the payload and decision_note together', async () => {
      renderForm(experiment());

      fireEvent.change(screen.getByLabelText('方法'), { target: { value: 'Try Y' } });
      fireEvent.change(screen.getByLabelText('実行するエージェントへの追加の指示（任意）'), {
        target: { value: 'be quick' },
      });
      fireEvent.click(submit());

      await waitFor(() => expect(mockAccept).toHaveBeenCalledTimes(1));
      expect(mockAccept).toHaveBeenCalledWith('prop-1', {
        payload: { ...experimentPayload, method: 'Try Y' },
        decision_note: 'be quick',
      });
    });

    it('omits a blank decision_note', async () => {
      renderForm(experiment());

      fireEvent.change(screen.getByLabelText('実行するエージェントへの追加の指示（任意）'), {
        target: { value: '   ' },
      });
      fireEvent.click(submit());

      await waitFor(() => expect(mockAccept).toHaveBeenCalledTimes(1));
      expect(mockAccept).toHaveBeenCalledWith('prop-1', {});
    });
  });
});

describe('ProposalEditForm notes and goal tasks', () => {
  const taskA = {
    title: 'A',
    description: null,
    estimate_hours: 1,
    due_date: null,
    work_type: null,
    priority: null,
    note_markdown: 'note A',
  };
  const taskB = { ...taskA, title: 'B', note_markdown: null };
  const goalProposal = () =>
    makeProposal({
      kind: 'goal',
      payload: {
        project_id: 'p1',
        title: 'Goal title',
        description: null,
        due_date: null,
        tasks: [taskA, taskB],
      },
    });
  const group = (n: number) => screen.getByRole('group', { name: `Task ${n}` });

  beforeEach(() => {
    mockAccept.mockReset();
    mockGetProjects.mockResolvedValue([{ id: 'p1', title: 'Project One' }]);
    mockGetGoals.mockResolvedValue([{ id: 'g1', title: 'Goal One' }]);
    mockAccept.mockResolvedValue(makeProposal({ status: 'edited' }));
  });

  it('edits the note of a task proposal', async () => {
    renderForm(makeProposal({ payload: { ...taskPayload, note_markdown: 'old note' } }));

    expect(screen.getByLabelText('ノート（Markdown）')).toHaveValue('old note');
    fireEvent.change(screen.getByLabelText('ノート（Markdown）'), {
      target: { value: 'new note' },
    });
    fireEvent.click(submit());

    await waitFor(() => expect(mockAccept).toHaveBeenCalledTimes(1));
    expect(mockAccept).toHaveBeenCalledWith('prop-1', {
      payload: { ...taskPayload, note_markdown: 'new note' },
    });
  });

  it('sends a plain accept for a legacy task payload without note_markdown', async () => {
    renderForm(makeProposal());
    fireEvent.click(submit());

    await waitFor(() => expect(mockAccept).toHaveBeenCalledTimes(1));
    expect(mockAccept).toHaveBeenCalledWith('prop-1', {});
  });

  it('removes a task from a goal proposal and sends the rest', async () => {
    renderForm(goalProposal());
    fireEvent.click(screen.getAllByRole('button', { name: 'この Task を外す' })[0]);
    expect(screen.getByText('外す: A')).toBeInTheDocument();
    fireEvent.click(submit());

    await waitFor(() => expect(mockAccept).toHaveBeenCalledTimes(1));
    expect(mockAccept.mock.calls[0][1].payload.tasks).toEqual([taskB]);
  });

  it('restores a removed task', async () => {
    renderForm(goalProposal());
    fireEvent.click(screen.getAllByRole('button', { name: 'この Task を外す' })[0]);
    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }));
    fireEvent.click(submit());

    await waitFor(() => expect(mockAccept).toHaveBeenCalledTimes(1));
    expect(mockAccept).toHaveBeenCalledWith('prop-1', {});
  });

  it('removing every task sends tasks null', async () => {
    renderForm(goalProposal());
    fireEvent.click(screen.getAllByRole('button', { name: 'この Task を外す' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: 'この Task を外す' })[0]);
    fireEvent.click(submit());

    await waitFor(() => expect(mockAccept).toHaveBeenCalledTimes(1));
    expect(mockAccept.mock.calls[0][1].payload.tasks).toBeNull();
  });

  it('disables submit while a kept task lacks a title', () => {
    renderForm(goalProposal());
    fireEvent.change(within(group(1)).getByLabelText('タイトル'), { target: { value: '' } });
    expect(submit()).toBeDisabled();
  });

  it('a removed task with an empty title does not block submit', async () => {
    renderForm(goalProposal());
    fireEvent.change(within(group(1)).getByLabelText('タイトル'), { target: { value: '' } });
    fireEvent.click(within(group(1)).getByRole('button', { name: 'この Task を外す' }));
    expect(submit()).toBeEnabled();
    fireEvent.click(submit());

    await waitFor(() => expect(mockAccept).toHaveBeenCalledTimes(1));
    expect(mockAccept.mock.calls[0][1].payload.tasks).toEqual([taskB]);
  });
});

describe('ProposalCard editing', () => {
  beforeEach(() => {
    mockGetProjects.mockResolvedValue([{ id: 'p1', title: 'Project One' }]);
    mockGetGoals.mockResolvedValue([{ id: 'g1', title: 'Goal One' }]);
  });

  it('swaps the actions for the form and back on cancel', () => {
    renderWithClient(<ProposalCard proposal={makeProposal()} />);

    fireEvent.click(screen.getByRole('button', { name: '編集して承認' }));
    expect(screen.getByLabelText('タイトル')).toHaveValue('Old title');
    expect(screen.queryByRole('button', { name: '却下' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(screen.queryByLabelText('タイトル')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '却下' })).toBeInTheDocument();
  });

  it('does not offer editing for a decision request', () => {
    renderWithClient(
      <ProposalCard
        proposal={makeProposal({
          kind: 'decision_request',
          payload: { question: 'Which?', options: [] },
        })}
      />
    );
    expect(screen.queryByRole('button', { name: '編集して承認' })).not.toBeInTheDocument();
  });
});
