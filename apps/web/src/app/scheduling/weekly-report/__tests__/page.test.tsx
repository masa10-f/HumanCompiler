// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import WeeklyReportPage from '../page';
import { getJSTDateString } from '@/lib/date-utils';

const mockAuth = { user: { id: 'user-1' } as { id: string } | null, loading: false };
const mockGenerateWeeklyReport = jest.fn();
const mockToast = jest.fn();

jest.mock('@/hooks/use-auth', () => ({ useAuth: () => mockAuth }));
jest.mock('@/components/layout/app-header', () => ({ AppHeader: () => null }));
jest.mock('@/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));
jest.mock('@/hooks/use-project-query', () => ({
  useProjectOptions: () => ({
    data: [
      { id: 'project-active', title: 'Active project', status: 'in_progress' },
      { id: 'project-done', title: 'Finished project', status: 'completed' },
    ],
  }),
}));
jest.mock('@/lib/api', () => ({
  reportsApi: {
    generateWeeklyReport: (...args: unknown[]) => mockGenerateWeeklyReport(...args),
  },
}));

const report = {
  week_start_date: '2030-01-07',
  week_end_date: '2030-01-13',
  work_summary: {
    total_actual_minutes: 150,
    total_estimated_hours: 4,
    total_tasks_worked: 2,
    total_completed_tasks: 1,
    overall_completion_percentage: 50,
    daily_breakdown: {},
    project_breakdown: {},
  },
  project_summaries: [],
  markdown_report: '# Weekly report\n- Finished the draft',
  generated_at: '2030-01-14T00:00:00Z',
};

describe('weekly report page', () => {
  beforeEach(() => {
    mockAuth.user = { id: 'user-1' };
    mockAuth.loading = false;
    mockGenerateWeeklyReport.mockReset();
    mockToast.mockReset();
  });

  it('generates a report for the chosen week and in-progress projects', async () => {
    mockGenerateWeeklyReport.mockResolvedValue(report);
    render(<WeeklyReportPage />);

    expect(screen.getByLabelText('報告対象週開始日')).toHaveValue(getJSTDateString());
    expect(screen.queryByText('Finished project')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('報告対象週開始日'), {
      target: { value: '2030-01-07' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Active project' }));
    fireEvent.click(screen.getByRole('button', { name: '週間作業報告を生成' }));

    await waitFor(() =>
      expect(mockGenerateWeeklyReport).toHaveBeenCalledWith('2030-01-07', ['project-active']),
    );
    expect(await screen.findByText('2.5h')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText(/Finished the draft/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'マークダウンをダウンロード' })).toBeInTheDocument();
  });

  it('does not request a report for an invalid date', () => {
    render(<WeeklyReportPage />);

    fireEvent.change(screen.getByLabelText('報告対象週開始日'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '週間作業報告を生成' }));

    expect(mockGenerateWeeklyReport).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: '日付エラー', variant: 'destructive' }),
    );
  });

  it('shows the API error when report generation fails', async () => {
    mockGenerateWeeklyReport.mockRejectedValue(new Error('OpenAI API key is not configured'));
    render(<WeeklyReportPage />);

    fireEvent.click(screen.getByRole('button', { name: '週間作業報告を生成' }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '報告書生成に失敗しました',
          description: 'OpenAI API key is not configured',
        }),
      ),
    );
    expect(mockGenerateWeeklyReport).toHaveBeenCalledWith(getJSTDateString(), undefined);
  });

  it('waits for authentication before rendering the form', () => {
    mockAuth.user = null;
    mockAuth.loading = true;
    render(<WeeklyReportPage />);

    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(screen.queryByLabelText('報告対象週開始日')).not.toBeInTheDocument();
  });
});
