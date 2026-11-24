// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { CheckoutDialog, workedMinutes } from '../checkout-dialog'
import type { CurrentSessionDetails } from '@/types/runner'
import type { WorkSession } from '@/types/work-session'

const session = {
  id: 'session-1',
  task_id: 'task-1',
  started_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
} as WorkSession

const sessionDetails = {
  task: { id: 'task-1', title: '序論を書く', estimate_hours: 4 },
} as unknown as CurrentSessionDetails

function renderDialog(
  onCheckout = jest.fn().mockResolvedValue(undefined),
  shownSession: WorkSession = session,
) {
  render(
    <CheckoutDialog
      open
      onOpenChange={jest.fn()}
      session={shownSession}
      sessionDetails={sessionDetails}
      isCheckingOut={false}
      onCheckout={onCheckout}
    />,
  )
  return onCheckout
}

const remaining = () => screen.getByLabelText('残りの見込み（時間・任意）')
const checkoutButton = () => screen.getByRole('button', { name: 'チェックアウト' })

describe('workedMinutes', () => {
  const now = new Date('2026-11-20T12:00:00Z').getTime()
  const at = (minutesAgo: number) => new Date(now - minutesAgo * 60 * 1000).toISOString()
  const running = (fields: Partial<WorkSession>) =>
    ({ started_at: at(60), paused_at: null, total_paused_seconds: 0, ...fields }) as WorkSession

  it('is the time since the session started', () => {
    expect(workedMinutes(running({}), now)).toBe(60)
  })

  it('leaves out the pauses already taken', () => {
    expect(workedMinutes(running({ total_paused_seconds: 15 * 60 }), now)).toBe(45)
  })

  it('leaves out the pause still running', () => {
    expect(
      workedMinutes(running({ total_paused_seconds: 15 * 60, paused_at: at(20) }), now),
    ).toBe(25)
  })

  it('counts whole minutes of work, as the API does', () => {
    // 60 minutes less 90 seconds of pause is 58.5 minutes of work.
    expect(workedMinutes(running({ total_paused_seconds: 90 }), now)).toBe(58)
  })

  it('is at least the one minute a checkout records', () => {
    expect(workedMinutes(running({ started_at: at(0) }), now)).toBe(1)
    expect(workedMinutes(running({ started_at: at(10), paused_at: at(10) }), now)).toBe(1)
  })
})

describe('CheckoutDialog', () => {
  it('shows the time worked without the pauses', () => {
    renderDialog(undefined, {
      ...session,
      started_at: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
      paused_at: null,
      total_paused_seconds: 30 * 60,
    })

    expect(screen.getByText('作業時間: 1.0時間（60分）')).toBeInTheDocument()
  })

  it('asks what remains the way a time record entered by hand does', () => {
    renderDialog()

    expect(remaining()).toBeInTheDocument()
    expect(screen.getByText('現在の見積: 4h')).toBeInTheDocument()
    expect(
      screen.getByText('入力すると、タスクの見積を「これまでの実績＋残り」に更新します。'),
    ).toBeInTheDocument()
  })

  it('sends the decision alone when nothing else is filled in', async () => {
    const onCheckout = renderDialog()

    fireEvent.click(checkoutButton())

    await waitFor(() => expect(onCheckout).toHaveBeenCalledWith('switch', {}))
  })

  it('sends what remains and the reflection', async () => {
    const onCheckout = renderDialog()

    fireEvent.change(remaining(), { target: { value: '1.5' } })
    fireEvent.change(screen.getByLabelText('Keep: うまくいったこと'), {
      target: { value: '集中できた' },
    })
    fireEvent.change(screen.getByLabelText('Try: 次に試したいこと'), {
      target: { value: '朝に始める' },
    })
    fireEvent.click(checkoutButton())

    await waitFor(() =>
      expect(onCheckout).toHaveBeenCalledWith('switch', {
        remaining_estimate_hours: 1.5,
        kpt_keep: '集中できた',
        kpt_try: '朝に始める',
      }),
    )
  })

  it('sends zero remaining hours', async () => {
    const onCheckout = renderDialog()

    fireEvent.change(remaining(), { target: { value: '0' } })
    fireEvent.click(checkoutButton())

    await waitFor(() =>
      expect(onCheckout).toHaveBeenCalledWith('switch', { remaining_estimate_hours: 0 }),
    )
  })

  it('does not check out with a remaining time the API would reject', () => {
    const onCheckout = renderDialog()

    fireEvent.change(remaining(), { target: { value: '1000' } })

    expect(screen.getByText('残り時間は999.99時間以内で入力してください')).toBeInTheDocument()
    expect(checkoutButton()).toBeDisabled()
    fireEvent.click(checkoutButton())
    expect(onCheckout).not.toHaveBeenCalled()
  })

  it('leaves nothing to estimate when the task is completed', async () => {
    const onCheckout = renderDialog()

    fireEvent.change(remaining(), { target: { value: '2' } })
    fireEvent.click(screen.getByLabelText('完了'))

    expect(remaining()).toBeDisabled()
    fireEvent.click(checkoutButton())
    await waitFor(() => expect(onCheckout).toHaveBeenCalledWith('complete', {}))
  })

  it('requires a reason and a reflection to continue', async () => {
    const onCheckout = renderDialog()

    fireEvent.click(screen.getByLabelText('継続'))
    expect(checkoutButton()).toBeDisabled()
    expect(screen.getByText(/少なくとも1つのKPT項目を入力してください/)).toBeInTheDocument()
    expect(onCheckout).not.toHaveBeenCalled()
  })
})
