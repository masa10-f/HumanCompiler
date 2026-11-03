// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { NoteConflictAlert } from '../note-conflict-alert';

const BANNER = 'このノートは、開いた後に別の場所（エージェントなど）で更新されました。';
const RELOAD = '最新を読み込む';
const RELOAD_HINT = 'この画面で保存していない変更は消えます';
const OVERWRITE = 'この内容で上書き';

function renderAlert(props: { conflict: boolean; saving?: boolean }) {
  const onReload = jest.fn();
  const onOverwrite = jest.fn();
  render(
    <NoteConflictAlert
      conflict={props.conflict}
      saving={props.saving ?? false}
      onReload={onReload}
      onOverwrite={onOverwrite}
    />
  );
  return { onReload, onOverwrite };
}

describe('NoteConflictAlert', () => {
  it('renders nothing without a conflict', () => {
    renderAlert({ conflict: false });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(BANNER)).not.toBeInTheDocument();
  });

  it('shows the exact copy on a conflict', () => {
    renderAlert({ conflict: true });

    expect(screen.getByRole('alert')).toHaveTextContent(BANNER);
    expect(screen.getByText(BANNER)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: RELOAD })).toBeEnabled();
    expect(screen.getByText(RELOAD_HINT)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: OVERWRITE })).toBeEnabled();
  });

  it('calls onReload and onOverwrite', () => {
    const { onReload, onOverwrite } = renderAlert({ conflict: true });

    fireEvent.click(screen.getByRole('button', { name: RELOAD }));
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(onOverwrite).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: OVERWRITE }));
    expect(onOverwrite).toHaveBeenCalledTimes(1);
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons while saving', () => {
    const { onReload, onOverwrite } = renderAlert({ conflict: true, saving: true });

    expect(screen.getByRole('button', { name: RELOAD })).toBeDisabled();
    expect(screen.getByRole('button', { name: OVERWRITE })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: RELOAD }));
    fireEvent.click(screen.getByRole('button', { name: OVERWRITE }));
    expect(onReload).not.toHaveBeenCalled();
    expect(onOverwrite).not.toHaveBeenCalled();
  });
});
