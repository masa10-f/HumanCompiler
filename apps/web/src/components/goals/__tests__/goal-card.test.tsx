// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import { render, screen } from '@testing-library/react'

import { GoalCard } from '../goal-card'
import type { Goal } from '@/types/goal'
import type { GoalProgress } from '@/types/progress'

jest.mock('../goal-status-dropdown', () => ({
  GoalStatusDropdown: () => <div>status</div>,
}))

jest.mock('../goal-dependencies', () => ({
  GoalDependencies: () => <div>dependencies</div>,
}))

jest.mock('../goal-edit-dialog', () => ({
  GoalEditDialog: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

jest.mock('../goal-delete-dialog', () => ({
  GoalDeleteDialog: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const baseGoal: Goal = {
  id: 'goal-1',
  title: '期限付きゴール',
  description: '説明',
  estimate_hours: 10,
  due_date: '2026-09-30T00:00:00Z',
  status: 'pending',
  project_id: 'project-1',
  created_at: '2026-08-30T00:00:00Z',
  updated_at: '2026-08-30T00:00:00Z',
}

describe('GoalCard', () => {
  it('設定された期限を表示する', () => {
    render(<GoalCard goal={baseGoal} allGoals={[baseGoal]} onNavigate={jest.fn()} />)

    expect(screen.getByText('期限: 2026/9/30')).toBeInTheDocument()
  })

  it('期限が未設定の場合は期限ラベルを表示しない', () => {
    render(
      <GoalCard
        goal={{ ...baseGoal, due_date: null }}
        allGoals={[{ ...baseGoal, due_date: null }]}
        onNavigate={jest.fn()}
      />,
    )

    expect(screen.queryByText(/^期限:/)).not.toBeInTheDocument()
  })

  it('不正な期限でもカード一覧を表示し続ける', () => {
    render(
      <GoalCard
        goal={{ ...baseGoal, due_date: 'invalid-date' }}
        allGoals={[{ ...baseGoal, due_date: 'invalid-date' }]}
        onNavigate={jest.fn()}
      />,
    )

    expect(screen.getByText('期限: 日付不明')).toBeInTheDocument()
    expect(screen.getByText(baseGoal.title)).toBeInTheDocument()
  })

  it('進捗データからダイジェストを表示する', () => {
    const progress: GoalProgress = {
      goal_id: baseGoal.id,
      title: baseGoal.title,
      estimate_hours: 10,
      actual_minutes: 270,
      progress_percentage: 45,
      tasks: [
        { task_id: 't1', title: 'A', estimate_hours: 2, actual_minutes: 120, progress_percentage: 100, status: 'completed' },
        { task_id: 't2', title: 'B', estimate_hours: 3, actual_minutes: 150, progress_percentage: 83, status: 'in_progress' },
        { task_id: 't3', title: 'C', estimate_hours: 1, actual_minutes: 0, progress_percentage: 0, status: 'pending' },
        { task_id: 't4', title: 'D', estimate_hours: 1, actual_minutes: 0, progress_percentage: 0, status: 'cancelled' },
      ],
    }

    render(
      <GoalCard
        goal={baseGoal}
        allGoals={[baseGoal]}
        progress={progress}
        onNavigate={jest.fn()}
      />,
    )

    expect(screen.getByText('33%')).toBeInTheDocument()
    expect(screen.getByText('1/3 タスク完了')).toBeInTheDocument()
    expect(screen.getByText('実績 4.5h / 見積 10h')).toBeInTheDocument()
    expect(screen.getByText('残り 4h')).toBeInTheDocument()
  })

  it('進捗データがない場合は見積のみ表示する', () => {
    render(<GoalCard goal={baseGoal} allGoals={[baseGoal]} onNavigate={jest.fn()} />)

    expect(screen.getByText('見積 10h')).toBeInTheDocument()
    expect(screen.queryByText(/タスク完了/)).not.toBeInTheDocument()
  })

  it('未完了の依存先がある場合は依存待ちを表示する', () => {
    const dependency: Goal = { ...baseGoal, id: 'goal-0', status: 'in_progress' }
    const goal: Goal = {
      ...baseGoal,
      dependencies: [
        {
          id: 'dep-1',
          goal_id: baseGoal.id,
          depends_on_goal_id: dependency.id,
          created_at: '2026-08-30T00:00:00Z',
        },
      ],
    }

    render(<GoalCard goal={goal} allGoals={[dependency, goal]} onNavigate={jest.fn()} />)

    expect(screen.getByText('依存待ち 1件')).toBeInTheDocument()
  })

  it('完了したゴールには期限の残日数を表示しない', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-28T00:00:00Z'))
    try {
      const { rerender } = render(
        <GoalCard goal={baseGoal} allGoals={[baseGoal]} onNavigate={jest.fn()} />,
      )
      expect(screen.getByText('あと2日')).toBeInTheDocument()

      const completed: Goal = { ...baseGoal, status: 'completed' }
      rerender(<GoalCard goal={completed} allGoals={[completed]} onNavigate={jest.fn()} />)
      expect(screen.queryByText('あと2日')).not.toBeInTheDocument()
    } finally {
      jest.useRealTimers()
    }
  })
})
