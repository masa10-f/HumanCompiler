'use client'

import React from 'react'
import type { LayoutArrow } from '@/lib/timeline/types'

interface TimelineDependencyArrowProps {
  arrow: LayoutArrow
  isHighlighted: boolean
}

function createSmoothPath(arrow: LayoutArrow) {
  const start = arrow.path[0]
  const end = arrow.path[arrow.path.length - 1]
  if (!start || !end) return null

  const horizontalDistance = end.x - start.x
  if (horizontalDistance >= 56) {
    const bend = Math.min(120, Math.max(36, horizontalDistance * 0.42))
    return {
      d: `M ${start.x} ${start.y} C ${start.x + bend} ${start.y}, ${end.x - bend} ${end.y}, ${end.x} ${end.y}`,
      start,
      end,
      midpoint: {
        x: (start.x + end.x) / 2,
        y: (start.y + end.y) / 2,
      },
    }
  }

  const channelX = Math.max(start.x, end.x) + 52
  return {
    d: `M ${start.x} ${start.y} C ${channelX} ${start.y}, ${channelX} ${end.y}, ${end.x} ${end.y}`,
    start,
    end,
    midpoint: {
      x: channelX,
      y: (start.y + end.y) / 2,
    },
  }
}

export function TimelineDependencyArrow({
  arrow,
  isHighlighted,
}: TimelineDependencyArrowProps) {
  const curve = createSmoothPath(arrow)
  if (!curve) return null

  const strokeColor = arrow.is_valid ? '#64748b' : '#ef4444'
  const markerId = arrow.is_valid ? 'arrowhead' : 'arrowhead-invalid'

  return (
    <g
      className="dependency-arrow pointer-events-none"
      role="group"
      aria-label={`${arrow.from_goal_id}から${arrow.to_goal_id}への依存関係${arrow.is_valid ? '' : '（循環依存の警告）'}`}
    >
      {isHighlighted && (
        <path
          d={curve.d}
          fill="none"
          stroke={strokeColor}
          strokeWidth="7"
          strokeLinecap="round"
          opacity="0.12"
          aria-hidden="true"
        />
      )}
      <path
        d={curve.d}
        fill="none"
        stroke={strokeColor}
        strokeWidth={isHighlighted ? 2.25 : 1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={arrow.is_valid ? undefined : '4 5'}
        markerEnd={`url(#${markerId})`}
        opacity={isHighlighted ? 0.95 : 0.58}
        aria-hidden="true"
      />
      <circle
        cx={curve.start.x}
        cy={curve.start.y}
        r={isHighlighted ? 3 : 2.25}
        fill="#ffffff"
        stroke={strokeColor}
        strokeWidth="1.5"
        aria-hidden="true"
      />

      {!arrow.is_valid && (
        <g className="cycle-warning" aria-hidden="true">
          <circle
            cx={curve.midpoint.x}
            cy={curve.midpoint.y}
            r="7"
            fill="#ffffff"
            stroke="#ef4444"
            strokeWidth="1.5"
          />
          <text
            x={curve.midpoint.x}
            y={curve.midpoint.y + 0.5}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize="9"
            fontWeight="700"
            fill="#dc2626"
          >
            !
          </text>
        </g>
      )}
    </g>
  )
}
