/**
 * Countdown timer hook for Runner/Focus mode
 *
 * Provides real-time countdown to a target time with 1-second precision.
 */

import { useState, useEffect, useRef } from 'react';
import { formatDuration } from '@/types/runner';

interface UseCountdownReturn {
  /** Remaining seconds (negative if overdue) */
  seconds: number;
  /** Whether the target time has passed */
  isOverdue: boolean;
  /** Formatted time string (HH:MM:SS) */
  formatted: string;
  /** Minutes remaining (for display) */
  minutesRemaining: number;
  /** Progress percentage (0-100, can exceed 100 if overdue) */
  progressPercent: number;
}

interface CountdownState {
  seconds: number;
  isOverdue: boolean;
  progressPercent: number;
}

function calculateRemaining(
  targetTime: string | Date | null | undefined,
  startTime: string | Date | null | undefined
): CountdownState {
  if (!targetTime) {
    return { seconds: 0, isOverdue: false, progressPercent: 0 };
  }

  const target = typeof targetTime === 'string' ? new Date(targetTime) : targetTime;
  const now = new Date();
  const diffMs = target.getTime() - now.getTime();
  const seconds = Math.floor(diffMs / 1000);

  // Calculate progress percentage
  let progressPercent = 0;
  if (startTime) {
    const start = typeof startTime === 'string' ? new Date(startTime) : startTime;
    const totalMs = target.getTime() - start.getTime();
    const elapsedMs = now.getTime() - start.getTime();
    progressPercent = totalMs > 0 ? Math.min(100, (elapsedMs / totalMs) * 100) : 0;
  }

  return {
    seconds,
    isOverdue: seconds < 0,
    progressPercent,
  };
}

/**
 * Hook for countdown timer functionality
 *
 * @param targetTime - The target time to count down to (ISO string or Date)
 * @param startTime - The session start time for progress calculation
 * @returns Countdown state with formatted display values
 */
export function useCountdown(
  targetTime: string | Date | null | undefined,
  startTime?: string | Date | null
): UseCountdownReturn {
  const [state, setState] = useState<CountdownState>(() =>
    calculateRemaining(targetTime, startTime)
  );

  // Use refs to store current values for the interval callback
  const targetTimeRef = useRef(targetTime);
  const startTimeRef = useRef(startTime);

  // Keep refs in sync
  useEffect(() => {
    targetTimeRef.current = targetTime;
    startTimeRef.current = startTime;
  }, [targetTime, startTime]);

  useEffect(() => {
    if (!targetTime) {
      setState({ seconds: 0, isOverdue: false, progressPercent: 0 });
      return;
    }

    // Update immediately
    setState(calculateRemaining(targetTime, startTime));

    // Update every second using refs for current values
    const interval = setInterval(() => {
      setState(calculateRemaining(targetTimeRef.current, startTimeRef.current));
    }, 1000);

    return () => clearInterval(interval);
  }, [targetTime, startTime]);

  return {
    seconds: state.seconds,
    isOverdue: state.isOverdue,
    formatted: formatDuration(state.seconds),
    minutesRemaining: Math.floor(Math.abs(state.seconds) / 60),
    progressPercent: state.progressPercent,
  };
}
