// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useProjectOptions } from '@/hooks/use-project-query';
import { useProposals } from '@/hooks/use-proposals';
import { AppHeader } from '@/components/layout/app-header';
import { ProposalCard } from '@/components/proposals';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getErrorMessage } from '@/lib/errors';
import { PROPOSAL_KIND_LABELS } from '@/types/proposal';
import type { ProposalKind, ProposalListFilters } from '@/types/proposal';

const PAGE_SIZE = 50;
// Radix Select does not allow an empty string as an item value.
const ALL = 'all';

type InboxStatus = ProposalListFilters['status'];

const EMPTY_MESSAGES: Record<InboxStatus, string> = {
  pending: '未処理の提案はありません',
  decided: '処理済みの提案はありません',
};

export default function InboxPage() {
  const { loading, isAuthenticated } = useAuth();
  const router = useRouter();
  const [status, setStatus] = useState<InboxStatus>('pending');
  const [kind, setKind] = useState<string>(ALL);
  const [projectId, setProjectId] = useState<string>(ALL);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (!loading && !isAuthenticated) router.replace('/login');
  }, [loading, isAuthenticated, router]);

  const ready = !loading && isAuthenticated;
  const filters: ProposalListFilters = {
    status,
    ...(kind !== ALL && { kind: kind as ProposalKind }),
    ...(projectId !== ALL && { project_id: projectId }),
    limit: PAGE_SIZE,
    offset,
  };
  const { data, isLoading, isPlaceholderData, isError, error } =
    useProposals(filters);
  const { data: projects } = useProjectOptions();

  // Deciding the last item of the last page leaves this page empty while
  // earlier ones still have items, so step back to the last page that has some.
  const stranded =
    !isPlaceholderData &&
    offset > 0 &&
    data !== undefined &&
    data.items.length === 0 &&
    data.total > 0;
  const lastPageOffset = data
    ? Math.max(0, Math.floor((data.total - 1) / PAGE_SIZE) * PAGE_SIZE)
    : 0;
  useEffect(() => {
    if (stranded) setOffset(lastPageOffset);
  }, [stranded, lastPageOffset]);

  if (!ready) {
    return (
      <div role="status" className="flex min-h-screen items-center justify-center">
        読み込み中…
      </div>
    );
  }

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const from = offset + 1;
  const to = Math.min(offset + items.length, total);

  const changeStatus = (value: string) => {
    setStatus(value as InboxStatus);
    setOffset(0);
  };
  const changeKind = (value: string) => {
    setKind(value);
    setOffset(0);
  };
  const changeProject = (value: string) => {
    setProjectId(value);
    setOffset(0);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <AppHeader currentPage="inbox" />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-2xl font-bold mb-6">インボックス</h1>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
          <Tabs value={status} onValueChange={changeStatus}>
            <TabsList>
              <TabsTrigger value="pending">未処理</TabsTrigger>
              <TabsTrigger value="decided">処理済み</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select value={kind} onValueChange={changeKind}>
              <SelectTrigger aria-label="種類" className="w-full sm:w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>すべての種類</SelectItem>
                {Object.entries(PROPOSAL_KIND_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={projectId} onValueChange={changeProject}>
              <SelectTrigger aria-label="プロジェクト" className="w-full sm:w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>すべてのプロジェクト</SelectItem>
                {(projects ?? []).map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {isError ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{getErrorMessage(error as Error)}</AlertDescription>
          </Alert>
        ) : isLoading || stranded ? (
          <div className="flex justify-center py-12">
            <Loader2
              role="status"
              aria-label="読み込み中"
              className="h-6 w-6 animate-spin text-muted-foreground"
            />
          </div>
        ) : items.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {EMPTY_MESSAGES[status]}
          </p>
        ) : (
          <div className="space-y-4">
            {items.map((proposal) => (
              <ProposalCard key={proposal.id} proposal={proposal} />
            ))}
          </div>
        )}

        {total > 0 && (
          <div className="mt-6 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {from}–{to} / {total} 件
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                前へ
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                次へ
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
