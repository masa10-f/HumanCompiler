// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockUseProjectOptions = jest.fn()
const mockGetSettings = jest.fn()
const mockUpdateSettings = jest.fn()
const mockRefetchProjects = jest.fn()

jest.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: null, loading: false }),
}))

jest.mock('@/hooks/use-project-query', () => ({
  useProjectOptions: (...args: unknown[]) => mockUseProjectOptions(...args),
}))

jest.mock('@/lib/api', () => ({
  triageApi: {
    getSettings: (...args: unknown[]) => mockGetSettings(...args),
    updateSettings: (...args: unknown[]) => mockUpdateSettings(...args),
  },
}))

import { TriageSettingsCard } from '@/components/triage/triage-settings-card'

const settings = {
  weekly_capacity_hours: 40,
  meeting_buffer_hours: 5,
  cadence_days: 7,
  auto_generate_enabled: false,
  use_ai_rank_adjustment: false,
  project_allocations: { 'project-1': 50 },
  inbox_allocation_percent: 60,
  work_type_caps: {},
}

describe('TriageSettingsCard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetSettings.mockResolvedValue(settings)
  })

  it('does not stay loading when the unauthenticated project query is disabled', async () => {
    mockUseProjectOptions.mockReturnValue({
      data: undefined,
      error: null,
      isLoading: false,
      refetch: mockRefetchProjects,
    })

    render(<TriageSettingsCard />)

    expect(
      await screen.findByRole('button', { name: 'トリアージ設定を保存' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: 'トリアージ設定を保存' }),
    )
    await waitFor(() => {
      expect(mockUpdateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          project_allocations: { 'project-1': 50 },
        }),
      )
    })
  })

  it('shows a safe error, retries, and preserves allocations on save', async () => {
    mockUseProjectOptions.mockReturnValue({
      data: undefined,
      error: new Error('raw backend message'),
      isLoading: false,
      refetch: mockRefetchProjects,
    })

    render(<TriageSettingsCard />)

    expect(
      await screen.findByText(
        'プロジェクト一覧の取得に失敗しました: 予期しないエラーが発生しました。',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('raw backend message')).not.toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: 'プロジェクトを再取得' }),
    )
    await waitFor(() => {
      expect(mockRefetchProjects).toHaveBeenCalled()
    })

    fireEvent.click(
      screen.getByRole('button', { name: 'トリアージ設定を保存' }),
    )
    await waitFor(() => {
      expect(mockUpdateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          project_allocations: { 'project-1': 50 },
        }),
      )
    })
  })
})
