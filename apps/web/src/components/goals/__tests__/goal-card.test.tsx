import { render, screen } from '@testing-library/react'

import { GoalCard } from '../goal-card'
import type { Goal } from '@/types/goal'

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
})
