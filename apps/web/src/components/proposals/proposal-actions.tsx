// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

'use client';

import { useId, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { isEditableKind } from '@/lib/proposal-edit';
import type {
  Proposal,
  ProposalAcceptRequest,
  ProposalKind,
  ProposalRejectRequest,
} from '@/types/proposal';
import { RejectProposalDialog } from './reject-proposal-dialog';
import { useProposalDecision } from './use-proposal-decision';

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
  const { accept, reject, busy, rejectPending, error, clearError } =
    useProposalDecision(proposal);
  const fieldId = useId();

  const [panelOpen, setPanelOpen] = useState(false);
  const [note, setNote] = useState('');
  const [option, setOption] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const isDecisionRequest = proposal.kind === 'decision_request';
  const noteLabel = NOTE_LABELS[proposal.kind];
  const trimmedNote = note.trim();
  const canSubmitPanel = !isDecisionRequest || option !== '' || trimmedNote !== '';

  function submitAccept(body: ProposalAcceptRequest) {
    accept(body, () => setPanelOpen(false));
  }

  function submitReject(body: ProposalRejectRequest) {
    reject(body, () => setRejectOpen(false));
  }

  function submitPanel() {
    const body: ProposalAcceptRequest = {};
    if (isDecisionRequest && option !== '') body.decision_option = Number(option);
    if (trimmedNote) body.decision_note = trimmedNote;
    submitAccept(body);
  }

  function handleAcceptClick() {
    if (PANEL_KINDS.has(proposal.kind)) {
      clearError();
      setPanelOpen(true);
    } else {
      submitAccept({});
    }
  }

  function closePanel() {
    setPanelOpen(false);
    setNote('');
    setOption('');
    clearError();
  }

  function handleRejectOpenChange(open: boolean) {
    clearError();
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
          {onEdit && isEditableKind(proposal.kind) ? (
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
        pending={rejectPending}
        error={rejectOpen ? error : null}
        onSubmit={submitReject}
      />
    </div>
  );
}
