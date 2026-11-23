// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

'use client'

import { Edit, Pencil, Timer, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'

import { LogDeleteDialog } from '@/components/logs/log-delete-dialog'
import { LogEditDialog } from '@/components/logs/log-edit-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatJSTDateTime } from '@/lib/date-utils'
import { cn } from '@/lib/utils'
import type { Log } from '@/types/log'
import { CHECKOUT_TYPE_LABELS, SESSION_DECISION_LABELS } from '@/types/work-session'
import type { WorkSession } from '@/types/work-session'

/**
 * One piece of work on a task. A Runner checkout writes a time log and a
 * session for the same work, linked by the log's `work_session_id`: they are
 * one record here, the log's time with the session's reflection.
 *
 * A task's panel builds its records from the task's logs and sessions
 * (`buildWorkRecords`); the work history page gets them from the API already
 * joined. Both show them with `WorkRecordItem`.
 */
export interface WorkRecord {
  key: string
  /** When the work was recorded (a running session: when it started). */
  at: string
  /** The time log; absent for a running session and a session no log is linked to. */
  log?: Log
  /** The Runner session; absent for a time entered by hand. */
  session?: WorkSession
}

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

/** Logs and sessions as one list of work records, newest first. */
export function buildWorkRecords(logs: Log[], sessions: WorkSession[]): WorkRecord[] {
  const sessionById = new Map(sessions.map((session) => [session.id, session]))
  const linked = new Set<string>()
  const records: WorkRecord[] = logs.map((log) => {
    const session = log.work_session_id ? sessionById.get(log.work_session_id) : undefined
    if (session) linked.add(session.id)
    return { key: `log:${log.id}`, at: log.created_at, log, session }
  })
  for (const session of sessions) {
    if (linked.has(session.id)) continue
    records.push({
      key: `session:${session.id}`,
      at: session.ended_at ?? session.started_at,
      session,
    })
  }
  return records.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
}

/**
 * The comment a checkout writes on its log from the session's reflection: the
 * same text as `kpt_summary` in the API's services. A log comment equal to it
 * says nothing the reflection does not.
 */
export function kptSummary(session: WorkSession): string | null {
  const head = (text: string) => Array.from(text).slice(0, 100).join('')
  const parts: string[] = []
  if (session.kpt_keep) parts.push(`K: ${head(session.kpt_keep)}`)
  if (session.kpt_problem) parts.push(`P: ${head(session.kpt_problem)}`)
  if (session.kpt_try) parts.push(`T: ${head(session.kpt_try)}`)
  if (parts.length === 0) return null
  return Array.from(parts.join(' | ')).slice(0, 500).join('')
}

/** The log's comment, unless it only repeats the session's reflection. */
function ownComment(log?: Log, session?: WorkSession): string | null {
  const comment = log?.comment?.trim()
  if (!comment) return null
  if (session && comment === kptSummary(session)?.trim()) return null
  return comment
}

const CLOCK_TIME = { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' } as const

/** When a session ran: its start, and its end once it has one. */
function sessionPeriod(session: WorkSession): string {
  const start = formatJSTDateTime(session.started_at)
  if (!session.ended_at) return `${start} →`
  return `${start} → ${formatJSTDateTime(session.ended_at, CLOCK_TIME)}`
}

export function hours(minutes: number): string {
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

export function WorkRecordItem({
  record,
  logsComplete,
  onEditKpt,
  heading,
  detailed = false,
  className,
}: {
  record: WorkRecord
  /** Every log of the task is loaded, so a session without one here has none. */
  logsComplete: boolean
  onEditKpt: (session: WorkSession) => void
  /** Shown above the record, e.g. its task where records of many tasks are listed. */
  heading?: ReactNode
  /** Also show when the session ran and how it was checked out. */
  detailed?: boolean
  className?: string
}) {
  const { log, session } = record
  const running = Boolean(session) && !session!.ended_at
  const minutes = log ? log.actual_minutes : session ? sessionWorkMinutes(session) : 0
  const hasKpt = Boolean(session && (session.kpt_keep || session.kpt_problem || session.kpt_try))
  const comment = ownComment(log, session)

  return (
    <li className={cn('space-y-2 rounded-md bg-muted/50 p-3', className)}>
      {heading}
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {running ? (
            <Badge variant="info" className="text-xs">
              作業中
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-xs">
              {hours(minutes)}
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">
            {detailed && session ? sessionPeriod(session) : formatJSTDateTime(record.at)}
          </span>
          {session && (
            <Badge variant="outline" className="text-xs">
              <Timer className="mr-1 h-3 w-3" />
              Runner
            </Badge>
          )}
          {session?.decision && (
            <Badge variant="outline" className="text-xs">
              {SESSION_DECISION_LABELS[session.decision]}
            </Badge>
          )}
          {detailed && session?.checkout_type && (
            <Badge variant="outline" className="text-xs">
              {CHECKOUT_TYPE_LABELS[session.checkout_type]}
            </Badge>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {session?.ended_at && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onEditKpt(session)}
              className="h-8 w-8 p-0"
            >
              <Pencil className="h-4 w-4" />
              <span className="sr-only">振り返りを編集</span>
            </Button>
          )}
          {log && (
            <>
              <LogEditDialog
                log={log}
                trigger={
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                    <Edit className="h-4 w-4" />
                    <span className="sr-only">時間とコメントを編集</span>
                  </Button>
                }
              />
              <LogDeleteDialog log={log}>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                  <span className="sr-only">記録を削除</span>
                </Button>
              </LogDeleteDialog>
            </>
          )}
        </div>
      </div>

      {hasKpt && (
        <div className="space-y-1.5">
          <KptLine label="K" text={session!.kpt_keep} />
          <KptLine label="P" text={session!.kpt_problem} />
          <KptLine label="T" text={session!.kpt_try} />
        </div>
      )}
      {comment && <p className="whitespace-pre-wrap break-words text-sm">{comment}</p>}
      {session?.ended_at && !log && logsComplete && (
        <p className="text-xs text-muted-foreground">
          このセッションに紐付く時間記録がありません（合計には含まれません）。
        </p>
      )}
    </li>
  )
}
