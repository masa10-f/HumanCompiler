"use client"

import React, { useMemo } from 'react'
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

// Modern color palette with gradients
const STATUS_STYLES = {
  completed: {
    gradient: ['#10b981', '#059669'],
    glow: 'rgba(16, 185, 129, 0.3)',
    bg: '#ecfdf5',
    border: '#a7f3d0',
  },
  in_progress: {
    gradient: ['#3b82f6', '#2563eb'],
    glow: 'rgba(59, 130, 246, 0.3)',
    bg: '#eff6ff',
    border: '#bfdbfe',
  },
  cancelled: {
    gradient: ['#ef4444', '#dc2626'],
    glow: 'rgba(239, 68, 68, 0.3)',
    bg: '#fef2f2',
    border: '#fecaca',
  },
  pending: {
    gradient: ['#6b7280', '#4b5563'],
    glow: 'rgba(107, 114, 128, 0.2)',
    bg: '#f9fafb',
    border: '#e5e7eb',
  },
} as const

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

  // Get status styles
  const statusKey = (goal.status in STATUS_STYLES ? goal.status : 'pending') as keyof typeof STATUS_STYLES
  const styles = STATUS_STYLES[statusKey]

  // Create unique gradient IDs for this goal
  const gradientId = `goal-gradient-${goal.id}`
  const progressGradientId = `goal-progress-gradient-${goal.id}`
  const glowId = `goal-glow-${goal.id}`

  const progressWidth = width * goal.progress

  // Calculate task segment colors
  const taskColors = useMemo(() => {
    return goal.segments.map(segment => {
      const taskStatusKey = (segment.originalTask.status in STATUS_STYLES
        ? segment.originalTask.status
        : 'pending') as keyof typeof STATUS_STYLES
      return STATUS_STYLES[taskStatusKey]
    })
  }, [goal.segments])

  return (
    <g className="goal-bar" style={{ transition: 'all 0.2s ease' }}>
      {/* Definitions for gradients and effects */}
      <defs>
        {/* Background gradient */}
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor={styles.bg} />
        </linearGradient>

        {/* Progress gradient */}
        <linearGradient id={progressGradientId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={styles.gradient[0]} stopOpacity="0.9" />
          <stop offset="100%" stopColor={styles.gradient[1]} stopOpacity="0.7" />
        </linearGradient>

        {/* Glow filter */}
        <filter id={glowId} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Goal Label with background highlight */}
      <g className="goal-label">
        <rect
          x={10}
          y={y + dimensions.row_height / 2 - 12}
          width={dimensions.padding.left - 30}
          height="24"
          fill="#ffffff"
          stroke="#e2e8f0"
          strokeWidth="1"
          rx="6"
          ry="6"
        />
        <text
          x={dimensions.padding.left - 20}
          y={y + dimensions.row_height / 2}
          textAnchor="end"
          dominantBaseline="middle"
          className="select-none"
          style={{
            fontSize: '12px',
            fontWeight: 600,
            fill: '#334155',
          }}
        >
          {goal.title.length > 18 ? `${goal.title.slice(0, 16)}...` : goal.title}
        </text>
      </g>

      {/* Subtle row background on hover/select */}
      {isSelected && (
        <rect
          x={goal.x0 - 4}
          y={barY - 4}
          width={width + 8}
          height={dimensions.goal_bar_height + 8}
          fill={styles.glow}
          rx="8"
          className="pointer-events-none"
          style={{ transition: 'all 0.2s ease' }}
        />
      )}

      {/* Main Goal Bar Background - Modern rounded design */}
      <rect
        x={goal.x0}
        y={barY}
        width={width}
        height={dimensions.goal_bar_height}
        fill={`url(#${gradientId})`}
        stroke={isSelected ? styles.gradient[0] : styles.border}
        strokeWidth={isSelected ? 2 : 1}
        rx="8"
        ry="8"
        className="cursor-pointer"
        style={{
          filter: isSelected ? `url(#${glowId})` : 'none',
          transition: 'all 0.2s ease',
        }}
        onClick={(event) => onGoalClick(goal, event)}
        role="button"
        aria-label={`ゴール: ${goal.title} - 進捗率 ${Math.round(goal.progress * 100)}% (${goal.originalGoal.status})`}
        tabIndex={0}
      />

      {/* Progress Fill - Smooth gradient with rounded ends */}
      {goal.progress > 0 && (
        <rect
          x={goal.x0}
          y={barY}
          width={Math.max(progressWidth, 16)}
          height={dimensions.goal_bar_height}
          fill={`url(#${progressGradientId})`}
          rx="8"
          ry="8"
          clipPath={`inset(0 ${width - progressWidth}px 0 0 round 8px)`}
          className="pointer-events-none"
          style={{ transition: 'width 0.3s ease' }}
        />
      )}

      {/* Inner progress bar highlight */}
      {goal.progress > 0 && (
        <rect
          x={goal.x0 + 2}
          y={barY + 2}
          width={Math.max(progressWidth - 4, 12)}
          height={4}
          fill="rgba(255, 255, 255, 0.4)"
          rx="2"
          className="pointer-events-none"
        />
      )}

      {/* Task Segments - Modern pill design */}
      {showTaskSegments && goal.segments.map((segment, index) => {
        const segmentWidth = segment.x1 - segment.x0
        const taskStyle = taskColors[index]
        const taskGradientId = `task-gradient-${segment.id}`

        return (
          <g key={segment.id} className="task-segment">
            <defs>
              <linearGradient id={taskGradientId} x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor={taskStyle?.gradient[0] || '#6b7280'} stopOpacity="1" />
                <stop offset="100%" stopColor={taskStyle?.gradient[1] || '#4b5563'} stopOpacity="0.8" />
              </linearGradient>
            </defs>

            {/* Task Segment Container */}
            <rect
              x={segment.x0 + 2}
              y={barY + 4}
              width={Math.max(segmentWidth - 4, 8)}
              height={dimensions.goal_bar_height - 8}
              fill="rgba(255, 255, 255, 0.9)"
              stroke={taskStyle?.border || '#e5e7eb'}
              strokeWidth="1"
              rx="4"
              ry="4"
              className="cursor-pointer"
              style={{
                transition: 'all 0.15s ease',
              }}
              onClick={(event) => {
                event.stopPropagation()
                onTaskClick(segment, event)
              }}
              onMouseEnter={(e) => {
                (e.target as SVGRectElement).style.transform = 'translateY(-1px)'
                ;(e.target as SVGRectElement).style.filter = 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))'
              }}
              onMouseLeave={(e) => {
                (e.target as SVGRectElement).style.transform = ''
                ;(e.target as SVGRectElement).style.filter = ''
              }}
              role="button"
              aria-label={`タスク: ${segment.title} - 進捗率 ${Math.round(segment.progress * 100)}% (${segment.originalTask.status})`}
              tabIndex={0}
            />

            {/* Task Progress Fill */}
            {segment.progress > 0 && (
              <rect
                x={segment.x0 + 2}
                y={barY + 4}
                width={Math.max((segmentWidth - 4) * segment.progress, 4)}
                height={dimensions.goal_bar_height - 8}
                fill={`url(#${taskGradientId})`}
                rx="4"
                ry="4"
                className="pointer-events-none"
                style={{ transition: 'width 0.3s ease' }}
              />
            )}

            {/* Task name (if wide enough) */}
            {segmentWidth > 80 && (
              <text
                x={segment.x0 + segmentWidth / 2}
                y={barY + dimensions.goal_bar_height / 2}
                textAnchor="middle"
                dominantBaseline="middle"
                className="pointer-events-none select-none"
                style={{
                  fontSize: '9px',
                  fontWeight: 500,
                  fill: segment.progress > 0.5 ? '#ffffff' : '#4b5563',
                  textShadow: segment.progress > 0.5 ? '0 1px 2px rgba(0,0,0,0.2)' : 'none',
                }}
              >
                {segment.title.length > 12 ? `${segment.title.slice(0, 10)}...` : segment.title}
              </text>
            )}
          </g>
        )
      })}

      {/* Progress Percentage Label - Clean modern style */}
      {width > 80 && (
        <g className="pointer-events-none">
          <rect
            x={goal.x0 + width / 2 - 20}
            y={barY + dimensions.goal_bar_height + 4}
            width="40"
            height="18"
            fill={styles.gradient[0]}
            rx="9"
            ry="9"
            opacity="0.95"
          />
          <text
            x={goal.x0 + width / 2}
            y={barY + dimensions.goal_bar_height + 13}
            textAnchor="middle"
            dominantBaseline="middle"
            className="select-none"
            style={{
              fontSize: '10px',
              fontWeight: 600,
              fill: '#ffffff',
              letterSpacing: '0.02em',
            }}
          >
            {Math.round(goal.progress * 100)}%
          </text>
        </g>
      )}

      {/* Status Indicator - Simple dot */}
      <circle
        cx={goal.x0 - 8}
        cy={barY + dimensions.goal_bar_height / 2}
        r="4"
        fill={styles.gradient[0]}
        className="pointer-events-none"
      />

      {/* Estimate Hours Label - Modern badge style */}
      <g className="pointer-events-none">
        <rect
          x={goal.x1 + 8}
          y={barY + dimensions.goal_bar_height / 2 - 9}
          width="36"
          height="18"
          fill="#f3f4f6"
          stroke="#e5e7eb"
          strokeWidth="1"
          rx="4"
        />
        <text
          x={goal.x1 + 26}
          y={barY + dimensions.goal_bar_height / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          className="select-none"
          style={{
            fontSize: '10px',
            fontWeight: 500,
            fill: '#6b7280',
          }}
        >
          {goal.originalGoal.estimate_hours}h
        </text>
      </g>
    </g>
  )
}
