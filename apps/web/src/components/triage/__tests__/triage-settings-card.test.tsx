// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor } from '@testing-library/react'

const mockUseProjectOptions = jest.fn()
const mockGetSettings = jest.fn()

jest.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: null }),
}))

jest.mock('@/hooks/use-project-query', () => ({
  useProjectOptions: (...args: unknown[]) => mockUseProjectOptions(...args),
}))

jest.mock('@/lib/api', () => ({
  triageApi: {
    getSettings: (...args: unknown[]) => mockGetSettings(...args),
  },
}))

import { TriageSettingsCard } from '@/components/triage/triage-settings-card'

const settings = {
  weekly_capacity_hours: 40,
  meeting_buffer_hours: 5,
  cadence_days: 7,
  auto_generate_enabled: false,
  use_ai_rank_adjustment: false,
  project_allocations: {},
  inbox_allocation_percent: 100,
  work_type_caps: {},
}

describe('TriageSettingsCard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetSettings.mockResolvedValue(settings)
  })

  it('keeps the form loading while the disabled project query has no data', async () => {
    mockUseProjectOptions.mockReturnValue({
      data: undefined,
      error: null,
    })

    render(<TriageSettingsCard />)

    await waitFor(() => {
      expect(mockGetSettings).toHaveBeenCalled()
    })
    expect(screen.getByText('Loading...')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'トリアージ設定を保存' }),
    ).not.toBeInTheDocument()
  })

  it('does not render a saveable empty form after a project error', async () => {
    mockUseProjectOptions.mockReturnValue({
      data: undefined,
      error: new Error('Project load failed'),
    })

    render(<TriageSettingsCard />)

    expect(await screen.findByText('Project load failed')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'トリアージ設定を保存' }),
    ).not.toBeInTheDocument()
  })
})
