/**
 * Countdown timer hook for Runner/Focus mode
 *
 * Provides real-time countdown to a target time with 1-second precision.
 * Supports paused state where the countdown freezes.
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
  startTime: string | Date | null | undefined,
  pausedAt?: string | Date | null
): CountdownState {
  if (!targetTime) {
    return { seconds: 0, isOverdue: false, progressPercent: 0 };
  }

  const target = typeof targetTime === 'string' ? new Date(targetTime) : targetTime;

  // If paused, calculate remaining time from paused_at instead of now
  const now = pausedAt
    ? (typeof pausedAt === 'string' ? new Date(pausedAt) : pausedAt)
    : new Date();

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
 * @param pausedAt - If the session is paused, the time it was paused (freezes countdown)
 * @returns Countdown state with formatted display values
 */
export function useCountdown(
  targetTime: string | Date | null | undefined,
  startTime?: string | Date | null,
  pausedAt?: string | Date | null
): UseCountdownReturn {
  const [state, setState] = useState<CountdownState>(() =>
    calculateRemaining(targetTime, startTime, pausedAt)
  );

  // Use refs to store current values for the interval callback
  const targetTimeRef = useRef(targetTime);
  const startTimeRef = useRef(startTime);
  const pausedAtRef = useRef(pausedAt);

  // Keep refs in sync
  useEffect(() => {
    targetTimeRef.current = targetTime;
    startTimeRef.current = startTime;
    pausedAtRef.current = pausedAt;
  }, [targetTime, startTime, pausedAt]);

  useEffect(() => {
    if (!targetTime) {
      setState({ seconds: 0, isOverdue: false, progressPercent: 0 });
      return;
    }

    // Update immediately
    setState(calculateRemaining(targetTime, startTime, pausedAt));

    // If paused, don't start interval - countdown is frozen
    if (pausedAt) {
      return;
    }

    // Update every second using refs for current values
    const interval = setInterval(() => {
      // Check if we've been paused in the meantime
      if (pausedAtRef.current) {
        return;
      }
      setState(calculateRemaining(targetTimeRef.current, startTimeRef.current, pausedAtRef.current));
    }, 1000);

    return () => clearInterval(interval);
  }, [targetTime, startTime, pausedAt]);

  return {
    seconds: state.seconds,
    isOverdue: state.isOverdue,
    formatted: formatDuration(state.seconds),
    minutesRemaining: Math.floor(Math.abs(state.seconds) / 60),
    progressPercent: state.progressPercent,
  };
}
