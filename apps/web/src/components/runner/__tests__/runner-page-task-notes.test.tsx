// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/**
 * @jest-environment jsdom
 */
import { useEffect } from 'react';
import { render } from '@testing-library/react';
import { RunnerPage } from '../runner-page';

const mockUseRunner = jest.fn();
const mockNoteMounts: string[] = [];
const mockNoteUnmounts: string[] = [];

jest.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, loading: false }),
}));
jest.mock('@/hooks/use-runner', () => ({ useRunner: () => mockUseRunner() }));
jest.mock('@/hooks/use-toast', () => ({ toast: jest.fn() }));
jest.mock('@/hooks/use-reschedule', () => ({
  useReschedule: () => ({
    acceptSuggestion: jest.fn(),
    rejectSuggestion: jest.fn(),
    isAccepting: false,
    isRejecting: false,
  }),
}));
jest.mock('@/lib/runner/route-task-id', () => ({ consumeRunnerTaskId: () => null }));
jest.mock('@/lib/api', () => ({
  tasksApi: { getById: jest.fn() },
  goalsApi: { getById: jest.fn() },
  projectsApi: { getById: jest.fn() },
}));
jest.mock('@/components/layout/app-header', () => ({ AppHeader: () => null }));
jest.mock('../session-display', () => ({ SessionDisplay: () => null }));
jest.mock('../countdown-timer', () => ({ CountdownTimer: () => null }));
jest.mock('../action-buttons', () => ({ ActionButtons: () => null }));
jest.mock('../task-switcher', () => ({ TaskSwitcher: () => null }));
jest.mock('../start-session-dialog', () => ({ StartSessionDialog: () => null }));
jest.mock('../manual-task-select-dialog', () => ({ ManualTaskSelectDialog: () => null }));
jest.mock('../task-picker-dialog', () => ({ TaskPickerDialog: () => null }));
jest.mock('../task-switch-dialog', () => ({ TaskSwitchDialog: () => null }));
jest.mock('../checkout-dialog', () => ({ CheckoutDialog: () => null }));
jest.mock('../pause-dialog', () => ({ PauseDialog: () => null }));
jest.mock('../resume-dialog', () => ({ ResumeDialog: () => null }));
jest.mock('../notification-banner', () => ({ NotificationBanner: () => null }));
jest.mock('../reschedule-suggestion-card', () => ({ RescheduleSuggestionCard: () => null }));
// Records each mount, as the real section's useNote state lives per mount.
jest.mock('../task-notes-section', () => ({
  TaskNotesSection: ({ taskId }: { taskId: string }) => {
    useEffect(() => {
      mockNoteMounts.push(taskId);
      return () => {
        mockNoteUnmounts.push(taskId);
      };
      // Only the first taskId of a mount: a prop change is not a remount.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return null;
  },
}));

function runnerState(taskId: string) {
  return {
    session: {
      id: `session-${taskId}`,
      task_id: taskId,
      started_at: '2026-11-03T09:00:00Z',
      planned_checkout_at: '2026-11-03T10:00:00Z',
      paused_at: null,
    },
    sessionDetails: {
      task: { id: taskId, title: taskId, goal_id: 'goal-1' },
      goal: null,
      project: null,
    },
    sessionStatus: 'active',
    remainingSeconds: 600,
    isOverdue: false,
    isPaused: false,
    nextCandidates: [],
    todaySchedule: null,
    isLoading: false,
    isStarting: false,
    isCheckingOut: false,
    isPausing: false,
    isResuming: false,
    isSwitching: false,
    startSession: jest.fn(),
    checkout: jest.fn(),
    pauseSession: jest.fn(),
    resumeSession: jest.fn(),
    switchSession: jest.fn(),
    currentNotification: null,
    dismissNotification: jest.fn(),
    snoozeSession: jest.fn(),
    isSnoozing: false,
    snoozeCount: 0,
    maxSnoozeCount: 3,
  };
}

describe('RunnerPage task notes', () => {
  it('remounts the notes section when the task changes, dropping its note state', () => {
    mockUseRunner.mockReturnValue(runnerState('task-a'));
    const { rerender } = render(<RunnerPage />);
    expect(mockNoteMounts).toEqual(['task-a']);

    mockUseRunner.mockReturnValue(runnerState('task-b'));
    rerender(<RunnerPage />);

    expect(mockNoteUnmounts).toEqual(['task-a']);
    expect(mockNoteMounts).toEqual(['task-a', 'task-b']);
  });
});
