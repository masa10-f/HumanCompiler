// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { formatJapaneseDate } from '@/lib/date-utils';
import { proposalResultHref } from '@/lib/proposal-links';
import {
  PROPOSAL_KIND_LABELS,
  PROPOSAL_STATUS_LABELS,
  REJECT_CATEGORY_LABELS,
  type Proposal,
  type ProposalResultType,
} from '@/types/proposal';
import { ProposalPayloadView } from './proposal-payload-view';
import { ProposalSources } from './proposal-sources';

const RATIONALE_MAX_CHARS = 300;
const RATIONALE_MAX_LINES = 5;

const RESULT_LINK_LABELS: Record<ProposalResultType, string> = {
  goal: '作成した Goal を開く',
  task: '作成したタスクを開く',
  quick_task: 'クイックタスクを開く',
  context_note: 'ノートを開く',
};

// formatJapaneseDate (not safeFormatJapaneseDate, which cannot include the time).
function formatTimestamp(iso: string): string {
  try {
    return formatJapaneseDate(iso, true);
  } catch {
    return '日付不明';
  }
}

function chosenOptionLabel(proposal: Proposal): string | null {
  if (proposal.kind !== 'decision_request') return null;
  const index = proposal.decision_option;
  if (index === null || !Number.isInteger(index)) return null;

  const payload = proposal.final_payload ?? proposal.payload;
  const options = payload?.options;
  if (!Array.isArray(options)) return null;
  const option: unknown = options[index];
  if (typeof option !== 'object' || option === null) return null;
  const label = (option as { label?: unknown }).label;
  return typeof label === 'string' && label !== '' ? label : null;
}

function Rationale({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong =
    text.length > RATIONALE_MAX_CHARS ||
    text.split('\n').length > RATIONALE_MAX_LINES;

  return (
    <div className="space-y-1">
      <p
        className={`whitespace-pre-wrap break-words text-sm ${
          isLong && !expanded ? 'line-clamp-5' : ''
        }`}
      >
        {text}
      </p>
      {isLong ? (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? '折りたたむ' : '続きを読む'}
        </Button>
      ) : null}
    </div>
  );
}

function Decision({ proposal }: { proposal: Proposal }) {
  if (proposal.status === 'pending') return null;

  const chosen = chosenOptionLabel(proposal);
  const resultHref = proposalResultHref(proposal);

  return (
    <div className="space-y-2 border-t pt-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={proposal.status === 'rejected' ? 'destructive' : 'success'}>
          {PROPOSAL_STATUS_LABELS[proposal.status]}
        </Badge>
        {proposal.decided_at ? (
          <span className="text-muted-foreground">
            {formatTimestamp(proposal.decided_at)}
          </span>
        ) : null}
      </div>
      {proposal.reject_category ? (
        <p>{REJECT_CATEGORY_LABELS[proposal.reject_category]}</p>
      ) : null}
      {proposal.decision_note ? (
        <p className="whitespace-pre-wrap break-words">{proposal.decision_note}</p>
      ) : null}
      {chosen ? (
        <p>
          <span className="text-muted-foreground">選んだ選択肢:{' '}</span>
          <span data-testid="chosen-option" className="whitespace-pre-wrap break-words">
            {chosen}
          </span>
        </p>
      ) : null}
      {proposal.result && resultHref ? (
        <Link href={resultHref} className="text-primary underline underline-offset-2">
          {RESULT_LINK_LABELS[proposal.result.type]}
        </Link>
      ) : null}
    </div>
  );
}

interface ProposalCardProps {
  proposal: Proposal;
  /** Rendered in the card footer (accept / reject / edit controls). */
  actions?: ReactNode;
}

export function ProposalCard({ proposal, actions }: ProposalCardProps) {
  const projectName = proposal.project_id
    ? (proposal.project_name ?? '（削除済み）')
    : null;

  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{PROPOSAL_KIND_LABELS[proposal.kind]}</Badge>
          <CardTitle className="min-w-0 whitespace-pre-wrap break-words text-base">
            {proposal.title}
          </CardTitle>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{proposal.agent_name}</span>
          <span>{formatTimestamp(proposal.created_at)}</span>
          {projectName ? <span>{projectName}</span> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Rationale text={proposal.rationale} />
        <ProposalPayloadView proposal={proposal} />
        <ProposalSources sources={proposal.sources} />
        <Decision proposal={proposal} />
      </CardContent>
      {actions ? <CardFooter className="flex-wrap gap-2">{actions}</CardFooter> : null}
    </Card>
  );
}
