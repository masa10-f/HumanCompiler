// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/**
 * @jest-environment jsdom
 */
import { renderHook, act, waitFor } from '@testing-library/react'
import { useNote } from '../use-notes'
import { ApiError } from '@/lib/errors'
import type { ContextNote, ContextNoteUpdate } from '@/types/context-note'

const mockGetProjectNote = jest.fn()
const mockUpdateProjectNote = jest.fn()

jest.mock('@/lib/api', () => ({
  notesApi: {
    getProjectNote: (...args: unknown[]) => mockGetProjectNote(...args),
    updateProjectNote: (...args: unknown[]) => mockUpdateProjectNote(...args),
    getGoalNote: jest.fn(),
    updateGoalNote: jest.fn(),
    getTaskNote: jest.fn(),
    updateTaskNote: jest.fn(),
  },
}))

const FETCHED_AT = '2026-11-03T09:00:00+00:00'
const FIRST_SAVE_AT = '2026-11-03T09:00:01+00:00'
const SECOND_SAVE_AT = '2026-11-03T09:00:02+00:00'
const AGENT_AT = '2026-11-03T09:05:00+00:00'

function makeNote(content: string, updatedAt: string): ContextNote {
  return {
    id: 'note-1',
    project_id: 'project-1',
    goal_id: null,
    task_id: null,
    content,
    content_type: 'html',
    created_at: FETCHED_AT,
    updated_at: updatedAt,
    attachments: [],
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function conflictError() {
  return new ApiError(409, 'Changed since you read it; read it again and retry', {
    responseData: {
      detail: {
        message: 'Changed since you read it; read it again and retry',
        current_updated_at: AGENT_AT,
      },
    },
  })
}

function sentBodies(): ContextNoteUpdate[] {
  return mockUpdateProjectNote.mock.calls.map((call) => call[1] as ContextNoteUpdate)
}

async function renderLoaded() {
  const hook = renderHook(() => useNote({ entityType: 'project', entityId: 'project-1' }))
  await waitFor(() => expect(hook.result.current.loading).toBe(false))
  return hook
}

describe('useNote optimistic lock', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetProjectNote.mockResolvedValue(makeNote('<p>fetched</p>', FETCHED_AT))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('sends the fetched updated_at with the first save', async () => {
    mockUpdateProjectNote.mockResolvedValue(makeNote('<p>one</p>', FIRST_SAVE_AT))
    const { result } = await renderLoaded()

    await act(async () => {
      await result.current.updateNoteImmediate({ content: '<p>one</p>' })
    })

    expect(sentBodies()).toEqual([
      { content: '<p>one</p>', content_type: 'html', expected_updated_at: FETCHED_AT },
    ])
    expect(result.current.note?.updated_at).toBe(FIRST_SAVE_AT)
    expect(result.current.conflict).toBe(false)
  })

  it('waits for a save in flight and chains on the updated_at it returned', async () => {
    const first = deferred<ContextNote>()
    mockUpdateProjectNote
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(makeNote('<p>two</p>', SECOND_SAVE_AT))
    const { result } = await renderLoaded()

    let firstSave!: Promise<void>
    let secondSave!: Promise<void>
    act(() => {
      firstSave = result.current.updateNoteImmediate({ content: '<p>one</p>' })
      secondSave = result.current.updateNoteImmediate({ content: '<p>two</p>' })
    })

    await waitFor(() => expect(mockUpdateProjectNote).toHaveBeenCalledTimes(1))
    // The second request must not start while the first is in flight.
    await act(async () => {
      await Promise.resolve()
    })
    expect(mockUpdateProjectNote).toHaveBeenCalledTimes(1)

    await act(async () => {
      first.resolve(makeNote('<p>one</p>', FIRST_SAVE_AT))
      await firstSave
      await secondSave
    })

    expect(sentBodies()).toEqual([
      { content: '<p>one</p>', content_type: 'html', expected_updated_at: FETCHED_AT },
      { content: '<p>two</p>', content_type: 'html', expected_updated_at: FIRST_SAVE_AT },
    ])
    expect(result.current.conflict).toBe(false)
    expect(result.current.note?.content).toBe('<p>two</p>')
    expect(result.current.note?.updated_at).toBe(SECOND_SAVE_AT)
  })

  it('sets conflict on a 409 and stops sending debounced saves', async () => {
    mockUpdateProjectNote.mockRejectedValueOnce(conflictError())
    const { result } = await renderLoaded()

    await act(async () => {
      await result.current.updateNoteImmediate({ content: '<p>mine</p>' })
    })

    expect(result.current.conflict).toBe(true)
    expect(result.current.error).toBeNull()
    expect(mockUpdateProjectNote).toHaveBeenCalledTimes(1)

    jest.useFakeTimers()
    act(() => {
      result.current.updateNote({ content: '<p>more of mine</p>' })
    })
    await act(async () => {
      jest.advanceTimersByTime(2000)
    })

    expect(mockUpdateProjectNote).toHaveBeenCalledTimes(1)
    expect(result.current.note?.content).toBe('<p>more of mine</p>')
  })

  it('keeps today’s error handling for other failures', async () => {
    mockUpdateProjectNote.mockRejectedValueOnce(new ApiError(500, 'boom'))
    const { result } = await renderLoaded()

    await act(async () => {
      await result.current.updateNoteImmediate({ content: '<p>mine</p>' })
    })

    expect(result.current.conflict).toBe(false)
    expect(result.current.error).toBe('Failed to save note. Please try again.')
  })

  it('reloadLatest refetches, clears conflict and drops the local content', async () => {
    mockUpdateProjectNote.mockRejectedValueOnce(conflictError())
    const { result } = await renderLoaded()
    await act(async () => {
      await result.current.updateNoteImmediate({ content: '<p>mine</p>' })
    })
    expect(result.current.conflict).toBe(true)

    mockGetProjectNote.mockResolvedValueOnce(makeNote('<p>agent</p>', AGENT_AT))
    await act(async () => {
      await result.current.reloadLatest()
    })

    expect(mockGetProjectNote).toHaveBeenCalledTimes(2)
    expect(result.current.conflict).toBe(false)
    expect(result.current.note?.content).toBe('<p>agent</p>')

    // The next save is based on the reloaded version.
    mockUpdateProjectNote.mockResolvedValueOnce(makeNote('<p>after</p>', SECOND_SAVE_AT))
    await act(async () => {
      await result.current.updateNoteImmediate({ content: '<p>after</p>' })
    })
    expect(sentBodies()[1]).toEqual({
      content: '<p>after</p>',
      content_type: 'html',
      expected_updated_at: AGENT_AT,
    })
  })

  it('overwrite sends the latest local content without expected_updated_at', async () => {
    mockUpdateProjectNote.mockRejectedValueOnce(conflictError())
    const { result } = await renderLoaded()
    await act(async () => {
      await result.current.updateNoteImmediate({ content: '<p>mine</p>' })
    })
    jest.useFakeTimers()
    act(() => {
      result.current.updateNote({ content: '<p>latest of mine</p>' })
    })
    jest.useRealTimers()

    mockUpdateProjectNote.mockResolvedValueOnce(
      makeNote('<p>latest of mine</p>', SECOND_SAVE_AT)
    )
    await act(async () => {
      await result.current.overwrite()
    })

    expect(sentBodies()[1]).toEqual({ content: '<p>latest of mine</p>', content_type: 'html' })
    expect(result.current.conflict).toBe(false)
    expect(result.current.note?.updated_at).toBe(SECOND_SAVE_AT)

    // Later saves are locked again, on the overwrite's updated_at.
    mockUpdateProjectNote.mockResolvedValueOnce(makeNote('<p>next</p>', AGENT_AT))
    await act(async () => {
      await result.current.updateNoteImmediate({ content: '<p>next</p>' })
    })
    expect(sentBodies()[2]).toEqual({
      content: '<p>next</p>',
      content_type: 'html',
      expected_updated_at: SECOND_SAVE_AT,
    })
  })
})
