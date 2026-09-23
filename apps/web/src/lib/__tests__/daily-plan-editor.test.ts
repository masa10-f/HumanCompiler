// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import { ApiError } from '../errors';
import { applyDirectiveTaskSelection, extractDailyPlanMention, matchDailyPlanTasks,
  isPermanentDailyPlanSaveError, missingDailyPlanBlockIds, stripDailyPlanDuration } from '../daily-plan-editor';

describe('daily plan editor recovery and mention helpers', () => {
  it.each([
    '/schedule @論文読み 13:00-17:00 (2h)',
    '/schedule @論文読み 1300-1700',
    '/schedule @論文読み 9:00 – 11:00',
    '/schedule 13:00-17:00 @論文読み (2h)',
    '/schedule @論文読み (2h) 13:00-17:00',
    '[] @論文読み (30m)',
    '1100-1200 @論文読み',
  ])('extracts the task name without schedule tokens from %s', (input) => {
    const task = { title: '論文読み' };
    expect(extractDailyPlanMention(input)).toBe(task.title);
    expect(matchDailyPlanTasks(input, [task])).toEqual([task]);
  });
  it('preserves spaces and numbers in task titles', () => {
    expect(extractDailyPlanMention('/schedule @Chapter 2 review 1300-1700')).toBe('Chapter 2 review');
    expect(extractDailyPlanMention('/schedule 1300-1700 @Release 2026-09')).toBe('Release 2026-09');
  });
  it.each(['/schedule @ 13:00-17:00', '/schedule 1300-1700 @', '/schedule @ (30m)'])('ignores an empty mention in %s', (input) => {
    expect(extractDailyPlanMention(input)).toBeUndefined();
  });
  it('returns all ambiguous matches and prefers exact matches', () => {
    const options = [{ title: 'コードレビュー' }, { title: '論文レビュー' }];
    expect(matchDailyPlanTasks('/schedule @レビュー (1h)', options)).toEqual(options);
    const exact = { title: 'レビュー' };
    expect(matchDailyPlanTasks('/schedule @レビュー (1h)', [...options, exact])).toEqual([exact]);
    expect(matchDailyPlanTasks('/schedule @レビュー', [exact, exact])).toHaveLength(2);
  });
  it('does not interpret an email address as a mention', () => {
    expect(extractDailyPlanMention('1100-1200 tanaka@example.com と打合せ')).toBeUndefined();
  });
  it.each([400, 401, 403, 404, 422])('does not retry HTTP %s automatically', (code) => {
    expect(isPermanentDailyPlanSaveError(new ApiError(code, 'failure'))).toBe(true);
  });
  it.each([408, 429, 500, 503])('allows retrying HTTP %s', (code) => {
    expect(isPermanentDailyPlanSaveError(new ApiError(code, 'failure'))).toBe(false);
  });
  it('keeps structured missing block IDs without trusting malformed data', () => {
    expect(missingDailyPlanBlockIds(new ApiError(404, 'missing', { responseData: {
      detail: { missing: [{ block_id: 'pin' }, null, { block_id: 1 }] },
    } }))).toEqual(['pin']);
    expect(missingDailyPlanBlockIds(new ApiError(404, 'missing'))).toEqual([]);
  });
  it('removes only a duration suffix from the checklist title', () => {
    expect(stripDailyPlanDuration('買い物 (30m)')).toBe('買い物');
    expect(stripDailyPlanDuration('調査 (1h30m)')).toBe('調査');
    expect(stripDailyPlanDuration('調査 (資料)')).toBe('調査 (資料)');
  });
});

describe('applyDirectiveTaskSelection', () => {
  it('falls back to a valid filter directive when task selection is cleared', () => {
    const directive = {
      id: 'directive',
      type: 'schedule_directive' as const,
      mode: 'task' as const,
      task_ref: { source: 'task' as const, id: 'task-1' },
      title: 'Task',
    };

    expect(applyDirectiveTaskSelection(directive)).toEqual({
      ...directive,
      mode: 'filter',
      task_ref: undefined,
      filter: { work_types: [], project_ids: [], goal_ids: [] },
    });
  });

  it('switches to a specific-task directive when a task is chosen', () => {
    const directive = {
      id: 'directive',
      type: 'schedule_directive' as const,
      mode: 'filter' as const,
      filter: { work_types: ['study' as const], project_ids: [], goal_ids: [] },
    };

    expect(
      applyDirectiveTaskSelection(directive, { ref: { source: 'quick_task', id: 'q-1' }, title: 'Inbox' }),
    ).toEqual({
      ...directive,
      mode: 'task',
      task_ref: { source: 'quick_task', id: 'q-1' },
      title: 'Inbox',
      filter: undefined,
    });
  });
});
