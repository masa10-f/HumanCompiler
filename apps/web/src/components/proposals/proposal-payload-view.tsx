// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import type { ReactNode } from 'react';
import { safeFormatJapaneseDate } from '@/lib/date-utils';
import { workTypeLabels, type WorkType } from '@/types/task';
import type { Proposal } from '@/types/proposal';

const DELETED = '（削除済み）';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function asRecords(value: unknown): UnknownRecord[] {
  return Array.isArray(value)
    ? value.map(asRecord).filter((v): v is UnknownRecord => v !== null)
    : [];
}

/** A scalar as text; an array of scalars as one item per line; else null. */
function text(value: unknown): string | null {
  if (typeof value === 'string') return value === '' ? null : value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    const lines = value.map(text).filter((v): v is string => v !== null);
    return lines.length > 0 ? lines.join('\n') : null;
  }
  return null;
}

function hours(value: unknown): string | null {
  const t = text(value);
  return t === null ? null : `${t}h`;
}

function dueDate(value: unknown): string | null {
  const t = text(value);
  return t === null ? null : safeFormatJapaneseDate(t, t);
}

function workType(value: unknown): string | null {
  const t = text(value);
  if (t === null) return null;
  return Object.prototype.hasOwnProperty.call(workTypeLabels, t) ? workTypeLabels[t as WorkType] : t;
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  if (value === null || value === undefined) return null;
  return (
    <div className="grid gap-1 sm:grid-cols-[8rem_1fr]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 whitespace-pre-wrap break-words">{value}</dd>
    </div>
  );
}

function workFields(payload: UnknownRecord): ReactNode {
  return (
    <>
      <Row label="タイトル" value={text(payload.title)} />
      <Row label="説明" value={text(payload.description)} />
      <Row label="見積もり" value={hours(payload.estimate_hours)} />
      <Row label="期限" value={dueDate(payload.due_date)} />
      <Row label="作業種別" value={workType(payload.work_type)} />
      <Row label="優先度" value={text(payload.priority)} />
    </>
  );
}

function noteTarget(
  proposal: Proposal,
  payload: UnknownRecord
): { label: string; name: string } | null {
  const target = asRecord(payload.target);
  if (!target) return null;
  if (target.project_id) {
    return { label: 'プロジェクト', name: proposal.project_name ?? DELETED };
  }
  if (target.goal_id) {
    return { label: 'Goal', name: proposal.goal_title ?? DELETED };
  }
  if (target.task_id) {
    return { label: 'タスク', name: proposal.task_title ?? DELETED };
  }
  return null;
}

function renderBody(proposal: Proposal, payload: UnknownRecord): ReactNode {
  switch (proposal.kind) {
    case 'goal':
      return workFields(payload);
    case 'task':
      return (
        <>
          <Row label="Goal" value={proposal.goal_title ?? DELETED} />
          {workFields(payload)}
        </>
      );
    case 'quick_task':
      return workFields(payload);
    case 'note_append': {
      const target = noteTarget(proposal, payload);
      return (
        <>
          {target ? <Row label={`追記先（${target.label}）`} value={target.name} /> : null}
          <Row label="内容" value={text(payload.content_markdown)} />
        </>
      );
    }
    case 'experiment':
      return (
        <>
          <Row label="確かめること" value={text(payload.question)} />
          <Row label="方法" value={text(payload.method)} />
          <Row label="肯定の条件" value={text(payload.supports_if)} />
          <Row label="否定の条件" value={text(payload.refutes_if)} />
          <Row label="手間" value={text(payload.effort)} />
          <Row label="見積もり時間" value={hours(payload.estimated_hours)} />
          <Row label="前提" value={text(payload.prerequisites)} />
        </>
      );
    case 'decision_request': {
      const options = asRecords(payload.options);
      return (
        <>
          <Row label="質問" value={text(payload.question)} />
          {options.length > 0 ? (
            <Row
              label="選択肢"
              value={
                <ol className="list-decimal space-y-1 pl-5">
                  {options.map((option, index) => (
                    <li key={index}>
                      <span>{text(option.label)}</span>
                      {text(option.description) ? (
                        <p className="text-muted-foreground">
                          {text(option.description)}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              }
            />
          ) : null}
          <Row label="推奨" value={text(payload.recommendation)} />
          <Row label="背景" value={text(payload.context)} />
        </>
      );
    }
    case 'contradiction': {
      const claims = asRecords(payload.claims);
      return (
        <>
          {claims.length > 0 ? (
            <Row
              label="主張"
              value={
                <ul className="space-y-1">
                  {claims.map((claim, index) => (
                    <li key={index}>
                      <span>{text(claim.text)}</span>
                      {text(claim.source_ref) ? (
                        <code className="ml-2 break-all font-mono text-xs text-muted-foreground">
                          {text(claim.source_ref)}
                        </code>
                      ) : null}
                    </li>
                  ))}
                </ul>
              }
            />
          ) : null}
          <Row label="説明" value={text(payload.explanation)} />
          <Row label="解決の提案" value={text(payload.suggested_resolution)} />
        </>
      );
    }
    default:
      return null;
  }
}

/** What approving would create, read from final_payload ?? payload. */
export function ProposalPayloadView({ proposal }: { proposal: Proposal }) {
  const payload = proposal.final_payload ?? proposal.payload ?? {};
  return <dl className="space-y-2 text-sm">{renderBody(proposal, payload)}</dl>;
}
