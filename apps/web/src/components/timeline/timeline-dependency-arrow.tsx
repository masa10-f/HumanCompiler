"use client"

import React from 'react'
import type { LayoutArrow } from '@/lib/timeline/types'

interface TimelineDependencyArrowProps {
  arrow: LayoutArrow
  isHighlighted: boolean
}

export function TimelineDependencyArrow({
  arrow,
  isHighlighted
}: TimelineDependencyArrowProps) {
  // Create path string for SVG polyline
  const pathString = arrow.path
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ')

  const strokeColor = arrow.is_valid ? '#6b7280' : '#ef4444'
  const markerId = arrow.is_valid ? 'arrowhead' : 'arrowhead-invalid'
  const strokeWidth = isHighlighted ? 3 : 2
  const opacity = isHighlighted ? 1 : 0.7

  return (
    <g className="dependency-arrow">
      {/* Arrow Path */}
      <path
        d={pathString}
        fill="none"
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeDasharray={arrow.is_valid ? 'none' : '5,5'}
        markerEnd={`url(#${markerId})`}
        opacity={opacity}
        className="transition-all hover:opacity-100"
      />

      {/* Invisible thicker path for easier hovering */}
      <path
        d={pathString}
        fill="none"
        stroke="transparent"
        strokeWidth="8"
        className="cursor-pointer"
      />

      {/* Dependency label (if highlighted) */}
      {isHighlighted && arrow.path.length >= 2 && arrow.path[1] && (
        <g className="dependency-label">
          {/* Label background */}
          <rect
            x={arrow.path[1].x - 15}
            y={arrow.path[1].y - 8}
            width="30"
            height="16"
            fill="white"
            stroke={strokeColor}
            strokeWidth="1"
            rx="3"
            opacity="0.9"
          />

          {/* Label text */}
          <text
            x={arrow.path[1].x}
            y={arrow.path[1].y}
            textAnchor="middle"
            dominantBaseline="middle"
            className="text-xs font-medium pointer-events-none"
            fontSize="10"
            fill={strokeColor}
          >
            依存
          </text>
        </g>
      )}

      {/* Warning icon for invalid dependencies (cycles) */}
      {!arrow.is_valid && arrow.path.length >= 2 && (() => {
        const midPoint = arrow.path[Math.floor(arrow.path.length / 2)]
        if (!midPoint) return null

        return (
          <g className="cycle-warning">
            <circle
              cx={midPoint.x}
              cy={midPoint.y}
              r="8"
              fill="#fef2f2"
              stroke="#ef4444"
              strokeWidth="2"
            />
            <text
              x={midPoint.x}
              y={midPoint.y}
              textAnchor="middle"
              dominantBaseline="middle"
              className="text-xs font-bold pointer-events-none"
              fontSize="10"
              fill="#ef4444"
            >
              !
            </text>
          </g>
        )
      })()}
    </g>
  )
}
