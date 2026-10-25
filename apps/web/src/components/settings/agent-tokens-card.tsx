// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, Copy, Key, Plus, Trash2 } from 'lucide-react';
import { AgentTokenAuditLog } from '@/components/settings/agent-token-audit-log';
import { AgentTokenCreateDialog } from '@/components/settings/agent-token-create-dialog';
import { AgentTokenUsageGuide } from '@/components/settings/agent-token-usage-guide';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ConfirmationModal } from '@/components/ui/confirmation-modal';
import { agentTokensApi } from '@/lib/api';
import { log } from '@/lib/logger';
import type { AgentScopeCatalog, AgentToken, AgentTokenCreate } from '@/types/agent-token';

type Message = { kind: 'success' | 'error'; text: string };

interface NewSecret {
  tokenId: string;
  value: string;
}

function formatDate(value: string | null): string {
  if (!value) return '未使用';
  return new Date(value).toLocaleString('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/** Catalog scopes first (in catalog order), then unknown scopes in their original order. */
function orderScopes(scopes: string[], catalog: AgentScopeCatalog | null): string[] {
  if (!catalog) return scopes;
  const known = catalog.scopes.map((info) => info.scope).filter((s) => scopes.includes(s));
  return [...known, ...scopes.filter((s) => !known.includes(s))];
}

interface AgentTokenRowProps {
  token: AgentToken;
  catalog: AgentScopeCatalog | null;
  disabled: boolean;
  onRevoke: (token: AgentToken) => void;
}

function AgentTokenRow({ token, catalog, disabled, onRevoke }: AgentTokenRowProps) {
  return (
    <li data-token-row className="rounded border p-3">
      <Collapsible>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-2">
            <div>
              <h3 className="truncate font-medium">{token.name}</h3>
              {token.description && (
                <p className="text-sm text-muted-foreground">{token.description}</p>
              )}
            </div>
            <ul aria-label="スコープ" className="flex flex-wrap gap-1">
              {orderScopes(token.scopes, catalog).map((scope) => {
                const broad = catalog?.scopes.find((info) => info.scope === scope)?.broad;
                return (
                  <li key={scope}>
                    <Badge
                      variant={broad ? 'warning' : 'secondary'}
                      title={broad ? '広い読み取り権限' : undefined}
                      className="font-mono"
                    >
                      {scope}
                    </Badge>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>{token.token_prefix}…</span>
              <span>作成: {formatDate(token.created_at)}</span>
              <span>最終使用: {formatDate(token.last_used_at)}</span>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <CollapsibleTrigger asChild>
              <Button type="button" variant="outline" size="sm">
                監査ログ
              </Button>
            </CollapsibleTrigger>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onRevoke(token)}
              disabled={disabled}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              失効
            </Button>
          </div>
        </div>
        <CollapsibleContent className="pt-3">
          <AgentTokenAuditLog tokenId={token.id} />
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

/**
 * Settings card for agent tokens: list, create, revoke and inspect the audit
 * log. The token list and the scope catalog load independently so that a
 * failure of one does not hide the other.
 */
export function AgentTokensCard() {
  const [tokens, setTokens] = useState<AgentToken[]>([]);
  const [catalog, setCatalog] = useState<AgentScopeCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [listFailed, setListFailed] = useState(false);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [newSecret, setNewSecret] = useState<NewSecret | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [tokenToRevoke, setTokenToRevoke] = useState<AgentToken | null>(null);
  const [revoking, setRevoking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([agentTokensApi.getAll(), agentTokensApi.getScopes()]).then(
      ([tokensResult, catalogResult]) => {
        if (cancelled) return;
        if (tokensResult.status === 'fulfilled') {
          setTokens(tokensResult.value);
        } else {
          log.error('Failed to fetch agent tokens', tokensResult.reason as Error, {
            component: 'AgentTokensCard',
          });
          setListFailed(true);
        }
        if (catalogResult.status === 'fulfilled') {
          setCatalog(catalogResult.value);
        } else {
          log.error('Failed to fetch agent token scopes', catalogResult.reason as Error, {
            component: 'AgentTokensCard',
          });
          setCatalogFailed(true);
        }
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCreate = async (data: AgentTokenCreate) => {
    setMessage(null);
    try {
      const { token: secret, ...created } = await agentTokensApi.create(data);
      setTokens((current) => [created, ...current]);
      setNewSecret({ tokenId: created.id, value: secret });
      setMessage({ kind: 'success', text: 'エージェントトークンを作成しました' });
    } catch (err) {
      log.error('Failed to create agent token', err as Error, { component: 'AgentTokensCard' });
      throw err;
    }
  };

  const handleCopy = async () => {
    if (!newSecret) return;
    try {
      await navigator.clipboard.writeText(newSecret.value);
      setMessage({ kind: 'success', text: 'コピーしました' });
    } catch (err) {
      log.error('Failed to copy agent token', err as Error, { component: 'AgentTokensCard' });
      setMessage({ kind: 'error', text: 'コピーに失敗しました' });
    }
  };

  const confirmRevoke = async () => {
    if (!tokenToRevoke) return;
    const target = tokenToRevoke;
    setRevoking(true);
    setMessage(null);
    try {
      await agentTokensApi.revoke(target.id);
      setTokens((current) => current.filter((token) => token.id !== target.id));
      setNewSecret((current) => (current?.tokenId === target.id ? null : current));
      setMessage({ kind: 'success', text: 'エージェントトークンを失効しました' });
    } catch (err) {
      log.error('Failed to revoke agent token', err as Error, { component: 'AgentTokensCard' });
      setMessage({ kind: 'error', text: 'エージェントトークンの失効に失敗しました' });
    } finally {
      setRevoking(false);
      setTokenToRevoke(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Key className="h-5 w-5" />
          エージェントトークン
        </CardTitle>
        <CardDescription>
          エージェントや外部の hook が HumanCompiler のデータを読み書きするためのトークン。スコープは作成後に変更できません
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {newSecret && (
          <Alert>
            <CheckCircle className="h-4 w-4" />
            <AlertDescription className="space-y-2">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <code className="min-w-0 flex-1 overflow-x-auto rounded bg-muted px-2 py-1 text-xs">
                  {newSecret.value}
                </code>
                <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
                  <Copy className="mr-2 h-4 w-4" />
                  コピー
                </Button>
              </div>
              <p>この値は今だけ表示されます。安全な場所に保存してください。</p>
            </AlertDescription>
          </Alert>
        )}

        {message && (
          <Alert variant={message.kind === 'error' ? 'destructive' : 'default'}>
            {message.kind === 'error' ? (
              <AlertCircle className="h-4 w-4" />
            ) : (
              <CheckCircle className="h-4 w-4" />
            )}
            <AlertDescription>{message.text}</AlertDescription>
          </Alert>
        )}

        {catalogFailed && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>スコープを読み込めませんでした</AlertDescription>
          </Alert>
        )}

        <div>
          <Button type="button" onClick={() => setIsCreateOpen(true)} disabled={!catalog}>
            <Plus className="mr-2 h-4 w-4" />
            トークンを作成
          </Button>
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground">読み込み中...</div>
        ) : listFailed ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>エージェントトークンを読み込めませんでした</AlertDescription>
          </Alert>
        ) : tokens.length === 0 ? (
          <div className="rounded border border-dashed p-4 text-sm text-muted-foreground">
            有効なエージェントトークンはありません
          </div>
        ) : (
          <ul className="space-y-2">
            {tokens.map((token) => (
              <AgentTokenRow
                key={token.id}
                token={token}
                catalog={catalog}
                disabled={revoking}
                onRevoke={setTokenToRevoke}
              />
            ))}
          </ul>
        )}

        <AgentTokenUsageGuide />
      </CardContent>

      {catalog && (
        <AgentTokenCreateDialog
          open={isCreateOpen}
          onOpenChange={setIsCreateOpen}
          catalog={catalog}
          onCreate={handleCreate}
        />
      )}
      <ConfirmationModal
        isOpen={tokenToRevoke !== null}
        onClose={() => setTokenToRevoke(null)}
        onConfirm={confirmRevoke}
        title="エージェントトークンを失効"
        description="このエージェントトークンを失効してもよろしいですか？ 失効はすぐに反映され、元に戻せません。"
        confirmText="失効"
        cancelText="キャンセル"
        variant="destructive"
        loading={revoking}
      />
    </Card>
  );
}
