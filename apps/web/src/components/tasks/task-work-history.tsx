// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

'use client'

import { useMemo, useState } from 'react'

import { SessionKptEditDialog } from '@/components/runner/session-kpt-edit-dialog'
import { WorkRecordItem, buildWorkRecords, hours } from '@/components/work-records/work-record-item'
import { TASK_LOGS_LIMIT, useLogsByTask } from '@/hooks/use-logs-query'
import { useWorkSessionsByTask } from '@/hooks/use-work-sessions'
import type { WorkSession } from '@/types/work-session'

/**
 * A task's work records as one timeline: time entered by hand and Runner
 * sessions together, each piece of work once. It loads them itself, so it can
 * be put wherever a task is shown.
 */
export function TaskWorkHistory({ taskId }: { taskId: string }) {
  const [editSession, setEditSession] = useState<WorkSession | null>(null)
  const logsQuery = useLogsByTask(taskId)
  const sessionsQuery = useWorkSessionsByTask(taskId)
  const logs = useMemo(() => logsQuery.data ?? [], [logsQuery.data])
  const sessions = useMemo(() => sessionsQuery.data ?? [], [sessionsQuery.data])
  const records = useMemo(() => buildWorkRecords(logs, sessions), [logs, sessions])
  // Time is counted from the logs only: they are what estimates and reports use.
  const totalMinutes = useMemo(
    () => logs.reduce((sum, entry) => sum + (entry.actual_minutes || 0), 0),
    [logs],
  )
  const loading = logsQuery.isLoading || sessionsQuery.isLoading
  // Only the latest logs are loaded: a full page, or a failed load, may hide
  // the log of a session shown here.
  const logsComplete =
    !logsQuery.error && logsQuery.data !== undefined && logs.length < TASK_LOGS_LIMIT

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-muted-foreground">
        {logs.length}件の記録、合計 {hours(totalMinutes)}
      </p>
      {logsQuery.error && (
        <p className="text-sm text-destructive">
          時間記録の読み込みに失敗しました: {(logsQuery.error as Error).message}
        </p>
      )}
      {sessionsQuery.error && (
        <p className="text-sm text-destructive">
          セッションの読み込みに失敗しました: {(sessionsQuery.error as Error).message}
        </p>
      )}
      {loading ? (
        <p className="text-sm text-muted-foreground">作業記録を読み込み中...</p>
      ) : records.length === 0 ? (
        !logsQuery.error &&
        !sessionsQuery.error && (
          <p className="text-sm text-muted-foreground">作業記録はまだありません</p>
        )
      ) : (
        <ul className="space-y-2">
          {records.map((record) => (
            <WorkRecordItem
              key={record.key}
              record={record}
              logsComplete={logsComplete}
              onEditKpt={setEditSession}
            />
          ))}
        </ul>
      )}

      <SessionKptEditDialog
        session={editSession}
        open={!!editSession}
        onOpenChange={(open) => !open && setEditSession(null)}
      />
    </div>
  )
}
