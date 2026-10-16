'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { DailyPlanWorkspace } from '@/components/scheduling/daily-plan-workspace';
import { getJSTDateString, isValidJSTDateInput } from '@/lib/date-utils';

function initialSelectedDate(): string {
  const date =
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('date');
  return date && isValidJSTDateInput(date) ? date : getJSTDateString();
}

export default function SchedulingPage() {
  const { user, loading: authLoading } = useAuth();
  const [selectedDate, setSelectedDate] = useState(initialSelectedDate);

  useEffect(() => {
    if (!isValidJSTDateInput(selectedDate)) return;
    const url = new URL(window.location.href);
    url.searchParams.set('date', selectedDate);
    window.history.replaceState(window.history.state, '', url);
  }, [selectedDate]);

  if (authLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  return <DailyPlanWorkspace selectedDate={selectedDate} onSelectedDateChange={setSelectedDate} />;
}
