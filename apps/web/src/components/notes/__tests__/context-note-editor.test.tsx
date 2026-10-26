// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import { ContextNoteEditor } from '../context-note-editor';

// lowlight is ESM only and cannot be required by Jest; code highlighting is
// not under test, so stub the code block extension.
jest.mock('lowlight', () => ({ common: {}, createLowlight: () => ({}) }));
jest.mock('@tiptap/extension-code-block-lowlight', () => ({
  __esModule: true,
  default: {
    configure: () =>
      jest.requireActual('@tiptap/react').Extension.create({ name: 'codeBlockStub' }),
  },
}));

// jsdom has no layout, which ProseMirror needs to scroll the selection into view
beforeAll(() => {
  Range.prototype.getBoundingClientRect = () => ({
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON: () => {},
  });
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
});

describe('ContextNoteEditor', () => {
  it('does not report an external content change as a user edit', async () => {
    const onUpdate = jest.fn();
    const { rerender } = render(
      <ContextNoteEditor content="<p>a</p>" onUpdate={onUpdate} />
    );
    expect(await screen.findByText('a')).toBeInTheDocument();

    // e.g. the note was refetched after being edited in another tab
    rerender(<ContextNoteEditor content="<p>from another tab</p>" onUpdate={onUpdate} />);

    expect(await screen.findByText('from another tab')).toBeInTheDocument();
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
