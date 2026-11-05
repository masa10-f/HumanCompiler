// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import { waitFor, act } from '@testing-library/react'
import { renderHookWithClient } from './helpers/test-utils'
import {
  useProposals,
  useProposalSummary,
  useAcceptProposal,
  useRejectProposal,
} from '../use-proposals'
import { queryKeys } from '@/lib/query-keys'
import { ApiError } from '@/lib/errors'
import type { Proposal } from '@/types/proposal'

const mockList = jest.fn()
const mockSummary = jest.fn()
const mockAccept = jest.fn()
const mockReject = jest.fn()

jest.mock('@/lib/api', () => ({
  proposalsApi: {
    list: (...args: unknown[]) => mockList(...args),
    summary: (...args: unknown[]) => mockSummary(...args),
    accept: (...args: unknown[]) => mockAccept(...args),
    reject: (...args: unknown[]) => mockReject(...args),
  },
}))

const proposal = { id: 'a1', title: 'Do it' } as Proposal

describe('use-proposals hooks', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('useProposals returns the mocked list', async () => {
    mockList.mockResolvedValue({ items: [proposal], total: 1 })

    const { result } = renderHookWithClient(() => useProposals({ status: 'pending' }))

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({ items: [proposal], total: 1 })
    expect(mockList).toHaveBeenCalledWith({ status: 'pending' })
  })

  it('useProposals refetches on window focus', async () => {
    mockList.mockResolvedValue({ items: [proposal], total: 1 })

    const { result, queryClient } = renderHookWithClient(() => useProposals({ status: 'pending' }))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const observer = queryClient.getQueryCache().getAll()[0].observers[0]
    expect(observer.options.refetchOnWindowFocus).toBe(true)
  })

  it('useProposalSummary returns the summary and can be disabled', async () => {
    mockSummary.mockResolvedValue({ pending_count: 2, latest: [] })

    const { result } = renderHookWithClient(() => useProposalSummary())
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.pending_count).toBe(2)

    mockSummary.mockClear()
    renderHookWithClient(() => useProposalSummary({ enabled: false }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mockSummary).not.toHaveBeenCalled()
  })

  it('useAcceptProposal invalidates the affected roots on success', async () => {
    mockAccept.mockResolvedValue(proposal)
    const { result, queryClient } = renderHookWithClient(() => useAcceptProposal())
    const spy = jest.spyOn(queryClient, 'invalidateQueries')

    await act(async () => {
      await result.current.mutateAsync({ id: 'a1', body: {} })
    })

    expect(mockAccept).toHaveBeenCalledWith('a1', {})
    const keys = spy.mock.calls.map(([filters]) => filters?.queryKey)
    expect(keys).toEqual(
      expect.arrayContaining([
        queryKeys.proposals.all,
        queryKeys.goals.all,
        queryKeys.tasks.all,
        queryKeys.dashboard.all,
        queryKeys.progress.all,
      ]),
    )
    expect(keys).toContainEqual(['proposals'])
  })

  it('useAcceptProposal invalidates nothing on failure', async () => {
    mockAccept.mockRejectedValue(new Error('boom'))
    const { result, queryClient } = renderHookWithClient(() => useAcceptProposal())
    const spy = jest.spyOn(queryClient, 'invalidateQueries')

    await act(async () => {
      await expect(result.current.mutateAsync({ id: 'a1', body: {} })).rejects.toThrow('boom')
    })

    expect(spy).not.toHaveBeenCalled()
  })

  it('useRejectProposal invalidates on success and nothing on failure', async () => {
    mockReject.mockResolvedValueOnce(proposal)
    const { result, queryClient } = renderHookWithClient(() => useRejectProposal())
    const spy = jest.spyOn(queryClient, 'invalidateQueries')
    const body = { reject_category: 'wrong' as const }

    await act(async () => {
      await result.current.mutateAsync({ id: 'a1', body })
    })
    expect(mockReject).toHaveBeenCalledWith('a1', body)
    expect(spy.mock.calls.map(([f]) => f?.queryKey)).toContainEqual(['proposals'])

    spy.mockClear()
    mockReject.mockRejectedValueOnce(new Error('nope'))
    await act(async () => {
      await expect(result.current.mutateAsync({ id: 'a1', body })).rejects.toThrow('nope')
    })
    expect(spy).not.toHaveBeenCalled()
  })

  describe('conflict handling', () => {
    function conflict(message: string) {
      return new ApiError(409, message, { responseData: { detail: message } }, message)
    }
    const body = { reject_category: 'wrong' as const }

    it('invalidates the proposals when accept finds it already decided', async () => {
      mockAccept.mockRejectedValue(conflict('Proposal already decided'))
      const { result, queryClient } = renderHookWithClient(() => useAcceptProposal())
      const spy = jest.spyOn(queryClient, 'invalidateQueries')

      await act(async () => {
        await expect(result.current.mutateAsync({ id: 'a1', body: {} })).rejects.toThrow()
      })

      expect(spy.mock.calls.map(([f]) => f?.queryKey)).toEqual([queryKeys.proposals.all])
    })

    it('invalidates the proposals when reject finds it already decided', async () => {
      mockReject.mockRejectedValue(conflict('Proposal already decided'))
      const { result, queryClient } = renderHookWithClient(() => useRejectProposal())
      const spy = jest.spyOn(queryClient, 'invalidateQueries')

      await act(async () => {
        await expect(result.current.mutateAsync({ id: 'a1', body })).rejects.toThrow()
      })

      expect(spy.mock.calls.map(([f]) => f?.queryKey)).toEqual([queryKeys.proposals.all])
    })

    it('keeps the card when the target no longer exists', async () => {
      mockAccept.mockRejectedValue(
        conflict('Proposal target no longer exists; reject it instead'),
      )
      const { result, queryClient } = renderHookWithClient(() => useAcceptProposal())
      const spy = jest.spyOn(queryClient, 'invalidateQueries')

      await act(async () => {
        await expect(result.current.mutateAsync({ id: 'a1', body: {} })).rejects.toThrow()
      })

      expect(spy).not.toHaveBeenCalled()
    })

    it('keeps the card for a 422', async () => {
      mockAccept.mockRejectedValue(new ApiError(422, 'Proposal already decided', {}, 'x'))
      const { result, queryClient } = renderHookWithClient(() => useAcceptProposal())
      const spy = jest.spyOn(queryClient, 'invalidateQueries')

      await act(async () => {
        await expect(result.current.mutateAsync({ id: 'a1', body: {} })).rejects.toThrow()
      })

      expect(spy).not.toHaveBeenCalled()
    })
  })
})
