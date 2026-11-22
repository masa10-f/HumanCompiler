// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { CopyTaskNoteButton, taskNoteClipboardText } from '../copy-task-note-button'

const mockGetTaskNoteMarkdown = jest.fn()
const mockToast = jest.fn()
const mockWriteText = jest.fn()

jest.mock('@/lib/api', () => ({
  notesApi: {
    getTaskNoteMarkdown: (...args: unknown[]) => mockGetTaskNoteMarkdown(...args),
  },
}))
jest.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}))

/** jsdom's Blob has no text(). */
function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true })
}

describe('CopyTaskNoteButton', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockWriteText.mockResolvedValue(undefined)
    setClipboard({ writeText: mockWriteText })
    mockGetTaskNoteMarkdown.mockResolvedValue({
      title: '序論を書く',
      markdown: '## 依頼\n\n800字で書く',
    })
  })

  it('copies the note as Markdown under the task title', async () => {
    render(<CopyTaskNoteButton taskId="task-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Markdownでコピー' }))

    await waitFor(() =>
      expect(mockWriteText).toHaveBeenCalledWith('# 序論を書く\n\n## 依頼\n\n800字で書く\n'),
    )
    expect(mockGetTaskNoteMarkdown).toHaveBeenCalledWith('task-1')
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'ノートをコピーしました' }),
    )
  })

  it('saves a pending edit before reading the note', async () => {
    const order: string[] = []
    const beforeCopy = jest.fn(async () => {
      order.push('save')
    })
    mockGetTaskNoteMarkdown.mockImplementation(async () => {
      order.push('read')
      return { title: 'T', markdown: 'body' }
    })

    render(<CopyTaskNoteButton taskId="task-1" beforeCopy={beforeCopy} />)
    fireEvent.click(screen.getByRole('button', { name: 'Markdownでコピー' }))

    await waitFor(() => expect(mockWriteText).toHaveBeenCalled())
    expect(order).toEqual(['save', 'read'])
  })

  it('copies nothing when the edit in the editor cannot be saved, and says why', async () => {
    const beforeCopy = jest.fn().mockRejectedValue(
      new Error('ノートが別の場所で更新されたため保存していません。'),
    )

    render(<CopyTaskNoteButton taskId="task-1" beforeCopy={beforeCopy} />)
    fireEvent.click(screen.getByRole('button', { name: 'Markdownでコピー' }))

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({
        title: 'ノートをコピーしませんでした',
        description: 'ノートが別の場所で更新されたため保存していません。',
        variant: 'destructive',
      }),
    )
    // The stale note on the server is neither read nor copied.
    expect(mockGetTaskNoteMarkdown).not.toHaveBeenCalled()
    expect(mockWriteText).not.toHaveBeenCalled()
  })

  it('copies nothing for an empty note and says so', async () => {
    mockGetTaskNoteMarkdown.mockResolvedValue({ title: 'T', markdown: ' \n' })

    render(<CopyTaskNoteButton taskId="task-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Markdownでコピー' }))

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'コピーするノートがありません' }),
      ),
    )
    expect(mockWriteText).not.toHaveBeenCalled()
  })

  it.each([
    ['the note cannot be read', () => mockGetTaskNoteMarkdown.mockRejectedValue(new Error('offline'))],
    ['the clipboard refuses', () => mockWriteText.mockRejectedValue(new Error('denied'))],
    ['there is no clipboard', () => setClipboard(undefined)],
  ])('reports a failure when %s, and can be tried again', async (_name, breakIt) => {
    breakIt()

    render(<CopyTaskNoteButton taskId="task-1" />)
    const button = screen.getByRole('button', { name: 'Markdownでコピー' })
    fireEvent.click(button)

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'ノートをコピーできませんでした',
          variant: 'destructive',
        }),
      ),
    )
    expect(button).toBeEnabled()
  })

  it('starts the clipboard write inside the click, before the note is read', async () => {
    // Safari only allows the write while the click is active, so the write is
    // given a promise for the text instead of waiting for it.
    const order: string[] = []
    let written: Promise<Blob> | undefined
    const write = jest.fn(async (items: Array<{ data: Record<string, Promise<Blob>> }>) => {
      order.push('write started')
      written = items[0]!.data['text/plain']
      await written
    })
    class FakeClipboardItem {
      constructor(public data: Record<string, Promise<Blob>>) {}
    }
    Object.defineProperty(window, 'ClipboardItem', { value: FakeClipboardItem, configurable: true })
    setClipboard({ write, writeText: mockWriteText })
    mockGetTaskNoteMarkdown.mockImplementation(async () => {
      order.push('note read')
      return { title: 'T', markdown: 'body' }
    })

    try {
      render(<CopyTaskNoteButton taskId="task-1" />)
      fireEvent.click(screen.getByRole('button', { name: 'Markdownでコピー' }))

      // Synchronously after the click: the write has begun, the read has not finished.
      expect(order[0]).toBe('write started')
      await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({ title: 'ノートをコピーしました' }),
        ),
      )
      expect(await readBlob(await written!)).toBe('# T\n\nbody\n')
      expect(mockWriteText).not.toHaveBeenCalled()
    } finally {
      // @ts-expect-error jsdom has no ClipboardItem of its own
      delete window.ClipboardItem
    }
  })

  it('says the note is empty when the clipboard write was handed an empty note', async () => {
    const write = jest.fn(async (items: Array<{ data: Record<string, Promise<Blob>> }>) => {
      // The browser rejects the write with its own error when the text fails.
      await items[0]!.data['text/plain']!.catch(() => {
        throw new DOMException('rejected', 'NotAllowedError')
      })
    })
    class FakeClipboardItem {
      constructor(public data: Record<string, Promise<Blob>>) {}
    }
    Object.defineProperty(window, 'ClipboardItem', { value: FakeClipboardItem, configurable: true })
    setClipboard({ write })
    mockGetTaskNoteMarkdown.mockResolvedValue({ title: 'T', markdown: '' })

    try {
      render(<CopyTaskNoteButton taskId="task-1" />)
      fireEvent.click(screen.getByRole('button', { name: 'Markdownでコピー' }))

      await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({ title: 'コピーするノートがありません' }),
        ),
      )
      expect(mockToast).toHaveBeenCalledTimes(1)
    } finally {
      // @ts-expect-error jsdom has no ClipboardItem of its own
      delete window.ClipboardItem
    }
  })

  it('is a small labelled icon beside a list row', async () => {
    render(<CopyTaskNoteButton taskId="task-1" variant="icon" />)

    fireEvent.click(screen.getByRole('button', { name: 'ノートをMarkdownでコピー' }))

    await waitFor(() => expect(mockWriteText).toHaveBeenCalled())
  })

  it('formats the clipboard text', () => {
    expect(taskNoteClipboardText('T', 'body')).toBe('# T\n\nbody\n')
  })
})
