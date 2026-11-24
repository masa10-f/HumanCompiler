// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { SessionKptEditDialog } from '../session-kpt-edit-dialog'
import type { WorkSession } from '@/types/work-session'

const mockMutateAsync = jest.fn()

jest.mock('@/hooks/use-work-sessions', () => ({
  useUpdateWorkSession: () => ({ mutateAsync: mockMutateAsync, isPending: false }),
}))

const session = {
  id: 'session-1',
  task_id: 'task-1',
  kpt_keep: '集中できた',
  kpt_problem: null,
  kpt_try: '朝に始める',
} as WorkSession

describe('SessionKptEditDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockMutateAsync.mockResolvedValue(session)
  })

  it('starts from the reflection the session has', () => {
    render(<SessionKptEditDialog session={session} open onOpenChange={jest.fn()} />)

    expect(screen.getByLabelText('Keep: うまくいったこと')).toHaveValue('集中できた')
    expect(screen.getByLabelText('Problem: 困ったこと')).toHaveValue('')
    expect(screen.getByLabelText('Try: 次に試したいこと')).toHaveValue('朝に始める')
  })

  it('saves all three fields, an emptied one as empty so it is cleared', async () => {
    const onOpenChange = jest.fn()
    render(<SessionKptEditDialog session={session} open onOpenChange={onOpenChange} />)

    fireEvent.change(screen.getByLabelText('Problem: 困ったこと'), {
      target: { value: '割り込みが多い' },
    })
    fireEvent.change(screen.getByLabelText('Try: 次に試したいこと'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith({
        sessionId: 'session-1',
        data: { kpt_keep: '集中できた', kpt_problem: '割り込みが多い', kpt_try: '' },
      }),
    )
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })
})
