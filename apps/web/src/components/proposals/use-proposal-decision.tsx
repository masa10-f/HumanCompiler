// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { toast } from '@/hooks/use-toast';
import { useAcceptProposal, useRejectProposal } from '@/hooks/use-proposals';
import { proposalErrorMessage, proposalResultHref } from '@/lib/proposal-links';
import {
  PROPOSAL_RESULT_LINK_LABELS,
  type Proposal,
  type ProposalAcceptRequest,
  type ProposalRejectRequest,
} from '@/types/proposal';

/**
 * Accept / reject one proposal with the behaviour every inbox control shares:
 * one request at a time, the error kept for the card, and a toast on success.
 */
export function useProposalDecision(proposal: Proposal) {
  const acceptMutation = useAcceptProposal();
  const rejectMutation = useRejectProposal();
  const [error, setError] = useState<string | null>(null);
  // Synchronous guard: isPending only updates after a re-render, so two quick
  // clicks could otherwise both send a request.
  const inFlight = useRef(false);

  const busy = acceptMutation.isPending || rejectMutation.isPending;

  async function decide<T>(
    run: () => Promise<T>,
    onSuccess: (result: T) => void
  ): Promise<void> {
    if (inFlight.current || busy) return;
    inFlight.current = true;
    setError(null);
    let result: T;
    try {
      result = await run();
    } catch (e) {
      setError(proposalErrorMessage(e));
      return;
    } finally {
      inFlight.current = false;
    }
    onSuccess(result);
  }

  /** `onDone` runs after the success toast. */
  function accept(body: ProposalAcceptRequest, onDone?: () => void) {
    void decide(
      () => acceptMutation.mutateAsync({ id: proposal.id, body }),
      (updated) => {
        const href = proposalResultHref(updated);
        toast({
          title: '提案を承認しました',
          description:
            href && updated.result ? (
              <Link href={href} className="underline underline-offset-2">
                {PROPOSAL_RESULT_LINK_LABELS[updated.result.type]}
              </Link>
            ) : undefined,
        });
        onDone?.();
      }
    );
  }

  /** `onDone` runs after the success toast. */
  function reject(body: ProposalRejectRequest, onDone?: () => void) {
    void decide(
      () => rejectMutation.mutateAsync({ id: proposal.id, body }),
      () => {
        toast({ title: '提案を却下しました' });
        onDone?.();
      }
    );
  }

  return {
    accept,
    reject,
    busy,
    rejectPending: rejectMutation.isPending,
    error,
    clearError: () => setError(null),
  };
}
