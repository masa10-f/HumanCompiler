"use client"

import React from 'react'
import type { LayoutGoal, LayoutTaskSegment } from '@/lib/timeline/types'

interface TimelineGoalBarProps {
  goal: LayoutGoal
  dimensions: {
    row_height: number
    goal_bar_height: number
    padding: {
      top: number
      left: number
    }
  }
  isSelected: boolean
  onGoalClick: (goal: LayoutGoal, event: React.MouseEvent) => void
  onTaskClick: (task: LayoutTaskSegment, event: React.MouseEvent) => void
  showTaskSegments: boolean
}

export function TimelineGoalBar({
  goal,
  dimensions,
  isSelected,
  onGoalClick,
  onTaskClick,
  showTaskSegments
}: TimelineGoalBarProps) {
  const y = dimensions.padding.top + goal.row * dimensions.row_height
  const barY = y + (dimensions.row_height - dimensions.goal_bar_height) / 2
  const width = goal.x1 - goal.x0

  // Status colors
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return '#22c55e'
      case 'in_progress':
        return '#3b82f6'
      case 'cancelled':
        return '#ef4444'
      default:
        return '#6b7280'
    }
  }

  const statusColor = getStatusColor(goal.status)
  const progressWidth = width * goal.progress

  return (
    <g className="goal-bar">
      {/* Goal Label */}
      <text
        x={dimensions.padding.left - 10}
        y={y + dimensions.row_height / 2}
        textAnchor="end"
        dominantBaseline="middle"
        className="text-sm font-medium fill-gray-700"
        fontSize="12"
      >
        {goal.title}
      </text>

      {/* Goal Bar Background */}
      <rect
        x={goal.x0}
        y={barY}
        width={width}
        height={dimensions.goal_bar_height}
        fill="#f1f5f9"
        stroke="#e2e8f0"
        strokeWidth="1"
        rx="4"
        className={`cursor-pointer transition-all ${
          isSelected ? 'stroke-blue-500 stroke-2' : 'hover:stroke-gray-400'
        }`}
        onClick={(event) => onGoalClick(goal, event)}
        role="button"
        aria-label={`ゴール: ${goal.title} - 進捗率 ${Math.round(goal.progress * 100)}% (${goal.originalGoal.status})`}
        tabIndex={0}
      />

      {/* Overall Progress Fill */}
      {goal.progress > 0 && (
        <rect
          x={goal.x0}
          y={barY}
          width={progressWidth}
          height={dimensions.goal_bar_height}
          fill={statusColor}
          opacity="0.3"
          rx="4"
          className="pointer-events-none"
        />
      )}

      {/* Task Segments */}
      {showTaskSegments && goal.segments.map((segment) => (
        <g key={segment.id} className="task-segment">
          {/* Task Segment Background */}
          <rect
            x={segment.x0}
            y={barY + 2}
            width={segment.x1 - segment.x0}
            height={dimensions.goal_bar_height - 4}
            fill="white"
            stroke="#d1d5db"
            strokeWidth="0.5"
            rx="2"
            className="cursor-pointer hover:stroke-gray-500"
            onClick={(event) => {
              event.stopPropagation()
              onTaskClick(segment, event)
            }}
            role="button"
            aria-label={`タスク: ${segment.title} - 進捗率 ${Math.round(segment.progress * 100)}% (${segment.originalTask.status})`}
            tabIndex={0}
          />

          {/* Task Progress Fill */}
          {segment.progress > 0 && (
            <rect
              x={segment.x0}
              y={barY + 2}
              width={(segment.x1 - segment.x0) * segment.progress}
              height={dimensions.goal_bar_height - 4}
              fill={segment.status_color}
              rx="2"
              className="pointer-events-none"
            />
          )}

          {/* Task Segment Divider */}
          {segment.x0 > goal.x0 && (
            <line
              x1={segment.x0}
              y1={barY}
              x2={segment.x0}
              y2={barY + dimensions.goal_bar_height}
              stroke="#d1d5db"
              strokeWidth="1"
              className="pointer-events-none"
            />
          )}
        </g>
      ))}

      {/* Progress Percentage Label */}
      {width > 60 && (
        <text
          x={goal.x0 + width / 2}
          y={barY + dimensions.goal_bar_height / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          className="text-xs font-medium fill-gray-700 pointer-events-none"
          fontSize="10"
        >
          {Math.round(goal.progress * 100)}%
        </text>
      )}

      {/* Status Indicator */}
      <circle
        cx={goal.x0 - 8}
        cy={barY + dimensions.goal_bar_height / 2}
        r="3"
        fill={statusColor}
        className="pointer-events-none"
      />

      {/* Estimate Hours Label */}
      <text
        x={goal.x1 + 8}
        y={barY + dimensions.goal_bar_height / 2}
        textAnchor="start"
        dominantBaseline="middle"
        className="text-xs fill-gray-500 pointer-events-none"
        fontSize="10"
      >
        {goal.originalGoal.estimate_hours}h
      </text>
    </g>
  )
}
