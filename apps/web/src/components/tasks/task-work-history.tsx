// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

'use client'

import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Edit, Pencil, Trash2 } from 'lucide-react'

import { LogDeleteDialog } from '@/components/logs/log-delete-dialog'
import { LogEditDialog } from '@/components/logs/log-edit-dialog'
import { SessionKptEditDialog } from '@/components/runner/session-kpt-edit-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useLogsByTask } from '@/hooks/use-logs-query'
import { useWorkSessionsByTask } from '@/hooks/use-work-sessions'
import { formatJSTDateTime } from '@/lib/date-utils'
import { SESSION_DECISION_LABELS } from '@/types/work-session'
import type { WorkSession } from '@/types/work-session'

/** Minutes worked in a session, without its paused time. */
function sessionWorkMinutes(session: WorkSession): number {
  if (session.actual_minutes != null) return session.actual_minutes
  if (session.ended_at && session.started_at) {
    const startMs = new Date(session.started_at).getTime()
    const endMs = new Date(session.ended_at).getTime()
    const pausedSeconds = session.total_paused_seconds || 0
    return Math.floor((endMs - startMs) / (1000 * 60)) - Math.floor(pausedSeconds / 60)
  }
  return 0
}

function hours(minutes: number): string {
  return `${(minutes / 60).toFixed(1)}h`
}

const KPT_STYLES = {
  K: 'border-green-600 text-green-600',
  P: 'border-red-600 text-red-600',
  T: 'border-blue-600 text-blue-600',
} as const

function KptLine({ label, text }: { label: keyof typeof KPT_STYLES; text?: string | null }) {
  if (!text) return null
  return (
    <div className="flex items-start gap-2">
      <Badge variant="outline" className={`shrink-0 text-xs ${KPT_STYLES[label]}`}>
        {label}
      </Badge>
      <p className="min-w-0 break-words text-sm">{text}</p>
    </div>
  )
}

/**
 * A task's time logs and Runner sessions. It loads them itself, so it can be
 * put wherever a task is shown.
 */
export function TaskWorkHistory({ taskId }: { taskId: string }) {
  const [editSession, setEditSession] = useState<WorkSession | null>(null)
  const logsQuery = useLogsByTask(taskId)
  const sessionsQuery = useWorkSessionsByTask(taskId)
  const logs = useMemo(() => logsQuery.data ?? [], [logsQuery.data])
  const sessions = useMemo(() => sessionsQuery.data ?? [], [sessionsQuery.data])
  const totalLogMinutes = useMemo(
    () => logs.reduce((sum, entry) => sum + (entry.actual_minutes || 0), 0),
    [logs],
  )

  return (
    <div className="space-y-5">
      <section aria-label="作業ログ">
        <h4 className="mb-2 text-xs font-medium text-muted-foreground">
          作業ログ（{logs.length}件、{hours(totalLogMinutes)}）
        </h4>
        {logsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">ログを読み込み中...</p>
        ) : logsQuery.error ? (
          <p className="text-sm text-destructive">
            ログの読み込みに失敗しました: {(logsQuery.error as Error).message}
          </p>
        ) : logs.length === 0 ? (
          <p className="text-sm text-muted-foreground">作業ログはまだありません</p>
        ) : (
          <ul className="space-y-2">
            {logs.map((entry) => (
              <li
                key={entry.id}
                className="flex min-w-0 items-start justify-between gap-2 rounded-md bg-muted/50 p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">
                      {hours(entry.actual_minutes)}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatJSTDateTime(entry.created_at)}
                    </span>
                  </div>
                  {entry.comment && (
                    <p className="whitespace-pre-wrap break-words text-sm">{entry.comment}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <LogEditDialog
                    log={entry}
                    trigger={
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                        <Edit className="h-4 w-4" />
                        <span className="sr-only">ログを編集</span>
                      </Button>
                    }
                  />
                  <LogDeleteDialog log={entry}>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="sr-only">ログを削除</span>
                    </Button>
                  </LogDeleteDialog>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Runnerのセッション">
        <h4 className="mb-2 text-xs font-medium text-muted-foreground">
          Runnerのセッション（{sessions.length}件）
        </h4>
        {sessionsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">セッションを読み込み中...</p>
        ) : sessionsQuery.error ? (
          <p className="text-sm text-destructive">
            セッションの読み込みに失敗しました: {(sessionsQuery.error as Error).message}
          </p>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">セッション履歴はまだありません</p>
        ) : (
          <ul className="space-y-2">
            {sessions.map((session) => {
              const hasKpt = session.kpt_keep || session.kpt_problem || session.kpt_try
              return (
                <li key={session.id} className="space-y-2 rounded-md bg-muted/50 p-3">
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-muted-foreground">
                      <span>
                        {format(new Date(session.started_at), 'MM/dd (E) HH:mm', { locale: ja })}
                      </span>
                      <Badge variant="secondary" className="text-xs">
                        {sessionWorkMinutes(session)}分
                      </Badge>
                      {session.decision && (
                        <Badge variant="outline" className="text-xs">
                          {SESSION_DECISION_LABELS[session.decision]}
                        </Badge>
                      )}
                      {!session.ended_at && (
                        <Badge variant="info" className="text-xs">
                          作業中
                        </Badge>
                      )}
                    </div>
                    {session.ended_at && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditSession(session)}
                        className="h-8 w-8 shrink-0 p-0"
                      >
                        <Pencil className="h-4 w-4" />
                        <span className="sr-only">KPT編集</span>
                      </Button>
                    )}
                  </div>
                  {hasKpt ? (
                    <div className="space-y-1.5">
                      <KptLine label="K" text={session.kpt_keep} />
                      <KptLine label="P" text={session.kpt_problem} />
                      <KptLine label="T" text={session.kpt_try} />
                    </div>
                  ) : (
                    <p className="text-xs italic text-muted-foreground">KPT未記入</p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <SessionKptEditDialog
        session={editSession}
        open={!!editSession}
        onOpenChange={(open) => !open && setEditSession(null)}
      />
    </div>
  )
}
