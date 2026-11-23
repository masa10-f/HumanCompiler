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

class EmptyNoteError extends Error {}

/** The edit in the editor could not be saved, so there is nothing safe to copy. */
class NoteNotSavedError extends Error {}

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
    // Started in the click itself: Safari allows a clipboard write only while
    // the click is still "active", which it no longer is after a request. The
    // write is handed the text as a promise, so the note can be saved and
    // read while the browser already holds the permission.
    const text = (async () => {
      try {
        await beforeCopy?.()
      } catch (error) {
        throw new NoteNotSavedError(error instanceof Error ? error.message : '')
      }
      const { title, markdown } = await notesApi.getTaskNoteMarkdown(taskId)
      if (!markdown.trim()) throw new EmptyNoteError()
      return taskNoteClipboardText(title, markdown)
    })()
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        const blob = text.then((value) => new Blob([value], { type: 'text/plain' }))
        await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })])
        // Some browsers resolve the write without waiting for the text.
        await text
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(await text)
      } else {
        await text
        throw new Error('Clipboard API is not available')
      }
      toast({
        title: 'ノートをコピーしました',
        description: 'Markdownです。AIとのチャットに貼り付けて使えます。',
      })
    } catch (error) {
      // The write fails with the browser's own error when the text promise
      // rejects, so ask the promise what happened.
      const cause = await text.then(
        () => error,
        (textError: unknown) => textError,
      )
      if (cause instanceof EmptyNoteError) {
        toast({ title: 'コピーするノートがありません', description: 'ノートはまだ空です。' })
        return
      }
      if (cause instanceof NoteNotSavedError) {
        // Trying again does not help here: say what stopped the save (the
        // note changed elsewhere, or the save failed).
        toast({
          title: 'ノートをコピーしませんでした',
          description: cause.message || 'ノートを保存できませんでした。',
          variant: 'destructive',
        })
        return
      }
      log.error('Failed to copy task note', cause, {
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
