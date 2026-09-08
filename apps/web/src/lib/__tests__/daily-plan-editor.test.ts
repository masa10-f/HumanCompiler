// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import { ApiError } from '../errors';
import { extractDailyPlanMention, matchDailyPlanTasks, isPermanentDailyPlanSaveError,
  missingDailyPlanBlockIds, stripDailyPlanDuration } from '../daily-plan-editor';

describe('daily plan editor recovery and mention helpers', () => {
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
