// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import { fireEvent, render, screen } from '@testing-library/react'
import type { ProjectCapacity } from '@/types/timeline'
import {
  resolveWeeklyWorkHours,
  TimelineCapacityBadge,
  TRIAGE_SETTINGS_HREF,
} from '../timeline-capacity-badge'

const capacity = (overrides: Partial<ProjectCapacity> = {}): ProjectCapacity => ({
  weekly_capacity_hours: 40,
  meeting_buffer_hours: 5,
  effective_capacity_hours: 35,
  effort_percent: 30,
  weekly_work_hours: 10.5,
  configured: true,
  ...overrides,
})

describe('resolveWeeklyWorkHours', () => {
  it('uses the hours derived from the triage settings', () => {
    expect(resolveWeeklyWorkHours(capacity(), 20)).toBe(10.5)
  })

  it('falls back to the temporary hours without an effort ratio', () => {
    expect(
      resolveWeeklyWorkHours(capacity({ effort_percent: 0, weekly_work_hours: 0 }), 20),
    ).toBe(20)
    expect(resolveWeeklyWorkHours(undefined, 20)).toBe(20)
  })
})

describe('TimelineCapacityBadge', () => {
  it('shows the project share of the weekly capacity', () => {
    render(
      <TimelineCapacityBadge capacity={capacity()} fallbackHours={20} onFallbackHoursChange={jest.fn()} />,
    )

    expect(screen.getByText('10.5')).toBeInTheDocument()
    expect(screen.getByText(/稼働 35h × エフォート 30%/)).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByRole('link', { name: 'キャパ配分の設定を開く' })).toHaveAttribute(
      'href',
      TRIAGE_SETTINGS_HREF,
    )
  })

  it('asks for an effort ratio and lets a temporary value be entered', () => {
    const onChange = jest.fn()
    render(
      <TimelineCapacityBadge
        capacity={capacity({ effort_percent: 0, weekly_work_hours: 0, configured: false })}
        fallbackHours={20}
        onFallbackHoursChange={onChange}
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent('エフォート比が未設定')
    const input = screen.getByLabelText('週間キャパシティ（仮）')
    fireEvent.change(input, { target: { value: '12' } })
    expect(onChange).toHaveBeenCalledWith(12)
  })

  it('renders nothing before the timeline has loaded', () => {
    const { container } = render(
      <TimelineCapacityBadge capacity={undefined} fallbackHours={20} onFallbackHoursChange={jest.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
