'use client'

import React, { useMemo } from 'react'
import type { LayoutGoal, LayoutTaskSegment } from '@/lib/timeline/types'

interface TimelineGoalBarProps {
  goal: LayoutGoal
  dimensions: {
    row_height: number
    goal_bar_height: number
    padding: { top: number; left: number }
  }
  isSelected: boolean
  onGoalClick: (goal: LayoutGoal, event: React.MouseEvent) => void
  onTaskClick: (task: LayoutTaskSegment, event: React.MouseEvent) => void
  showTaskSegments: boolean
}

const STATUS = {
  completed: {
    label: '完了',
    color: '#059669',
    soft: '#d1fae5',
    track: '#ecfdf5',
  },
  in_progress: {
    label: '進行中',
    color: '#2563eb',
    soft: '#dbeafe',
    track: '#eff6ff',
  },
  cancelled: {
    label: '中止',
    color: '#dc2626',
    soft: '#fee2e2',
    track: '#fef2f2',
  },
  pending: {
    label: '未着手',
    color: '#64748b',
    soft: '#e2e8f0',
    track: '#f1f5f9',
  },
} as const

const safeDate = (value: string | null) => {
  if (!value) return null
  try {
    return new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo',
      month: 'numeric',
      day: 'numeric',
    }).format(new Date(value))
  } catch {
    return null
  }
}

const formatHours = (value: number) => {
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? `${rounded}h` : `${rounded.toFixed(1)}h`
}

export function TimelineGoalBar({
  goal,
  dimensions,
  isSelected,
  onGoalClick,
  onTaskClick,
  showTaskSegments,
}: TimelineGoalBarProps) {
  const y = dimensions.padding.top + goal.row * dimensions.row_height
  const barY = y + 47
  const width = Math.max(8, goal.x1 - goal.x0)
  const progress = Math.min(1, Math.max(0, goal.progress))
  const percentage = Math.round(progress * 100)
  const style = STATUS[goal.status] || STATUS.pending
  const completedHours = goal.originalGoal.tasks.reduce(
    (sum, task) =>
      sum +
      Math.max(0, task.estimate_hours) *
        Math.min(1, Math.max(0, task.progress_percentage / 100)),
    0,
  )
  const remainingHours = Math.max(
    0,
    goal.originalGoal.estimate_hours - completedHours,
  )
  const startDate = safeDate(goal.originalGoal.start_date)
  const endDate = safeDate(goal.originalGoal.end_date)

  const taskStyles = useMemo(
    () =>
      goal.segments.map((segment) => {
        const key =
          segment.originalTask.status in STATUS
            ? segment.originalTask.status
            : 'pending'
        return STATUS[key as keyof typeof STATUS]
      }),
    [goal.segments],
  )

  return (
    <g className="goal-bar">
      <g
        role="button"
        tabIndex={0}
        aria-label={`ゴール ${goal.title}、${percentage}%完了、残り${formatHours(remainingHours)}`}
        className="cursor-pointer"
        onClick={(event) => onGoalClick(goal, event)}
      >
        <circle cx="28" cy={y + 34} r="5" fill={style.color} />
        <text
          x="43"
          y={y + 31}
          fontSize="14"
          fontWeight="700"
          fill="#0f172a"
          className="dark:fill-white"
        >
          {goal.title.length > 25 ? `${goal.title.slice(0, 23)}…` : goal.title}
        </text>
        <text
          x="43"
          y={y + 52}
          fontSize="10.5"
          fontWeight="600"
          fill={style.color}
        >
          {style.label}
        </text>
        <text x="91" y={y + 52} fontSize="10.5" fill="#64748b">
          {[startDate, endDate].filter(Boolean).join(' — ') ||
            `${goal.originalGoal.estimate_hours}h の計画`}
        </text>
        <text
          x={dimensions.padding.left - 28}
          y={y + 34}
          textAnchor="end"
          fontSize="23"
          fontWeight="700"
          fill="#0f172a"
          className="dark:fill-white"
        >
          {percentage}
          <tspan fontSize="12" fill="#64748b">
            %
          </tspan>
        </text>
        <text
          x={dimensions.padding.left - 28}
          y={y + 52}
          textAnchor="end"
          fontSize="9.5"
          fontWeight="700"
          letterSpacing="1"
          fill="#94a3b8"
        >
          完了率
        </text>

        <text
          x={goal.x0}
          y={barY - 11}
          fontSize="10.5"
          fontWeight="650"
          fill="#475569"
        >
          {percentage}% 完了 · 残り {formatHours(remainingHours)}
        </text>
        <rect
          x={goal.x0}
          y={barY}
          width={width}
          height={dimensions.goal_bar_height}
          rx="12"
          fill={style.track}
          stroke={isSelected ? style.color : '#cbd5e1'}
          strokeWidth={isSelected ? 2 : 1}
          filter={isSelected ? 'url(#timeline-soft-shadow)' : undefined}
        />
        {progress > 0 && (
          <rect
            x={goal.x0}
            y={barY}
            width={Math.max(8, width * progress)}
            height={dimensions.goal_bar_height}
            rx="12"
            fill={style.color}
            className="pointer-events-none"
          />
        )}
        {progress > 0 && progress < 1 && (
          <g className="pointer-events-none">
            <circle
              cx={goal.x0 + width * progress}
              cy={barY + dimensions.goal_bar_height / 2}
              r="7"
              fill="#ffffff"
              stroke={style.color}
              strokeWidth="3"
            />
          </g>
        )}
      </g>

      {showTaskSegments &&
        goal.segments.map((segment, index) => {
          const segmentWidth = Math.max(4, segment.x1 - segment.x0)
          const segmentProgress = Math.min(1, Math.max(0, segment.progress))
          const taskStyle = taskStyles[index] || STATUS.pending
          return (
            <g
              key={segment.id}
              role="button"
              tabIndex={0}
              aria-label={`タスク ${segment.title}、${Math.round(segmentProgress * 100)}%完了`}
              className="cursor-pointer"
              onClick={(event) => {
                event.stopPropagation()
                onTaskClick(segment, event)
              }}
            >
              <rect
                x={segment.x0 + 2}
                y={barY + dimensions.goal_bar_height - 9}
                width={Math.max(2, segmentWidth - 4)}
                height="5"
                rx="2.5"
                fill={taskStyle.soft}
              />
              {segmentProgress > 0 && (
                <rect
                  x={segment.x0 + 2}
                  y={barY + dimensions.goal_bar_height - 9}
                  width={Math.max(2, (segmentWidth - 4) * segmentProgress)}
                  height="5"
                  rx="2.5"
                  fill={taskStyle.color}
                />
              )}
              {segmentWidth > 105 && (
                <text
                  x={segment.x0 + segmentWidth / 2}
                  y={barY + 21}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize="9.5"
                  fontWeight="650"
                  fill={segmentProgress > 0.55 ? '#ffffff' : '#475569'}
                  className="pointer-events-none"
                >
                  {segment.title.length > 14
                    ? `${segment.title.slice(0, 12)}…`
                    : segment.title}
                </text>
              )}
            </g>
          )
        })}

      <g className="pointer-events-none">
        <rect
          x={goal.x1 + 10}
          y={barY + 9}
          width="54"
          height="24"
          rx="12"
          fill="#f8fafc"
          stroke="#cbd5e1"
        />
        <text
          x={goal.x1 + 37}
          y={barY + 21}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="10"
          fontWeight="700"
          fill="#475569"
        >
          {formatHours(goal.originalGoal.estimate_hours)}
        </text>
      </g>
    </g>
  )
}
