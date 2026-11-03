// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/**
 * React Query hooks for the agent proposal inbox.
 */

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { proposalsApi } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import type {
  ProposalAcceptRequest,
  ProposalListFilters,
  ProposalRejectRequest,
} from '@/types/proposal';

/**
 * One page of the inbox. Keeps the previous page on screen while the next
 * filter or page loads.
 */
export function useProposals(filters: ProposalListFilters) {
  return useQuery({
    queryKey: queryKeys.proposals.list(filters),
    queryFn: () => proposalsApi.list(filters),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  });
}

/**
 * Pending count and newest proposals. The header remounts on every page, so a
 * refetch on focus and on navigation keeps the badge current.
 */
export function useProposalSummary(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.proposals.summary(),
    queryFn: () => proposalsApi.summary(),
    enabled: options?.enabled,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  });
}

/** Accepting can create goals, tasks and notes, so those caches go stale too. */
function useInvalidateAfterDecision() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.proposals.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.goals.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.progress.all });
  };
}

/**
 * Accept a proposal. On failure nothing is invalidated, so the card keeps its
 * error and the user's input.
 */
export function useAcceptProposal() {
  const invalidate = useInvalidateAfterDecision();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ProposalAcceptRequest }) =>
      proposalsApi.accept(id, body),
    onSuccess: invalidate,
  });
}

/** Reject a proposal. Same invalidation rules as accepting. */
export function useRejectProposal() {
  const invalidate = useInvalidateAfterDecision();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ProposalRejectRequest }) =>
      proposalsApi.reject(id, body),
    onSuccess: invalidate,
  });
}
