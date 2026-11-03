// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/**
 * @jest-environment jsdom
 */
import { Editor } from '@tiptap/core';
import { createContextNoteExtensions } from '../context-note-extensions';

jest.mock('lowlight', () => ({ common: {}, createLowlight: () => ({}) }));
jest.mock('@tiptap/extension-code-block-lowlight', () => ({
  __esModule: true,
  default: {
    configure: () =>
      jest.requireActual('@tiptap/react').Extension.create({ name: 'codeBlockStub' }),
  },
}));

// The HTML the API's note_markdown renders for "- [ ] 親\n  - [x] 子\n- [ ]\n"
// (apps/api tests/test_note_markdown.py pins the same shape).
const AGENT_CHECKLIST_HTML =
  '<ul data-type="taskList">\n' +
  '<li data-type="taskItem" data-checked="false">\n<p>親</p>\n' +
  '<ul data-type="taskList">\n' +
  '<li data-type="taskItem" data-checked="true">\n<p>子</p>\n</li>\n' +
  '</ul>\n</li>\n' +
  '<li data-type="taskItem" data-checked="false">\n<p></p>\n</li>\n' +
  '</ul>\n';

describe('createContextNoteExtensions', () => {
  it('loads agent-written checklists as task items', () => {
    const editor = new Editor({
      extensions: createContextNoteExtensions(),
      content: AGENT_CHECKLIST_HTML,
    });

    expect(editor.getJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: '親' }] },
                {
                  type: 'taskList',
                  content: [
                    {
                      type: 'taskItem',
                      attrs: { checked: true },
                      content: [
                        { type: 'paragraph', content: [{ type: 'text', text: '子' }] },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [{ type: 'paragraph' }],
            },
          ],
        },
      ],
    });
    editor.destroy();
  });
});
