'use client'

import React from 'react'
import { ArrowUpRight, Check, CircleDot, FolderKanban } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { clampPercentage } from '@/lib/timeline/utils'
import type { TimelineOverviewData } from '@/types/timeline'

interface TimelineOverviewProps {
  data: TimelineOverviewData | null
  isLoading: boolean
  error?: string | null
  onProjectSelect: (projectId: string) => void
}

export function TimelineOverview({
  data,
  isLoading,
  error,
  onProjectSelect,
}: TimelineOverviewProps) {
  if (isLoading) {
    return (
      <div
        className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
        aria-label="プロジェクトを読み込み中"
      >
        {[0, 1, 2].map((item) => (
          <div
            key={item}
            className="h-64 animate-pulse rounded-3xl bg-slate-200/70 dark:bg-slate-800"
          />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <Card className="border-red-200 bg-red-50 shadow-none">
        <CardContent className="py-12 text-center text-sm text-red-700">
          {error}
        </CardContent>
      </Card>
    )
  }

  if (!data?.projects?.length) {
    return (
      <Card className="rounded-3xl border-dashed shadow-none">
        <CardContent className="flex flex-col items-center py-16 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500">
            <FolderKanban className="h-6 w-6" />
          </div>
          <p className="mt-4 text-sm font-medium text-slate-700 dark:text-slate-200">
            表示できるプロジェクトがありません
          </p>
          <p className="mt-1 text-xs text-slate-500">
            期間を広げると、プロジェクトが見つかる場合があります。
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {data.projects.map((project) => {
        const progress = Math.round(
          clampPercentage(project.statistics.tasks_completion_rate),
        )
        const activeTasks = project.statistics.in_progress_tasks
        return (
          <button
            key={project.id}
            type="button"
            onClick={() => onProjectSelect(project.id)}
            className="group rounded-3xl text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          >
            <Card className="h-full overflow-hidden rounded-3xl border-slate-200 shadow-[0_16px_45px_-35px_rgba(15,23,42,0.55)] transition-all duration-200 group-hover:-translate-y-1 group-hover:border-blue-300 group-hover:shadow-[0_22px_55px_-32px_rgba(37,99,235,0.4)] dark:border-slate-800 dark:group-hover:border-blue-700">
              <CardContent className="p-5 sm:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-950 text-white dark:bg-white dark:text-slate-950">
                    <FolderKanban className="h-5 w-5" />
                  </div>
                  <div className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 text-slate-400 transition-colors group-hover:border-blue-200 group-hover:bg-blue-50 group-hover:text-blue-600 dark:border-slate-700 dark:group-hover:border-blue-800 dark:group-hover:bg-blue-950">
                    <ArrowUpRight className="h-4 w-4" />
                  </div>
                </div>

                <h3 className="mt-5 line-clamp-1 text-lg font-semibold tracking-tight text-slate-950 dark:text-white">
                  {project.title}
                </h3>
                <p className="mt-2 line-clamp-2 min-h-10 text-sm leading-5 text-slate-500 dark:text-slate-400">
                  {project.description || '説明はまだありません'}
                </p>

                <div className="mt-6 flex items-end justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                      TASK PROGRESS
                    </p>
                    <div className="mt-1 font-mono text-4xl font-semibold tracking-[-0.08em] text-slate-950 dark:text-white">
                      {progress}
                      <span className="ml-1 text-lg tracking-normal text-slate-400">
                        %
                      </span>
                    </div>
                  </div>
                  <div className="pb-1 text-right text-xs text-slate-500">
                    <p className="font-semibold text-slate-700 dark:text-slate-300">
                      {project.statistics.completed_tasks} /{' '}
                      {project.statistics.total_tasks} 完了
                    </p>
                    <p className="mt-1">{activeTasks}件が進行中</p>
                  </div>
                </div>

                <div
                  className="mt-4 h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
                  role="progressbar"
                  aria-label={`${project.title}のタスク完了率`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progress}
                >
                  <div
                    className="h-full rounded-full bg-blue-600 transition-all duration-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>

                <div className="mt-5 flex items-center gap-4 border-t border-slate-100 pt-4 text-xs text-slate-500 dark:border-slate-800">
                  <span className="inline-flex items-center gap-1.5">
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                    ゴール {project.statistics.completed_goals}/
                    {project.statistics.total_goals}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <CircleDot className="h-3.5 w-3.5 text-blue-500" />
                    タスク {project.statistics.total_tasks}
                  </span>
                </div>
              </CardContent>
            </Card>
          </button>
        )
      })}
    </div>
  )
}
