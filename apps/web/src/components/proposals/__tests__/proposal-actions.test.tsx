// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ProposalActions } from '../proposal-actions';
import { ApiError } from '@/lib/errors';
import type { Proposal } from '@/types/proposal';

const mockAccept = jest.fn();
const mockReject = jest.fn();
const mockToast = jest.fn();

jest.mock('@/lib/api', () => ({
  proposalsApi: {
    accept: (...args: unknown[]) => mockAccept(...args),
    reject: (...args: unknown[]) => mockReject(...args),
  },
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
    kind: 'goal',
    status: 'pending',
    title: 'Proposal title',
    rationale: 'Because it helps.',
    payload: { project_id: 'p1', title: 'Payload goal title' },
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
    project_name: 'My Project',
    goal_title: null,
    task_title: null,
    task_goal_id: null,
    ...overrides,
  };
}

const experiment = () =>
  makeProposal({
    kind: 'experiment',
    payload: {
      question: 'Does X help?',
      method: 'Try X',
      supports_if: 'faster',
      refutes_if: 'slower',
      effort: 'low',
    },
  });

const decisionRequest = () =>
  makeProposal({
    kind: 'decision_request',
    payload: {
      question: 'Which database?',
      options: [{ label: 'Postgres' }, { label: 'SQLite' }],
    },
  });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('ProposalActions', () => {
  beforeEach(() => {
    mockAccept.mockReset();
    mockReject.mockReset();
    mockToast.mockReset();
    mockAccept.mockResolvedValue(makeProposal({ status: 'accepted' }));
    mockReject.mockResolvedValue(makeProposal({ status: 'rejected' }));
  });

  describe('accept', () => {
    it('accepts a goal at once with an empty body and shows a toast', async () => {
      renderWithClient(<ProposalActions proposal={makeProposal()} />);

      fireEvent.click(screen.getByRole('button', { name: '承認' }));

      await waitFor(() => expect(mockAccept).toHaveBeenCalledTimes(1));
      expect(mockAccept).toHaveBeenCalledWith('prop-1', {});
      await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({ title: '提案を承認しました' })
        )
      );
    });

    it('puts the result link in the toast description', async () => {
      mockAccept.mockResolvedValue(
        makeProposal({
          status: 'accepted',
          result: { type: 'goal', id: 'g9' },
        })
      );
      renderWithClient(<ProposalActions proposal={makeProposal()} />);

      fireEvent.click(screen.getByRole('button', { name: '承認' }));

      await waitFor(() => expect(mockToast).toHaveBeenCalled());
      const { description } = mockToast.mock.calls[0][0];
      render(<>{description}</>);
      expect(
        screen.getByRole('link', { name: '作成した Goal を開く' })
      ).toHaveAttribute('href', '/projects/p1/goals/g9');
    });

    it('sends one request when the button is clicked twice while pending', async () => {
      const pending = deferred<Proposal>();
      mockAccept.mockReturnValue(pending.promise);
      renderWithClient(<ProposalActions proposal={makeProposal()} />);

      const button = screen.getByRole('button', { name: '承認' });
      fireEvent.click(button);
      await waitFor(() => expect(button).toBeDisabled());
      fireEvent.click(button);

      expect(mockAccept).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: '却下' })).toBeDisabled();

      await act(async () => {
        pending.resolve(makeProposal({ status: 'accepted' }));
      });
    });

    it('sends the experiment note only when it is not blank', async () => {
      renderWithClient(<ProposalActions proposal={experiment()} />);

      fireEvent.click(screen.getByRole('button', { name: '承認' }));
      fireEvent.change(
        screen.getByLabelText('実行するエージェントへの追加の指示（任意）'),
        { target: { value: 'GPU で回す' } }
      );
      fireEvent.click(screen.getByRole('button', { name: 'この内容で承認' }));

      await waitFor(() => expect(mockAccept).toHaveBeenCalledTimes(1));
      expect(mockAccept).toHaveBeenCalledWith('prop-1', {
        decision_note: 'GPU で回す',
      });
    });

    it('sends an empty body for an experiment with a blank note', async () => {
      renderWithClient(<ProposalActions proposal={experiment()} />);

      fireEvent.click(screen.getByRole('button', { name: '承認' }));
      fireEvent.change(
        screen.getByLabelText('実行するエージェントへの追加の指示（任意）'),
        { target: { value: '   ' } }
      );
      fireEvent.click(screen.getByRole('button', { name: 'この内容で承認' }));

      await waitFor(() => expect(mockAccept).toHaveBeenCalledTimes(1));
      expect(mockAccept).toHaveBeenCalledWith('prop-1', {});
    });

    it('closes the panel on cancel without sending anything', () => {
      renderWithClient(<ProposalActions proposal={experiment()} />);

      fireEvent.click(screen.getByRole('button', { name: '承認' }));
      fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));

      expect(
        screen.queryByLabelText('実行するエージェントへの追加の指示（任意）')
      ).toBeNull();
      expect(mockAccept).not.toHaveBeenCalled();
    });

    it('sends the contradiction comment as a decision note', async () => {
      renderWithClient(
        <ProposalActions proposal={makeProposal({ kind: 'contradiction' })} />
      );

      fireEvent.click(screen.getByRole('button', { name: '承認' }));
      fireEvent.change(screen.getByLabelText('コメント（任意）'), {
        target: { value: 'A is right' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'この内容で承認' }));

      await waitFor(() => expect(mockAccept).toHaveBeenCalledTimes(1));
      expect(mockAccept).toHaveBeenCalledWith('prop-1', {
        decision_note: 'A is right',
      });
    });

    it('requires an option or text for a decision request', async () => {
      renderWithClient(<ProposalActions proposal={decisionRequest()} />);

      fireEvent.click(screen.getByRole('button', { name: '承認' }));
      const submit = screen.getByRole('button', { name: 'この内容で承認' });
      expect(submit).toBeDisabled();

      fireEvent.click(screen.getByRole('radio', { name: 'SQLite' }));
      expect(submit).toBeEnabled();
      fireEvent.click(submit);

      await waitFor(() => expect(mockAccept).toHaveBeenCalledTimes(1));
      expect(mockAccept).toHaveBeenCalledWith('prop-1', { decision_option: 1 });
    });

    it('accepts a free-text answer to a decision request', async () => {
      renderWithClient(<ProposalActions proposal={decisionRequest()} />);

      fireEvent.click(screen.getByRole('button', { name: '承認' }));
      fireEvent.change(
        screen.getByLabelText('答え（選択肢を選ぶか、自由に書く）'),
        { target: { value: 'Neither' } }
      );
      fireEvent.click(screen.getByRole('button', { name: 'この内容で承認' }));

      await waitFor(() => expect(mockAccept).toHaveBeenCalledTimes(1));
      expect(mockAccept).toHaveBeenCalledWith('prop-1', {
        decision_note: 'Neither',
      });
    });
  });

  describe('reject', () => {
    it('requires a category and sends it with the note', async () => {
      renderWithClient(<ProposalActions proposal={makeProposal()} />);

      fireEvent.click(screen.getByRole('button', { name: '却下' }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('提案を却下')).toBeInTheDocument();
      const submit = within(dialog).getByRole('button', { name: '却下する' });
      expect(submit).toBeDisabled();

      fireEvent.keyDown(within(dialog).getByRole('combobox', { name: '理由' }), {
        key: 'Enter',
      });
      fireEvent.keyDown(await screen.findByRole('option', { name: '内容が誤っている' }), {
        key: 'Enter',
      });
      fireEvent.change(within(dialog).getByLabelText('補足（任意）'), {
        target: { value: '根拠が古い' },
      });
      await waitFor(() => expect(submit).toBeEnabled());
      fireEvent.click(submit);

      await waitFor(() => expect(mockReject).toHaveBeenCalledTimes(1));
      expect(mockReject).toHaveBeenCalledWith('prop-1', {
        reject_category: 'wrong',
        decision_note: '根拠が古い',
      });
      await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({ title: '提案を却下しました' })
        )
      );
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('keeps the dialog and its input open when rejecting fails', async () => {
      mockReject.mockRejectedValue(
        new ApiError(409, 'Proposal is already decided', {}, 'Proposal is already decided')
      );
      renderWithClient(<ProposalActions proposal={makeProposal()} />);

      fireEvent.click(screen.getByRole('button', { name: '却下' }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.keyDown(within(dialog).getByRole('combobox', { name: '理由' }), {
        key: 'Enter',
      });
      fireEvent.keyDown(await screen.findByRole('option', { name: '重複している' }), {
        key: 'Enter',
      });
      fireEvent.change(within(dialog).getByLabelText('補足（任意）'), {
        target: { value: 'dup' },
      });
      await waitFor(() =>
        expect(within(dialog).getByRole('button', { name: '却下する' })).toBeEnabled()
      );
      fireEvent.click(within(dialog).getByRole('button', { name: '却下する' }));

      expect(await within(dialog).findByRole('alert')).toHaveTextContent(
        'Proposal is already decided'
      );
      expect(within(dialog).getByLabelText('補足（任意）')).toHaveValue('dup');
      expect(mockToast).not.toHaveBeenCalled();
    });
  });

  describe('errors', () => {
    it('shows the server message and keeps the experiment note', async () => {
      const message = 'Proposal target no longer exists; reject it instead';
      mockAccept.mockRejectedValue(new ApiError(409, message, {}, message));
      renderWithClient(<ProposalActions proposal={experiment()} />);

      fireEvent.click(screen.getByRole('button', { name: '承認' }));
      fireEvent.change(
        screen.getByLabelText('実行するエージェントへの追加の指示（任意）'),
        { target: { value: 'keep me' } }
      );
      fireEvent.click(screen.getByRole('button', { name: 'この内容で承認' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(message);
      expect(
        screen.getByLabelText('実行するエージェントへの追加の指示（任意）')
      ).toHaveValue('keep me');
      expect(mockToast).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'この内容で承認' })).toBeEnabled();
    });

    it('shows readable lines for a 422 with a validation array', async () => {
      mockAccept.mockRejectedValue(
        new ApiError(
          422,
          'Request failed',
          {
            responseData: {
              detail: [
                {
                  loc: ['body', 'decision_option'],
                  msg: 'Input should be less than or equal to 5',
                },
              ],
            },
          },
          'Request failed'
        )
      );
      renderWithClient(<ProposalActions proposal={decisionRequest()} />);

      fireEvent.click(screen.getByRole('button', { name: '承認' }));
      fireEvent.click(screen.getByRole('radio', { name: 'Postgres' }));
      fireEvent.click(screen.getByRole('button', { name: 'この内容で承認' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'decision_option: Input should be less than or equal to 5'
      );
    });

    it('clears the error when the next attempt starts', async () => {
      mockAccept.mockRejectedValueOnce(new ApiError(409, 'boom', {}, 'boom'));
      renderWithClient(<ProposalActions proposal={makeProposal()} />);

      fireEvent.click(screen.getByRole('button', { name: '承認' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('boom');

      fireEvent.click(screen.getByRole('button', { name: '承認' }));
      await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    });
  });

  describe('edit button', () => {
    it.each(['goal', 'task', 'quick_task', 'note_append', 'experiment'] as const)(
      'is shown for %s when onEdit is passed',
      (kind) => {
        renderWithClient(
          <ProposalActions proposal={makeProposal({ kind })} onEdit={jest.fn()} />
        );
        expect(screen.getByRole('button', { name: '編集して承認' })).toBeInTheDocument();
      }
    );

    it.each(['contradiction', 'decision_request'] as const)(
      'is hidden for %s even when onEdit is passed',
      (kind) => {
        renderWithClient(
          <ProposalActions proposal={makeProposal({ kind })} onEdit={jest.fn()} />
        );
        expect(screen.queryByRole('button', { name: '編集して承認' })).toBeNull();
      }
    );

    it('is hidden when onEdit is absent', () => {
      renderWithClient(<ProposalActions proposal={makeProposal()} />);
      expect(screen.queryByRole('button', { name: '編集して承認' })).toBeNull();
    });

    it('calls onEdit when clicked', () => {
      const onEdit = jest.fn();
      renderWithClient(<ProposalActions proposal={makeProposal()} onEdit={onEdit} />);
      fireEvent.click(screen.getByRole('button', { name: '編集して承認' }));
      expect(onEdit).toHaveBeenCalledTimes(1);
    });
  });
});
