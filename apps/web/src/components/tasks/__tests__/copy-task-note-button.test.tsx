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

  it('is a small labelled icon beside a list row', async () => {
    render(<CopyTaskNoteButton taskId="task-1" variant="icon" />)

    fireEvent.click(screen.getByRole('button', { name: 'ノートをMarkdownでコピー' }))

    await waitFor(() => expect(mockWriteText).toHaveBeenCalled())
  })

  it('formats the clipboard text', () => {
    expect(taskNoteClipboardText('T', 'body')).toBe('# T\n\nbody\n')
  })
})
