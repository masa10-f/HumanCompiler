// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SchedulingPage from '../page';
import { getJSTDateString } from '@/lib/date-utils';

const mockAuth = { user: { id: 'user-1' } as { id: string } | null, loading: false };

jest.mock('@/hooks/use-auth', () => ({ useAuth: () => mockAuth }));
jest.mock('@/components/scheduling/daily-plan-workspace', () => ({
  DailyPlanWorkspace: ({ selectedDate, onSelectedDateChange }: {
    selectedDate: string;
    onSelectedDateChange: (date: string) => void;
  }) => (
    <div>
      <span data-testid="selected-date">{selectedDate}</span>
      <button onClick={() => onSelectedDateChange('2030-01-03')}>Next day</button>
    </div>
  ),
}));

describe('daily planning page', () => {
  beforeEach(() => {
    mockAuth.user = { id: 'user-1' };
    mockAuth.loading = false;
  });

  it('keeps the selected date in the URL and restores it when reopening', async () => {
    window.history.replaceState({ marker: 'keep' }, '', '/scheduling/daily?date=2030-01-02');
    const view = render(<SchedulingPage />);
    expect(screen.getByTestId('selected-date')).toHaveTextContent('2030-01-02');

    fireEvent.click(screen.getByRole('button', { name: 'Next day' }));
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('date')).toBe('2030-01-03'));
    expect(window.history.state).toEqual({ marker: 'keep' });

    view.unmount();
    render(<SchedulingPage />);
    expect(screen.getByTestId('selected-date')).toHaveTextContent('2030-01-03');
  });

  it('falls back to today for an invalid date parameter', () => {
    window.history.replaceState({}, '', '/scheduling/daily?date=not-a-date');
    render(<SchedulingPage />);
    expect(screen.getByTestId('selected-date')).toHaveTextContent(getJSTDateString());
  });

  it('waits for authentication before rendering the note', () => {
    mockAuth.user = null;
    mockAuth.loading = true;
    render(<SchedulingPage />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(screen.queryByTestId('selected-date')).not.toBeInTheDocument();
  });
});
