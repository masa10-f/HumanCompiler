// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/**
 * Colors are applied as SVG attributes (not CSS classes) so an exported image
 * looks exactly like the chart on screen.
 */
export interface TimelinePalette {
  background: string
  labelBackground: string
  headerBackground: string
  rowAlt: string
  rowHover: string
  rowSelected: string
  taskRow: string
  border: string
  gridMajor: string
  gridMinor: string
  weekend: string
  text: string
  textMuted: string
  textSubtle: string
  done: string
  doneSoft: string
  active: string
  activeSoft: string
  activeStroke: string
  planned: string
  plannedSoft: string
  plannedStroke: string
  late: string
  lateSoft: string
  today: string
  todaySoft: string
  projected: string
  projectedSoft: string
  link: string
  linkHighlight: string
  linkConflict: string
  onSolid: string
}

export const LIGHT_PALETTE: TimelinePalette = {
  background: '#ffffff',
  labelBackground: '#ffffff',
  headerBackground: '#f8fafc',
  rowAlt: '#fbfcfe',
  rowHover: '#f1f5f9',
  rowSelected: '#eff6ff',
  taskRow: '#f8fafc',
  border: '#e2e8f0',
  gridMajor: '#e2e8f0',
  gridMinor: '#f1f5f9',
  weekend: '#f8fafc',
  text: '#0f172a',
  textMuted: '#475569',
  textSubtle: '#94a3b8',
  done: '#10b981',
  doneSoft: '#d1fae5',
  active: '#2563eb',
  activeSoft: '#dbeafe',
  activeStroke: '#60a5fa',
  planned: '#64748b',
  plannedSoft: '#eef2f7',
  plannedStroke: '#94a3b8',
  late: '#dc2626',
  lateSoft: '#fee2e2',
  today: '#f97316',
  todaySoft: '#fff7ed',
  projected: '#7c3aed',
  projectedSoft: '#f5f3ff',
  link: '#94a3b8',
  linkHighlight: '#1d4ed8',
  linkConflict: '#d97706',
  onSolid: '#ffffff',
}

export const DARK_PALETTE: TimelinePalette = {
  background: '#020617',
  labelBackground: '#020617',
  headerBackground: '#0f172a',
  rowAlt: '#050b1d',
  rowHover: '#111a2e',
  rowSelected: '#0b1f44',
  taskRow: '#0a1224',
  border: '#1e293b',
  gridMajor: '#1e293b',
  gridMinor: '#0f172a',
  weekend: '#0a1224',
  text: '#f8fafc',
  textMuted: '#cbd5e1',
  textSubtle: '#64748b',
  done: '#10b981',
  doneSoft: '#064e3b',
  active: '#3b82f6',
  activeSoft: '#172554',
  activeStroke: '#3b82f6',
  planned: '#94a3b8',
  plannedSoft: '#1e293b',
  plannedStroke: '#475569',
  late: '#f87171',
  lateSoft: '#450a0a',
  today: '#fb923c',
  todaySoft: '#431407',
  projected: '#a78bfa',
  projectedSoft: '#2e1065',
  link: '#64748b',
  linkHighlight: '#60a5fa',
  linkConflict: '#f59e0b',
  onSolid: '#ffffff',
}

export const TIMELINE_FONT_FAMILY =
  "'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', 'Yu Gothic UI', 'Meiryo', system-ui, -apple-system, 'Segoe UI', sans-serif"
