// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { toast } from '@/hooks/use-toast';
import { contextExportApi } from '@/lib/api';
import { ContextExportDialog } from '../context-export-dialog';

jest.mock('@/lib/api', () => ({
  contextExportApi: { get: jest.fn() },
}));
jest.mock('@/hooks/use-toast', () => ({
  toast: jest.fn(),
}));

const exportResponse = {
  filename: 'Project_context_20260928.md',
  markdown: '# AIコンテキスト: Project\n\n## ゴール: Goal\n',
  generated_at: '2026-09-28T03:00:00+00:00',
};

const mockGet = jest.mocked(contextExportApi.get);
const mockWriteText = jest.fn();

function openDialog(scope: 'project' | 'goal' = 'project') {
  render(<ContextExportDialog scope={scope} targetId={`${scope}-1`} />);
  fireEvent.click(screen.getByRole('button', { name: 'AI用に書き出し' }));
}

async function generate() {
  fireEvent.click(screen.getByRole('button', { name: '生成' }));
  return screen.findByLabelText('書き出し内容のプレビュー');
}

describe('ContextExportDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockResolvedValue(exportResponse);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: mockWriteText },
      configurable: true,
    });
    mockWriteText.mockResolvedValue(undefined);
  });

  it('generates a preview with the selected options', async () => {
    openDialog('goal');

    fireEvent.click(screen.getByLabelText('完了・キャンセル済みを含める'));
    fireEvent.click(screen.getByLabelText('デイリープランの記録を含める'));
    fireEvent.click(screen.getByLabelText('直近30日'));
    const preview = await generate();

    expect(mockGet).toHaveBeenCalledWith('goal', 'goal-1', {
      includeCompleted: false,
      includeWorkSessions: true,
      includeDailyPlans: false,
      periodDays: 30,
    });
    expect(preview).toHaveValue(exportResponse.markdown);
    expect(screen.getByText(exportResponse.filename)).toBeInTheDocument();
    expect(
      screen.getByText(`${exportResponse.markdown.length.toLocaleString()}文字`),
    ).toBeInTheDocument();
  });

  it('copies the export to the clipboard', async () => {
    openDialog();
    await generate();

    fireEvent.click(screen.getByRole('button', { name: 'コピー' }));

    await waitFor(() => expect(mockWriteText).toHaveBeenCalledWith(exportResponse.markdown));
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'クリップボードにコピーしました' }),
    );
  });

  it('selects the preview when the clipboard is unavailable', async () => {
    mockWriteText.mockRejectedValue(new Error('denied'));
    openDialog();
    const preview = (await generate()) as HTMLTextAreaElement;
    const select = jest.spyOn(preview, 'select');

    fireEvent.click(screen.getByRole('button', { name: 'コピー' }));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'コピーできませんでした', variant: 'destructive' }),
      ),
    );
    expect(select).toHaveBeenCalled();
  });

  it('downloads the export as a Markdown file', async () => {
    const createObjectURL = jest.fn(() => 'blob:export');
    const revokeObjectURL = jest.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.download).toBe(exportResponse.filename);
        expect(this.href).toBe('blob:export');
      });
    openDialog();
    await generate();

    fireEvent.click(screen.getByRole('button', { name: 'ダウンロード' }));

    expect(click).toHaveBeenCalledTimes(1);
    const blob = (createObjectURL.mock.calls[0] as unknown[])[0] as Blob;
    expect(blob.type).toBe('text/markdown;charset=utf-8');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:export');
    click.mockRestore();
  });

  it('clears the preview when options change', async () => {
    openDialog();
    await generate();

    fireEvent.click(screen.getByLabelText('作業セッションを含める'));

    expect(screen.queryByLabelText('書き出し内容のプレビュー')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'コピー' })).not.toBeInTheDocument();
  });

  it('shows an error toast when the export fails', async () => {
    mockGet.mockRejectedValue(new Error('Project not found'));
    openDialog();

    fireEvent.click(screen.getByRole('button', { name: '生成' }));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '書き出しに失敗しました',
          description: 'Project not found',
          variant: 'destructive',
        }),
      ),
    );
    expect(screen.getByRole('button', { name: '生成' })).toBeEnabled();
  });
});
