// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { agentTokensApi } from '@/lib/api';
import type { AgentAuditLog } from '@/types/agent-token';

export const AUDIT_LOG_LIMIT = 20;

const HIGHLIGHTED_STATUS_CODES = [401, 403, 429];

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'loaded'; logs: AgentAuditLog[] };

interface AgentTokenAuditLogProps {
  tokenId: string;
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  });
}

/**
 * Shows the latest audit log rows of one agent token. Failures and empty
 * results are reported inline so the surrounding card keeps working.
 */
export function AgentTokenAuditLog({ tokenId }: AgentTokenAuditLogProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    agentTokensApi
      .getAuditLogs(tokenId, AUDIT_LOG_LIMIT)
      .then((logs) => {
        if (!cancelled) setState({ status: 'loaded', logs });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [tokenId]);

  if (state.status === 'loading') {
    return <p className="text-sm text-muted-foreground">読み込み中...</p>;
  }

  if (state.status === 'error') {
    return (
      <p role="alert" className="text-sm text-destructive">
        監査ログを読み込めませんでした
      </p>
    );
  }

  if (state.logs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        まだ記録はありません（記録は 90 日で削除されます）
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>日時</TableHead>
          <TableHead>リクエスト</TableHead>
          <TableHead>ステータス</TableHead>
          <TableHead>IP</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {state.logs.map((log) => {
          const variant = HIGHLIGHTED_STATUS_CODES.includes(log.status_code)
            ? 'destructive'
            : 'outline';
          return (
            <TableRow key={log.id}>
              <TableCell className="whitespace-nowrap">{formatTime(log.created_at)}</TableCell>
              <TableCell className="font-mono text-xs">
                {log.method} {log.route}
              </TableCell>
              <TableCell>
                <Badge variant={variant} data-variant={variant}>
                  {log.status_code}
                </Badge>
              </TableCell>
              <TableCell>{log.client_ip ?? '—'}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
