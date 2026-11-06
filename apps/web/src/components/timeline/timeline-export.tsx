// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

// No 'use client': the API's roadmap image route also renders this module on
// the server (see lib/timeline/render-image.tsx). Keep it free of hooks.

import React from 'react'
import { HEADER_HEIGHT, type ChartLayout } from '@/lib/timeline/chart-layout'
import { estimateTextWidth, formatJstDate } from '@/lib/timeline/geometry'
import type { TimelineSchedule } from '@/lib/timeline/types'
import { formatHours } from '@/lib/timeline/utils'
import { ChartBody, ChartCorner, ChartHeader, ChartLabels } from './timeline-chart-layers'
import { LIGHT_PALETTE, TIMELINE_FONT_FAMILY, type TimelinePalette } from './timeline-palette'

const TITLE_HEIGHT = 72
const LEGEND_HEIGHT = 44
const NO_FOCUS = { selectedId: null, hoveredId: null, related: null }

export function TimelineExportDocument({
  layout,
  schedule,
  projectTitle,
  showDependencies,
  // Exports always use the light palette so shared images look the same
  // regardless of the viewer's theme.
  palette = LIGHT_PALETTE,
}: {
  layout: ChartLayout
  schedule: TimelineSchedule
  projectTitle: string
  showDependencies: boolean
  palette?: TimelinePalette
}) {
  const width = layout.labelWidth + layout.width
  const bodyTop = TITLE_HEIGHT + HEADER_HEIGHT
  const height = bodyTop + layout.height + LEGEND_HEIGHT
  const summary = [
    `${formatJstDate(schedule.now, true)} 時点`,
    `進捗 ${Math.round(schedule.totals.progress * 100)}%`,
    `残り ${formatHours(schedule.totals.remainingHours)}`,
    schedule.projectedEnd ? `完了見込み ${formatJstDate(schedule.projectedEnd, true)}` : null,
    `週${schedule.weeklyHours}h で計画`,
  ]
    .filter(Boolean)
    .join('  ·  ')

  const legend: Array<{ label: string; fill: string; stroke?: string }> = [
    { label: '完了', fill: palette.done },
    { label: '実施済み（進行中）', fill: palette.active },
    { label: '残り作業の見込み', fill: palette.activeSoft, stroke: palette.activeStroke },
    { label: '未着手の見込み', fill: palette.plannedSoft, stroke: palette.plannedStroke },
  ]
  let legendX = 24

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fontFamily={TIMELINE_FONT_FAMILY}
    >
      <rect width={width} height={height} fill={palette.background} />
      <text x={24} y={34} fontSize={20} fontWeight={700} fill={palette.text}>
        {projectTitle}
      </text>
      <text x={24} y={56} fontSize={12} fill={palette.textMuted}>
        {summary}
      </text>

      <svg x={0} y={TITLE_HEIGHT} width={layout.labelWidth} height={HEADER_HEIGHT}>
        <ChartCorner
          palette={palette}
          goalCount={layout.goalRows.size}
          weeklyHours={schedule.weeklyHours}
          width={layout.labelWidth}
        />
      </svg>
      <svg x={layout.labelWidth} y={TITLE_HEIGHT} width={layout.width} height={HEADER_HEIGHT}>
        <ChartHeader layout={layout} palette={palette} projectedEnd={schedule.projectedEnd} />
      </svg>
      <svg x={0} y={bodyTop} width={layout.labelWidth} height={layout.height}>
        <ChartLabels layout={layout} palette={palette} focus={NO_FOCUS} />
      </svg>
      <svg x={layout.labelWidth} y={bodyTop} width={layout.width} height={layout.height}>
        <ChartBody
          layout={layout}
          palette={palette}
          focus={NO_FOCUS}
          showDependencies={showDependencies}
          markerPrefix="tl-export"
        />
      </svg>

      <line x1={0} y1={bodyTop + layout.height + 0.5} x2={width} y2={bodyTop + layout.height + 0.5} stroke={palette.border} />
      <g transform={`translate(0 ${bodyTop + layout.height + 26})`}>
        {legend.map((item) => {
          const x = legendX
          legendX += 30 + estimateTextWidth(item.label, 11) + 22
          return (
            <g key={item.label}>
              <rect x={x} y={-9} width={22} height={11} rx={3} fill={item.fill} stroke={item.stroke} />
              <text x={x + 30} y={0.5} fontSize={11} fill={palette.textMuted}>
                {item.label}
              </text>
            </g>
          )
        })}
        <line x1={legendX} y1={-4} x2={legendX + 22} y2={-4} stroke={palette.today} strokeWidth={2} />
        <text x={legendX + 30} y={0.5} fontSize={11} fill={palette.textMuted}>
          今日
        </text>
      </g>
    </svg>
  )
}

export async function renderExportSvg(props: React.ComponentProps<typeof TimelineExportDocument>) {
  const { renderToStaticMarkup } = await import('react-dom/server')
  return `<?xml version="1.0" encoding="UTF-8"?>\n${renderToStaticMarkup(<TimelineExportDocument {...props} />)}`
}

function triggerDownload(url: string, filename: string) {
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  window.setTimeout(() => link.remove(), 0)
}

export function downloadSvg(markup: string, filename: string) {
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }))
  triggerDownload(url, filename)
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Browsers cap both canvas side length and total area (iOS Safari ≈ 16.7M px).
const MAX_CANVAS_SIDE = 16_000
const MAX_CANVAS_AREA = 16_000_000

/** Pixel ratio for the PNG export: 2x when it fits within canvas limits. */
export function exportScale(width: number, height: number): number {
  return Math.min(
    2,
    MAX_CANVAS_SIDE / Math.max(width, height),
    Math.sqrt(MAX_CANVAS_AREA / (width * height)),
  )
}

export async function downloadPng(markup: string, width: number, height: number, filename: string) {
  const scale = exportScale(width, height)
  const svgUrl = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('Failed to rasterize timeline'))
      img.src = svgUrl
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas is not available')
    context.scale(scale, scale)
    context.drawImage(image, 0, 0, width, height)
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('Failed to encode PNG'))), 'image/png'),
    )
    const url = URL.createObjectURL(blob)
    triggerDownload(url, filename)
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  } finally {
    URL.revokeObjectURL(svgUrl)
  }
}

export function exportDimensions(layout: ChartLayout) {
  return {
    width: layout.labelWidth + layout.width,
    height: TITLE_HEIGHT + HEADER_HEIGHT + layout.height + LEGEND_HEIGHT,
  }
}
