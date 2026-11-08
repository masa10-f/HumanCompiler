// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/**
 * The schedule as text: what an agent reads instead of the image. It carries
 * the figures the picture shows (projected dates, delays, progress) exactly.
 */

import { PHASE_LABELS } from '@/components/timeline/timeline-chart-layers'
import { visibleGoals } from '@/lib/timeline/chart-layout'
import { formatJstDate } from '@/lib/timeline/geometry'
import type { ProjectTimelineData, ScheduledGoal, TimelineSchedule } from '@/lib/timeline/types'
import { formatHours } from '@/lib/timeline/utils'
import type { WeeklyHoursSource } from './render'

export interface ImageFile {
  path: string
  width: number
  height: number
  goalIds: string[]
}

export interface SummaryInput {
  data: ProjectTimelineData
  schedule: TimelineSchedule
  weeklyHoursSource: WeeklyHoursSource
  showCompleted: boolean
  images: ImageFile[]
}

const iso = (date: Date | null) => (date ? date.toISOString() : null)

function goalStart(goal: ScheduledGoal): Date {
  return goal.actual?.start ?? goal.planned?.start ?? goal.start
}

/** The goals the image shows, so the summary lists the same ones. */
function shownGoals({ schedule, showCompleted }: SummaryInput): ScheduledGoal[] {
  return visibleGoals(schedule, showCompleted)
}

export function summaryJson(input: SummaryInput) {
  const { data, schedule } = input
  const titles = new Map(schedule.goals.map((goal) => [goal.id, goal.title]))
  return {
    project: { id: data.project.id, title: data.project.title },
    as_of: schedule.now.toISOString(),
    weekly_hours: schedule.weeklyHours,
    weekly_hours_source: input.weeklyHoursSource,
    capacity: data.project.capacity ?? null,
    progress: schedule.totals.progress,
    estimate_hours: schedule.totals.estimateHours,
    done_hours: schedule.totals.doneHours,
    remaining_hours: schedule.totals.remainingHours,
    actual_hours: schedule.totals.actualHours,
    projected_end: iso(schedule.projectedEnd),
    late_goal_count: schedule.lateGoalCount,
    has_cycle: schedule.hasCycle,
    hidden_cancelled_goal_count: schedule.hiddenCancelledCount,
    goals: shownGoals(input).map((goal) => ({
      id: goal.id,
      title: goal.title,
      status: goal.status,
      phase: goal.phase,
      start: goalStart(goal).toISOString(),
      finish: goal.finish.toISOString(),
      finish_is_estimated: goal.finishIsEstimated,
      due_date: iso(goal.dueDate),
      delay_days: goal.delayDays,
      estimate_hours: goal.estimateHours,
      remaining_hours: goal.remainingHours,
      progress: goal.progress,
      waiting_on: goal.waitingOnIds.map((id) => ({ id, title: titles.get(id) ?? null })),
    })),
    images: input.images.map((image) => ({
      path: image.path,
      width: image.width,
      height: image.height,
      goal_ids: image.goalIds,
    })),
  }
}

const escapeCell = (text: string) => text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()

function finishText(goal: ScheduledGoal): string {
  const date = formatJstDate(goal.finish, true)
  if (goal.phase === 'done') return goal.finishIsEstimated ? `${date}（推定）` : date
  return `${date}（見込み）`
}

const WEEKLY_SOURCE_TEXT: Record<WeeklyHoursSource, string> = {
  capacity: '容量設定から',
  option: '--weekly-hours で指定',
  fallback: '容量設定が無いため仮の値',
}

export function summaryMarkdown(input: SummaryInput): string {
  const { data, schedule } = input
  const { totals } = schedule
  const lines = [
    `# ${data.project.title} ロードマップ（${formatJstDate(schedule.now, true)} 時点）`,
    '',
    `- 進捗 ${Math.round(totals.progress * 100)}%（完了 ${formatHours(totals.doneHours)} / 見積 ${formatHours(totals.estimateHours)}、実績 ${formatHours(totals.actualHours)}）`,
    `- 残り ${formatHours(totals.remainingHours)}、完了見込み ${schedule.projectedEnd ? formatJstDate(schedule.projectedEnd, true) : '—'}`,
    `- 週 ${formatHours(schedule.weeklyHours)} で計画（${WEEKLY_SOURCE_TEXT[input.weeklyHoursSource]}）`,
    `- 期限に遅れる見込みのゴール: ${schedule.lateGoalCount} 件`,
  ]
  if (schedule.hasCycle) {
    lines.push('- 注意: ゴールの依存関係が循環しています。循環しているゴールは期限順に並べています。')
  }
  if (schedule.hiddenCancelledCount > 0) {
    lines.push(`- 中止したゴール ${schedule.hiddenCancelledCount} 件は含めていません。`)
  }

  const goals = shownGoals(input)
  const titles = new Map(schedule.goals.map((goal) => [goal.id, goal.title]))
  lines.push(
    '',
    '| ゴール | 状態 | 開始 | 完了 | 期限 | 遅れ | 残り | 前提待ち |',
    '|---|---|---|---|---|---|---|---|',
  )
  for (const goal of goals) {
    const waiting = goal.waitingOnIds.map((id) => escapeCell(titles.get(id) ?? id)).join('、')
    lines.push(
      `| ${[
        escapeCell(goal.title),
        PHASE_LABELS[goal.phase],
        formatJstDate(goalStart(goal), true),
        finishText(goal),
        formatJstDate(goal.dueDate, true),
        goal.delayDays > 0 ? `${goal.delayDays}日` : '—',
        goal.phase === 'done' ? '—' : formatHours(goal.remainingHours),
        waiting || '—',
      ].join(' | ')} |`,
    )
  }
  if (goals.length === 0) lines.push('| （ゴールなし） | | | | | | | |')

  if (input.images.length > 0) {
    lines.push('', '画像:')
    for (const image of input.images) {
      lines.push(`- ${image.path}（${image.width}×${image.height}px、ゴール ${image.goalIds.length} 件）`)
    }
  }
  return `${lines.join('\n')}\n`
}
