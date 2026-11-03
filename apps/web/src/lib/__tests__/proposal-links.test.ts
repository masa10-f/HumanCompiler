// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import { ApiError } from '../errors'
import { proposalErrorMessage, proposalResultHref, sourceHref } from '../proposal-links'
import type { Proposal } from '@/types/proposal'

function makeProposal(overrides: Partial<Proposal>): Proposal {
  return {
    id: 'prop1',
    kind: 'goal',
    status: 'accepted',
    title: 'Title',
    rationale: 'Because',
    payload: {},
    final_payload: null,
    sources: [],
    idempotency_key: 'key',
    agent_name: 'agent',
    project_id: 'p1',
    reject_category: null,
    decision_note: null,
    decision_option: null,
    result: null,
    created_at: '2026-11-03T00:00:00Z',
    decided_at: null,
    updated_at: '2026-11-03T00:00:00Z',
    project_name: null,
    goal_title: null,
    task_title: null,
    task_goal_id: null,
    ...overrides,
  }
}

describe('proposalResultHref', () => {
  it('links a created goal', () => {
    const p = makeProposal({ kind: 'goal', result: { type: 'goal', id: 'g1' } })
    expect(proposalResultHref(p)).toBe('/projects/p1/goals/g1')
  })

  it('links a created task through payload.goal_id', () => {
    const p = makeProposal({
      kind: 'task',
      payload: { goal_id: 'g2' },
      result: { type: 'task', id: 't1' },
    })
    expect(proposalResultHref(p)).toBe('/projects/p1/goals/g2/tasks/t1')
  })

  it('prefers final_payload over payload', () => {
    const p = makeProposal({
      kind: 'task',
      payload: { goal_id: 'g2' },
      final_payload: { goal_id: 'g3' },
      result: { type: 'task', id: 't1' },
    })
    expect(proposalResultHref(p)).toBe('/projects/p1/goals/g3/tasks/t1')
  })

  it('returns null for a task without a goal_id', () => {
    const p = makeProposal({ kind: 'task', result: { type: 'task', id: 't1' } })
    expect(proposalResultHref(p)).toBeNull()
  })

  it('links a quick task to /tasks', () => {
    const p = makeProposal({
      kind: 'quick_task',
      project_id: null,
      result: { type: 'quick_task', id: 'q1' },
    })
    expect(proposalResultHref(p)).toBe('/tasks')
  })

  it('links a project note', () => {
    const p = makeProposal({
      kind: 'note_append',
      payload: { target: { project_id: 'p9' } },
      result: { type: 'context_note', id: 'n1' },
    })
    expect(proposalResultHref(p)).toBe('/projects/p9/notes')
  })

  it('links a goal note through the proposal project_id', () => {
    const p = makeProposal({
      kind: 'note_append',
      payload: { target: { goal_id: 'g4' } },
      result: { type: 'context_note', id: 'n1' },
    })
    expect(proposalResultHref(p)).toBe('/projects/p1/goals/g4/notes')
  })

  it('links a task note through task_goal_id', () => {
    const p = makeProposal({
      kind: 'note_append',
      payload: { target: { task_id: 't5' } },
      task_goal_id: 'g5',
      result: { type: 'context_note', id: 'n1' },
    })
    expect(proposalResultHref(p)).toBe('/projects/p1/goals/g5/tasks/t5')
  })

  it('returns null for a task note when task_goal_id is null', () => {
    const p = makeProposal({
      kind: 'note_append',
      payload: { target: { task_id: 't5' } },
      task_goal_id: null,
      result: { type: 'context_note', id: 'n1' },
    })
    expect(proposalResultHref(p)).toBeNull()
  })

  it('returns null when the proposal has no result', () => {
    expect(proposalResultHref(makeProposal({ kind: 'goal', result: null }))).toBeNull()
  })

  it('returns null when project_id is missing for a goal', () => {
    const p = makeProposal({
      kind: 'goal',
      project_id: null,
      result: { type: 'goal', id: 'g1' },
    })
    expect(proposalResultHref(p)).toBeNull()
  })

  it('returns null for a note without a recognised target', () => {
    const p = makeProposal({
      kind: 'note_append',
      payload: { target: {} },
      result: { type: 'context_note', id: 'n1' },
    })
    expect(proposalResultHref(p)).toBeNull()
  })
})

describe('sourceHref', () => {
  it('returns http and https refs unchanged', () => {
    expect(sourceHref('https://example.com/a')).toBe('https://example.com/a')
    expect(sourceHref('http://example.com/a')).toBe('http://example.com/a')
  })

  it('returns null for other schemes and non-URLs', () => {
    expect(sourceHref('artifact://distiller/x')).toBeNull()
    expect(sourceHref('javascript:alert(1)')).toBeNull()
    expect(sourceHref('not a url')).toBeNull()
  })
})

describe('proposalErrorMessage', () => {
  function validationError(detail: unknown) {
    return new ApiError(422, 'Validation failed', {
      responseData: { detail },
    })
  }

  it('formats a Pydantic detail array without the leading body', () => {
    const error = validationError([
      { loc: ['body', 'payload', 'title'], msg: 'Field required', type: 'missing' },
    ])
    expect(proposalErrorMessage(error)).toBe('payload.title: Field required')
  })

  it('joins several items by newline and keeps numeric path parts', () => {
    const error = validationError([
      { loc: ['body', 'payload', 'options', 1, 'label'], msg: 'Too short' },
      { loc: ['body', 'decision_option'], msg: 'Too big' },
    ])
    expect(proposalErrorMessage(error)).toBe(
      'payload.options.1.label: Too short\ndecision_option: Too big',
    )
  })

  it('drops only a leading body element', () => {
    const error = validationError([{ loc: ['query', 'limit'], msg: 'Bad' }])
    expect(proposalErrorMessage(error)).toBe('query.limit: Bad')
  })

  it('shows just the message when the path is empty', () => {
    const error = validationError([{ loc: ['body'], msg: 'Invalid body' }])
    expect(proposalErrorMessage(error)).toBe('Invalid body')
  })

  it('ignores items without a string msg and falls back when nothing is left', () => {
    const error = new ApiError(
      422,
      'Validation failed',
      { responseData: { detail: [{ loc: ['body', 'x'] }, null] } },
      'Fallback text',
    )
    expect(proposalErrorMessage(error)).toBe('Fallback text')
  })

  it('uses the error message for a non-array detail', () => {
    const error = new ApiError(
      409,
      'Proposal already decided',
      { responseData: { detail: 'Proposal already decided' } },
      'Proposal already decided',
    )
    expect(proposalErrorMessage(error)).toBe('Proposal already decided')
  })

  it('handles non-Error values', () => {
    expect(typeof proposalErrorMessage('oops')).toBe('string')
  })
})
