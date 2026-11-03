// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/**
 * Agent proposal inbox types (hand-written; mirror the backend ProposalResponse).
 */

export type ProposalKind =
  | 'goal'
  | 'task'
  | 'quick_task'
  | 'note_append'
  | 'contradiction'
  | 'decision_request'
  | 'experiment';

export type ProposalStatus = 'pending' | 'accepted' | 'edited' | 'rejected';

export type ProposalRejectCategory =
  | 'duplicate'
  | 'wrong'
  | 'not_valuable'
  | 'not_now'
  | 'other';

export type ProposalResultType = 'goal' | 'task' | 'quick_task' | 'context_note';

export interface ProposalSource {
  ref: string;
  quote?: string | null;
  label?: string | null;
}

export interface Proposal {
  id: string;
  kind: ProposalKind;
  status: ProposalStatus;
  title: string;
  rationale: string;
  payload: Record<string, unknown>;
  final_payload: Record<string, unknown> | null;
  sources: ProposalSource[];
  idempotency_key: string;
  agent_name: string;
  project_id: string | null;
  reject_category: ProposalRejectCategory | null;
  decision_note: string | null;
  decision_option: number | null;
  result: { type: ProposalResultType; id: string } | null;
  created_at: string;
  decided_at: string | null;
  updated_at: string;
  project_name: string | null;
  goal_title: string | null;
  task_title: string | null;
  task_goal_id: string | null;
}

export interface ProposalListResponse {
  items: Proposal[];
  total: number;
}

export interface ProposalSummaryItem {
  id: string;
  kind: ProposalKind;
  title: string;
  agent_name: string;
  created_at: string;
}

export interface ProposalSummary {
  pending_count: number;
  latest: ProposalSummaryItem[];
}

export interface ProposalListFilters {
  status: 'pending' | 'decided';
  kind?: ProposalKind;
  project_id?: string;
  limit?: number;
  offset?: number;
}

export interface ProposalAcceptRequest {
  payload?: Record<string, unknown>;
  decision_note?: string;
  decision_option?: number;
}

export interface ProposalRejectRequest {
  reject_category: ProposalRejectCategory;
  decision_note?: string;
}

export const PROPOSAL_KIND_LABELS: Record<ProposalKind, string> = {
  goal: 'Goal',
  task: 'タスク',
  quick_task: 'クイックタスク',
  note_append: 'ノート追記',
  contradiction: '矛盾',
  decision_request: '判断の依頼',
  experiment: '実験',
};

// A pending proposal has no decision to label, so it is not part of this map.
export const PROPOSAL_STATUS_LABELS: Record<
  Exclude<ProposalStatus, 'pending'>,
  string
> = {
  accepted: '承認済み',
  edited: '編集して承認',
  rejected: '却下',
};

export const REJECT_CATEGORY_LABELS: Record<ProposalRejectCategory, string> = {
  duplicate: '重複している',
  wrong: '内容が誤っている',
  not_valuable: '価値が低い・細かすぎる',
  not_now: '今はやらない',
  other: 'その他',
};
