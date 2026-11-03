// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ProposalCard } from '../proposal-card';
import type { Proposal } from '@/types/proposal';

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
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

describe('ProposalCard', () => {
  describe('kinds', () => {
    it('renders a goal', () => {
      renderWithClient(
        <ProposalCard
          proposal={makeProposal({
            kind: 'goal',
            payload: {
              project_id: 'p1',
              title: 'Payload goal title',
              description: 'Goal description',
              due_date: '2026-12-01T00:00:00Z',
            },
          })}
        />
      );
      expect(screen.getByText('Goal')).toBeInTheDocument();
      expect(screen.getByText('Payload goal title')).toBeInTheDocument();
      expect(screen.getByText('Goal description')).toBeInTheDocument();
      expect(screen.getByText('research-agent')).toBeInTheDocument();
      expect(screen.getByText('My Project')).toBeInTheDocument();
    });

    it('renders a task with its goal and work type label', () => {
      renderWithClient(
        <ProposalCard
          proposal={makeProposal({
            kind: 'task',
            goal_title: 'Parent goal',
            payload: {
              goal_id: 'g1',
              title: 'Payload task title',
              estimate_hours: 2.5,
              work_type: 'focused_work',
              priority: 4,
            },
          })}
        />
      );
      expect(screen.getByText('タスク')).toBeInTheDocument();
      expect(screen.getByText('Payload task title')).toBeInTheDocument();
      expect(screen.getByText('Parent goal')).toBeInTheDocument();
      expect(screen.getByText('2.5h')).toBeInTheDocument();
      expect(screen.getByText('集中作業')).toBeInTheDocument();
    });

    it('renders a quick task', () => {
      renderWithClient(
        <ProposalCard
          proposal={makeProposal({
            kind: 'quick_task',
            payload: { title: 'Payload quick title', description: 'Quick desc' },
          })}
        />
      );
      expect(screen.getByText('クイックタスク')).toBeInTheDocument();
      expect(screen.getByText('Payload quick title')).toBeInTheDocument();
      expect(screen.getByText('Quick desc')).toBeInTheDocument();
    });

    it('renders a note append with the target name and content', () => {
      renderWithClient(
        <ProposalCard
          proposal={makeProposal({
            kind: 'note_append',
            goal_title: 'Target goal',
            payload: {
              target: { goal_id: 'g1' },
              content_markdown: '# Heading\n- item',
            },
          })}
        />
      );
      expect(screen.getByText('ノート追記')).toBeInTheDocument();
      expect(screen.getByText('Target goal')).toBeInTheDocument();
      expect(
        screen.getByText((_, el) => el?.textContent === '# Heading\n- item' && el.tagName === 'DD')
      ).toBeInTheDocument();
    });

    it('shows （削除済み） for a note target that was deleted', () => {
      renderWithClient(
        <ProposalCard
          proposal={makeProposal({
            kind: 'note_append',
            task_title: null,
            payload: { target: { task_id: 't1' }, content_markdown: 'text' },
          })}
        />
      );
      expect(screen.getByText('（削除済み）')).toBeInTheDocument();
    });

    it('renders an experiment', () => {
      renderWithClient(
        <ProposalCard
          proposal={makeProposal({
            kind: 'experiment',
            payload: {
              question: 'Does X help?',
              method: 'Try X for a week',
              supports_if: 'It gets faster',
              refutes_if: 'It gets slower',
              effort: 'low',
              estimated_hours: 3,
              prerequisites: 'Install Y',
            },
          })}
        />
      );
      expect(screen.getByText('実験')).toBeInTheDocument();
      expect(screen.getByText('Does X help?')).toBeInTheDocument();
      expect(screen.getByText('Try X for a week')).toBeInTheDocument();
      expect(screen.getByText('It gets faster')).toBeInTheDocument();
      expect(screen.getByText('It gets slower')).toBeInTheDocument();
      expect(screen.getByText('Install Y')).toBeInTheDocument();
    });

    it('renders a decision request with numbered options', () => {
      renderWithClient(
        <ProposalCard
          proposal={makeProposal({
            kind: 'decision_request',
            payload: {
              question: 'Which database?',
              options: [
                { label: 'Postgres', description: 'Relational' },
                { label: 'SQLite' },
              ],
              recommendation: 'Use Postgres',
              context: 'Some context',
            },
          })}
        />
      );
      expect(screen.getByText('判断の依頼')).toBeInTheDocument();
      expect(screen.getByText('Which database?')).toBeInTheDocument();
      expect(screen.getByText('Postgres')).toBeInTheDocument();
      expect(screen.getByText('Relational')).toBeInTheDocument();
      expect(screen.getByText('SQLite')).toBeInTheDocument();
      expect(screen.getByText('Use Postgres')).toBeInTheDocument();
      expect(screen.getByText('Some context')).toBeInTheDocument();
      expect(screen.getAllByRole('listitem')).toHaveLength(2);
    });

    it('renders a contradiction with claims and sources', () => {
      renderWithClient(
        <ProposalCard
          proposal={makeProposal({
            kind: 'contradiction',
            payload: {
              claims: [
                { text: 'Claim A', source_ref: 'artifact://a' },
                { text: 'Claim B' },
              ],
              explanation: 'They disagree',
              suggested_resolution: 'Keep A',
            },
          })}
        />
      );
      expect(screen.getByText('矛盾')).toBeInTheDocument();
      expect(screen.getByText('Claim A')).toBeInTheDocument();
      expect(screen.getByText('artifact://a')).toBeInTheDocument();
      expect(screen.getByText('Claim B')).toBeInTheDocument();
      expect(screen.getByText('They disagree')).toBeInTheDocument();
      expect(screen.getByText('Keep A')).toBeInTheDocument();
    });
  });

  describe('untrusted text', () => {
    it('renders a script-looking title as text', () => {
      const title = '<script>alert(1)</script>';
      const { container } = renderWithClient(
        <ProposalCard proposal={makeProposal({ title })} />
      );
      expect(screen.getByText(title)).toBeInTheDocument();
      expect(container.querySelector('script')).toBeNull();
    });

    it('renders a 2000-character unbroken rationale as text that can wrap', () => {
      const rationale = 'a'.repeat(2000);
      renderWithClient(<ProposalCard proposal={makeProposal({ rationale })} />);
      const paragraph = screen.getByText(rationale);
      expect(paragraph).toHaveClass('whitespace-pre-wrap', 'break-words');
    });
  });

  describe('rationale toggle', () => {
    it('collapses a long rationale and toggles it', () => {
      renderWithClient(
        <ProposalCard proposal={makeProposal({ rationale: 'b'.repeat(301) })} />
      );
      const paragraph = screen.getByText('b'.repeat(301));
      expect(paragraph).toHaveClass('line-clamp-5');

      fireEvent.click(screen.getByRole('button', { name: '続きを読む' }));
      expect(paragraph).not.toHaveClass('line-clamp-5');

      fireEvent.click(screen.getByRole('button', { name: '折りたたむ' }));
      expect(paragraph).toHaveClass('line-clamp-5');
    });

    it('offers the toggle for more than 5 lines', () => {
      renderWithClient(
        <ProposalCard proposal={makeProposal({ rationale: '1\n2\n3\n4\n5\n6' })} />
      );
      expect(screen.getByRole('button', { name: '続きを読む' })).toBeInTheDocument();
    });

    it('has no toggle for a short rationale', () => {
      renderWithClient(
        <ProposalCard proposal={makeProposal({ rationale: '1\n2\n3\n4\n5' })} />
      );
      expect(screen.queryByRole('button', { name: '続きを読む' })).toBeNull();
    });
  });

  describe('sources', () => {
    it('links an https source safely and shows other refs as text', () => {
      renderWithClient(
        <ProposalCard
          proposal={makeProposal({
            sources: [
              { ref: 'https://example.com/paper', label: 'The paper', quote: 'A quote' },
              { ref: 'artifact://notes/1' },
              { ref: 'javascript:alert(1)' },
            ],
          })}
        />
      );
      const link = screen.getByRole('link', { name: 'The paper' });
      expect(link).toHaveAttribute('href', 'https://example.com/paper');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      expect(link).toHaveAttribute('target', '_blank');
      expect(screen.getByText('A quote').tagName).toBe('BLOCKQUOTE');
      expect(screen.getByText('artifact://notes/1')).toBeInTheDocument();
      expect(screen.getByText('javascript:alert(1)')).toBeInTheDocument();
      expect(screen.getAllByRole('link')).toHaveLength(1);
    });
  });

  describe('project', () => {
    it('shows （削除済み） when the project was deleted', () => {
      renderWithClient(
        <ProposalCard
          proposal={makeProposal({ project_id: 'p1', project_name: null })}
        />
      );
      expect(screen.getByText('（削除済み）')).toBeInTheDocument();
    });

    it('shows no project when the proposal has none', () => {
      renderWithClient(
        <ProposalCard
          proposal={makeProposal({ project_id: null, project_name: null })}
        />
      );
      expect(screen.queryByText('（削除済み）')).toBeNull();
    });
  });

  describe('unexpected payloads', () => {
    it('renders a task without due_date and with a non-numeric priority', () => {
      renderWithClient(
        <ProposalCard
          proposal={makeProposal({
            kind: 'task',
            payload: { goal_id: 'g1', title: 'Odd task', priority: 'high' },
          })}
        />
      );
      expect(screen.getByText('Odd task')).toBeInTheDocument();
      expect(screen.getByText('high')).toBeInTheDocument();
    });

    it('does not throw on wrong value types', () => {
      renderWithClient(
        <ProposalCard
          proposal={makeProposal({
            kind: 'decision_request',
            payload: { question: { a: 1 }, options: 'nope', context: ['x'] },
          })}
        />
      );
      expect(screen.getByText('判断の依頼')).toBeInTheDocument();
    });
  });

  describe('decided proposals', () => {
    it('shows the rejection status, reason and note', () => {
      renderWithClient(
        <ProposalCard
          proposal={makeProposal({
            status: 'rejected',
            reject_category: 'duplicate',
            decision_note: 'Already tracked elsewhere',
            decided_at: '2026-11-04T03:00:00Z',
          })}
        />
      );
      expect(screen.getByText('却下')).toBeInTheDocument();
      expect(screen.getByText('重複している')).toBeInTheDocument();
      expect(screen.getByText('Already tracked elsewhere')).toBeInTheDocument();
    });

    it('links to the created goal', () => {
      renderWithClient(
        <ProposalCard
          proposal={makeProposal({
            status: 'accepted',
            decided_at: '2026-11-04T03:00:00Z',
            result: { type: 'goal', id: 'g9' },
          })}
        />
      );
      expect(screen.getByText('承認済み')).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: '作成した Goal を開く' })
      ).toHaveAttribute('href', '/projects/p1/goals/g9');
    });

    it('shows the chosen option of a decision request from the final payload', () => {
      renderWithClient(
        <ProposalCard
          proposal={makeProposal({
            kind: 'decision_request',
            status: 'accepted',
            decision_option: 1,
            payload: { question: 'Q?', options: [{ label: 'First' }, { label: 'Second' }] },
            final_payload: {
              question: 'Q?',
              options: [{ label: 'First' }, { label: 'Second' }],
            },
          })}
        />
      );
      expect(screen.getByTestId('chosen-option')).toHaveTextContent('Second');
    });

    it('omits the chosen option when the index does not exist', () => {
      renderWithClient(
        <ProposalCard
          proposal={makeProposal({
            kind: 'decision_request',
            status: 'accepted',
            decision_option: 4,
            payload: { question: 'Q?', options: [{ label: 'First' }] },
          })}
        />
      );
      expect(screen.queryByTestId('chosen-option')).toBeNull();
    });
  });

  it('renders the actions slot', () => {
    renderWithClient(
      <ProposalCard
        proposal={makeProposal()}
        actions={<button type="button">slot</button>}
      />
    );
    expect(screen.getByRole('button', { name: 'slot' })).toBeInTheDocument();
  });
});
