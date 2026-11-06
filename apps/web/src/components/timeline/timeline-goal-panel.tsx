// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

'use client'

import React from 'react'
import { ArrowDownRight, ArrowUpLeft, CheckCircle2, Circle, CircleDot, X, XCircle } from 'lucide-react'
import { formatJstDate } from '@/lib/timeline/geometry'
import type { ScheduledGoal, TimelineSchedule, WorkStatus } from '@/lib/timeline/types'
import { formatHours } from '@/lib/timeline/utils'

const PHASE_BADGE = {
  done: { label: '完了', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900' },
  active: { label: '進行中', className: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:ring-blue-900' },
  planned: { label: '未着手', className: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700' },
} as const

const TASK_ICON: Record<WorkStatus, { icon: React.ComponentType<{ className?: string }>; className: string }> = {
  completed: { icon: CheckCircle2, className: 'text-emerald-500' },
  in_progress: { icon: CircleDot, className: 'text-blue-500' },
  pending: { icon: Circle, className: 'text-slate-400' },
  cancelled: { icon: XCircle, className: 'text-slate-300' },
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: 'late' }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{label}</dt>
      <dd
        className={`mt-0.5 truncate text-sm font-semibold ${
          tone === 'late' ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-white'
        }`}
      >
        {value}
      </dd>
    </div>
  )
}

function GoalLinkList({
  title,
  icon: Icon,
  goals,
  onSelectGoal,
}: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  goals: ScheduledGoal[]
  onSelectGoal: (goalId: string) => void
}) {
  if (goals.length === 0) return null
  return (
    <section>
      <h4 className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </h4>
      <ul className="mt-2 space-y-1">
        {goals.map((goal) => (
          <li key={goal.id}>
            <button
              type="button"
              onClick={() => onSelectGoal(goal.id)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-slate-800"
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  goal.phase === 'done'
                    ? 'bg-emerald-500'
                    : goal.phase === 'active'
                      ? 'bg-blue-500'
                      : 'bg-slate-300 dark:bg-slate-600'
                }`}
              />
              <span className="min-w-0 flex-1 truncate text-slate-800 dark:text-slate-100">
                {goal.title}
              </span>
              <span className="shrink-0 text-[11px] text-slate-500">
                {goal.phase === 'done' ? '完了' : `〜${formatJstDate(goal.finish)}`}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function TimelineGoalPanel({
  goal,
  schedule,
  onClose,
  onSelectGoal,
}: {
  goal: ScheduledGoal
  schedule: TimelineSchedule
  onClose: () => void
  onSelectGoal: (goalId: string) => void
}) {
  const byId = new Map(schedule.goals.map((item) => [item.id, item]))
  const lookup = (ids: string[]) =>
    ids.map((id) => byId.get(id)).filter((item): item is ScheduledGoal => Boolean(item))
  const badge = PHASE_BADGE[goal.phase]
  const percentage = Math.round(goal.progress * 100)

  return (
    <div className="flex h-full flex-col" aria-label={`${goal.title}の詳細`} role="region">
      <div className="flex items-start gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <div className="min-w-0 flex-1">
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${badge.className}`}
          >
            {badge.label}
          </span>
          <h3 className="mt-2 text-base font-semibold leading-snug text-slate-950 dark:text-white">
            {goal.title}
          </h3>
          {goal.source.description && (
            <p className="mt-1 line-clamp-3 text-xs leading-5 text-slate-500 dark:text-slate-400">
              {goal.source.description}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-slate-800"
          aria-label="詳細を閉じる"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
        <section>
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">進捗</span>
            <span className="font-mono text-lg font-semibold text-slate-950 dark:text-white">
              {percentage}%
            </span>
          </div>
          <div
            className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percentage}
            aria-label="ゴールの進捗"
          >
            <div
              className={`h-full rounded-full ${goal.phase === 'done' ? 'bg-emerald-500' : 'bg-blue-600'}`}
              style={{ width: `${percentage}%` }}
            />
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-3">
            <Fact label="実績" value={formatHours(goal.actualHours)} />
            <Fact label="残り" value={formatHours(goal.remainingHours)} />
            <Fact label="見積" value={formatHours(goal.estimateHours)} />
          </dl>
        </section>

        <section className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
          <dl className="grid grid-cols-2 gap-3">
            <Fact label="着手" value={goal.actual ? formatJstDate(goal.actual.start, true) : goal.planned ? `${formatJstDate(goal.planned.start, true)} 予定` : '—'} />
            <Fact
              label={goal.phase === 'done' ? '完了' : '完了見込み'}
              value={formatJstDate(goal.finish, true)}
              tone={goal.delayDays > 0 ? 'late' : undefined}
            />
            <Fact label="期限" value={goal.dueDate ? formatJstDate(goal.dueDate, true) : '未設定'} />
            <Fact
              label="期限との差"
              value={
                !goal.dueDate
                  ? '—'
                  : goal.delayDays > 0
                    ? `${goal.delayDays}日遅れ`
                    : '間に合う見込み'
              }
              tone={goal.delayDays > 0 ? 'late' : undefined}
            />
          </dl>
        </section>

        <GoalLinkList
          title="前提ゴール"
          icon={ArrowUpLeft}
          goals={lookup(goal.dependencyIds)}
          onSelectGoal={onSelectGoal}
        />
        <GoalLinkList
          title="後続ゴール"
          icon={ArrowDownRight}
          goals={lookup(goal.dependentIds)}
          onSelectGoal={onSelectGoal}
        />

        <section>
          <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            タスク {goal.tasks.length}件
          </h4>
          {goal.tasks.length === 0 ? (
            <p className="mt-2 text-xs text-slate-500">タスクはまだありません。</p>
          ) : (
            <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
              {goal.tasks.map((task) => {
                const { icon: Icon, className } = TASK_ICON[task.status]
                return (
                  <li key={task.id} className="flex items-start gap-2 py-2">
                    <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${className}`} />
                    <div className="min-w-0 flex-1">
                      <p
                        className={`truncate text-sm ${
                          task.status === 'completed' || task.status === 'cancelled'
                            ? 'text-slate-500 dark:text-slate-400'
                            : 'text-slate-900 dark:text-slate-100'
                        } ${task.status === 'cancelled' ? 'line-through' : ''}`}
                        title={task.title}
                      >
                        {task.title}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        実績 {formatHours(task.actualHours)} / 見積 {formatHours(task.estimateHours)}
                        {task.finish && task.status !== 'cancelled' && (
                          <span className={task.isLate ? 'font-semibold text-red-600 dark:text-red-400' : ''}>
                            {' · '}
                            {task.status === 'completed' || goal.phase === 'done'
                              ? `${formatJstDate(task.finish)} 完了`
                              : `〜${formatJstDate(task.finish)}`}
                          </span>
                        )}
                        {task.dueDate && task.status !== 'completed' && task.status !== 'cancelled' && (
                          <span> · 期限 {formatJstDate(task.dueDate)}</span>
                        )}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
