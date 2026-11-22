// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

'use client'

import { useState } from 'react'
import { Copy, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { notesApi } from '@/lib/api'
import { log } from '@/lib/logger'
import { cn } from '@/lib/utils'

interface CopyTaskNoteButtonProps {
  taskId: string
  /**
   * Runs before the note is read, to save an edit still in the editor: the
   * copy is what the server holds.
   */
  beforeCopy?: () => Promise<void>
  /** 'icon' is the small button beside a list row's note excerpt. */
  variant?: 'labelled' | 'icon'
  className?: string
}

/** The text put on the clipboard: the task's title as a heading, then its note. */
export function taskNoteClipboardText(title: string, markdown: string): string {
  return `# ${title}\n\n${markdown}\n`
}

/**
 * Copies a task's note as Markdown, under the task's title. A note is often
 * the prompt for an AI assistant, so it can be handed over in one click.
 */
export function CopyTaskNoteButton({
  taskId,
  beforeCopy,
  variant = 'labelled',
  className,
}: CopyTaskNoteButtonProps) {
  const [copying, setCopying] = useState(false)
  const { toast } = useToast()

  const copy = async () => {
    setCopying(true)
    try {
      await beforeCopy?.()
      const { title, markdown } = await notesApi.getTaskNoteMarkdown(taskId)
      if (!markdown.trim()) {
        toast({ title: 'コピーするノートがありません', description: 'ノートはまだ空です。' })
        return
      }
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard API is not available')
      }
      await navigator.clipboard.writeText(taskNoteClipboardText(title, markdown))
      toast({
        title: 'ノートをコピーしました',
        description: 'Markdownです。AIとのチャットに貼り付けて使えます。',
      })
    } catch (error) {
      log.error('Failed to copy task note', error, {
        component: 'CopyTaskNoteButton',
        taskId,
      })
      toast({
        title: 'ノートをコピーできませんでした',
        description: 'もう一度お試しください。',
        variant: 'destructive',
      })
    } finally {
      setCopying(false)
    }
  }

  const Icon = copying ? Loader2 : Copy
  if (variant === 'icon') {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn('h-6 w-6 shrink-0 p-0 text-muted-foreground', className)}
        aria-label="ノートをMarkdownでコピー"
        title="ノートをMarkdownでコピー"
        disabled={copying}
        onClick={copy}
      >
        <Icon className={cn('h-3.5 w-3.5', copying && 'animate-spin')} />
      </Button>
    )
  }
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={className}
      disabled={copying}
      onClick={copy}
    >
      <Icon className={cn('mr-2 h-4 w-4', copying && 'animate-spin')} />
      Markdownでコピー
    </Button>
  )
}
