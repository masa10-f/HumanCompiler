// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { useAcceptProposal, useRejectProposal } from '@/hooks/use-proposals';
import { proposalErrorMessage, proposalResultHref } from '@/lib/proposal-links';
import {
  PROPOSAL_RESULT_LINK_LABELS,
  type Proposal,
  type ProposalAcceptRequest,
  type ProposalKind,
  type ProposalRejectRequest,
} from '@/types/proposal';
import { RejectProposalDialog } from './reject-proposal-dialog';

/** Kinds whose payload the user can change before accepting (Task 5). */
const EDITABLE_KINDS: ReadonlySet<ProposalKind> = new Set([
  'goal',
  'task',
  'quick_task',
  'note_append',
  'experiment',
]);

/** Kinds that ask for a note or answer before accepting. */
const PANEL_KINDS: ReadonlySet<ProposalKind> = new Set([
  'experiment',
  'decision_request',
  'contradiction',
]);

const NOTE_LABELS: Partial<Record<ProposalKind, string>> = {
  experiment: '実行するエージェントへの追加の指示（任意）',
  decision_request: '答え（選択肢を選ぶか、自由に書く）',
  contradiction: 'コメント（任意）',
};

function optionLabels(proposal: Proposal): string[] {
  const options = proposal.payload?.options;
  if (!Array.isArray(options)) return [];
  return options.map((option: unknown) => {
    const label =
      typeof option === 'object' && option !== null
        ? (option as { label?: unknown }).label
        : undefined;
    return typeof label === 'string' ? label : '';
  });
}

interface ProposalActionsProps {
  proposal: Proposal;
  /** Opens the edit form; the edit button is hidden without it. */
  onEdit?: () => void;
}

export function ProposalActions({ proposal, onEdit }: ProposalActionsProps) {
  const accept = useAcceptProposal();
  const reject = useRejectProposal();
  const fieldId = useId();

  const [panelOpen, setPanelOpen] = useState(false);
  const [note, setNote] = useState('');
  const [option, setOption] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const busy = accept.isPending || reject.isPending;
  const isDecisionRequest = proposal.kind === 'decision_request';
  const noteLabel = NOTE_LABELS[proposal.kind];
  const trimmedNote = note.trim();
  const canSubmitPanel = !isDecisionRequest || option !== '' || trimmedNote !== '';

  async function decide<T>(
    run: () => Promise<T>,
    onDone: (result: T) => void
  ): Promise<void> {
    if (busy) return;
    setError(null);
    try {
      onDone(await run());
    } catch (e) {
      setError(proposalErrorMessage(e));
    }
  }

  function submitAccept(body: ProposalAcceptRequest) {
    void decide(
      () => accept.mutateAsync({ id: proposal.id, body }),
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
        setPanelOpen(false);
      }
    );
  }

  function submitReject(body: ProposalRejectRequest) {
    void decide(
      () => reject.mutateAsync({ id: proposal.id, body }),
      () => {
        toast({ title: '提案を却下しました' });
        setRejectOpen(false);
      }
    );
  }

  function submitPanel() {
    const body: ProposalAcceptRequest = {};
    if (isDecisionRequest && option !== '') body.decision_option = Number(option);
    if (trimmedNote) body.decision_note = trimmedNote;
    submitAccept(body);
  }

  function handleAcceptClick() {
    if (PANEL_KINDS.has(proposal.kind)) {
      setError(null);
      setPanelOpen(true);
    } else {
      submitAccept({});
    }
  }

  function closePanel() {
    setPanelOpen(false);
    setNote('');
    setOption('');
    setError(null);
  }

  function handleRejectOpenChange(open: boolean) {
    setError(null);
    setRejectOpen(open);
  }

  const options = isDecisionRequest ? optionLabels(proposal) : [];

  return (
    <div className="w-full space-y-3">
      {panelOpen && noteLabel ? (
        <div className="space-y-3 rounded-md border p-3">
          {isDecisionRequest ? (
            <RadioGroup value={option} onValueChange={setOption} disabled={busy}>
              {options.map((label, index) => (
                <div key={index} className="flex items-start gap-2">
                  <RadioGroupItem value={String(index)} id={`${fieldId}-option-${index}`} />
                  <Label
                    htmlFor={`${fieldId}-option-${index}`}
                    className="whitespace-pre-wrap break-words font-normal"
                  >
                    {label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor={`${fieldId}-note`}>{noteLabel}</Label>
            <Textarea
              id={`${fieldId}-note`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={busy}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy || !canSubmitPanel} onClick={submitPanel}>
              この内容で承認
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={closePanel}>
              キャンセル
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={busy} onClick={handleAcceptClick}>
            承認
          </Button>
          {onEdit && EDITABLE_KINDS.has(proposal.kind) ? (
            <Button type="button" variant="outline" disabled={busy} onClick={onEdit}>
              編集して承認
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => handleRejectOpenChange(true)}
          >
            却下
          </Button>
        </div>
      )}
      {error && !rejectOpen ? (
        <Alert variant="destructive">
          <AlertDescription className="whitespace-pre-wrap break-words">
            {error}
          </AlertDescription>
        </Alert>
      ) : null}
      <RejectProposalDialog
        open={rejectOpen}
        onOpenChange={handleRejectOpenChange}
        pending={reject.isPending}
        error={rejectOpen ? error : null}
        onSubmit={submitReject}
      />
    </div>
  );
}
