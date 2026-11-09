// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

/**
 * @jest-environment jsdom
 */
import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useWeeklyNote } from '../use-weekly-note'
import { ApiError } from '@/lib/errors'
import type { WeeklyNote } from '@/types/weekly-note'
import { queryKeys } from '@/lib/query-keys'

const mockGet = jest.fn()
const mockUpdate = jest.fn()

jest.mock('@/lib/api', () => ({
  weeklyNotesApi: {
    get: (...args: unknown[]) => mockGet(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    list: jest.fn(),
  },
}))

// Any day of the week loads it; saves go to the week start the server returns.
const DAY = '2026-11-04'
const WEEK = '2026-11-01'

let queryClient: QueryClient

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: queryClient }, children)
}

function makeNote(content: string, updatedAt: string | null): WeeklyNote {
  return {
    id: updatedAt ? 'note-1' : null,
    week_start: WEEK,
    week_end: '2026-11-07',
    content,
    content_type: 'html',
    created_at: updatedAt,
    updated_at: updatedAt,
  }
}

describe('useWeeklyNote', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    queryClient = new QueryClient()
    mockGet.mockReset()
    mockUpdate.mockReset()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('creates the note without a lock, then saves with the returned updated_at', async () => {
    mockGet.mockResolvedValue(makeNote('', null))
    mockUpdate
      .mockResolvedValueOnce(makeNote('<p>a</p>', '2026-11-03T09:00:00+00:00'))
      .mockResolvedValueOnce(makeNote('<p>ab</p>', '2026-11-03T09:00:01+00:00'))
    const { result } = renderHook(() => useWeeklyNote(DAY), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(mockGet).toHaveBeenCalledWith(DAY)

    act(() => result.current.updateNote({ content: '<p>a</p>' }))
    await act(async () => {
      jest.advanceTimersByTime(500)
    })
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    expect(mockUpdate).toHaveBeenLastCalledWith(WEEK, {
      content: '<p>a</p>',
      content_type: 'html',
    })

    act(() => result.current.updateNote({ content: '<p>ab</p>' }))
    await act(async () => {
      jest.advanceTimersByTime(500)
    })
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(2))
    expect(mockUpdate).toHaveBeenLastCalledWith(WEEK, {
      content: '<p>ab</p>',
      content_type: 'html',
      expected_updated_at: '2026-11-03T09:00:00+00:00',
    })
    await waitFor(() => expect(result.current.note?.content).toBe('<p>ab</p>'))
  })

  it('saves an edit still waiting for its debounce when unmounted', async () => {
    mockGet.mockResolvedValue(makeNote('<p>old</p>', '2026-11-03T09:00:00+00:00'))
    mockUpdate.mockResolvedValue(makeNote('<p>new</p>', '2026-11-03T09:00:01+00:00'))
    const { result, unmount } = renderHook(() => useWeeklyNote(DAY), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.updateNote({ content: '<p>new</p>' }))
    unmount()

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    expect(mockUpdate).toHaveBeenCalledWith(WEEK, {
      content: '<p>new</p>',
      content_type: 'html',
      expected_updated_at: '2026-11-03T09:00:00+00:00',
    })
    // The flushed save is not sent a second time by the timer.
    jest.advanceTimersByTime(1000)
    expect(mockUpdate).toHaveBeenCalledTimes(1)
  })

  it('refreshes the weekly note lists after a save, even one flushed on unmount', async () => {
    mockGet.mockResolvedValue(makeNote('', null))
    mockUpdate.mockResolvedValue(makeNote('<p>new</p>', '2026-11-03T09:00:01+00:00'))
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries')
    const { result, unmount } = renderHook(() => useWeeklyNote(DAY), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(invalidate).not.toHaveBeenCalled()

    act(() => result.current.updateNote({ content: '<p>new</p>' }))
    unmount()

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.weeklyNotes.lists() })
    )
  })

  it('reports a conflict on 409 and pauses saves', async () => {
    mockGet.mockResolvedValue(makeNote('<p>old</p>', '2026-11-03T09:00:00+00:00'))
    mockUpdate.mockRejectedValue(new ApiError(409, 'Changed since you read it'))
    const { result } = renderHook(() => useWeeklyNote(DAY), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.updateNote({ content: '<p>mine</p>' }))
    await act(async () => {
      jest.advanceTimersByTime(500)
    })

    await waitFor(() => expect(result.current.conflict).toBe(true))
    act(() => result.current.updateNote({ content: '<p>more</p>' }))
    await act(async () => {
      jest.advanceTimersByTime(500)
    })
    expect(mockUpdate).toHaveBeenCalledTimes(1)
  })
})
