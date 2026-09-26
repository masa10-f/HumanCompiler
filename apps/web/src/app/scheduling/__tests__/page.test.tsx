// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import { render, screen, within } from '@testing-library/react';
import SchedulingHomePage from '../page';

const mockAuth = { user: { id: 'user-1' } as { id: string } | null, loading: false };

jest.mock('@/hooks/use-auth', () => ({ useAuth: () => mockAuth }));
jest.mock('@/components/layout/app-header', () => ({ AppHeader: () => null }));

describe('scheduling overview page', () => {
  beforeEach(() => {
    mockAuth.user = { id: 'user-1' };
    mockAuth.loading = false;
  });

  it('leads with the daily plan and describes each supporting page', () => {
    render(<SchedulingHomePage />);

    const daily = screen.getByRole('region', { name: '日次計画' });
    expect(within(daily).getByRole('link', { name: '今日のノートを開く' })).toHaveAttribute(
      'href',
      '/scheduling/daily',
    );
    expect(within(daily).getByText('/schedule 13:00-17:00 (90m)')).toBeInTheDocument();

    const review = screen.getByRole('region', { name: '振り返り' });
    expect(within(review).getByRole('link', { name: /スケジュール履歴/ })).toHaveAttribute(
      'href',
      '/scheduling/history',
    );
    expect(within(review).getByRole('link', { name: /週間作業報告/ })).toHaveAttribute(
      'href',
      '/scheduling/weekly-report',
    );
    expect(within(review).getByText(/OpenAI API キー/)).toBeInTheDocument();

    const settings = screen.getByRole('region', { name: '設定' });
    expect(within(settings).getByRole('link', { name: /スケジュール調整/ })).toHaveAttribute(
      'href',
      '/scheduling/tuning',
    );
    expect(within(settings).getByText(/このブラウザでの自動スケジュール/)).toBeInTheDocument();
  });

  it('waits for authentication before rendering', () => {
    mockAuth.user = null;
    mockAuth.loading = true;
    render(<SchedulingHomePage />);

    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '今日のノートを開く' })).not.toBeInTheDocument();
  });
});
