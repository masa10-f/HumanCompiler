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

const AGENT_TABLE_HTML =
  '<table>\n<thead>\n<tr>\n<th>タスク</th>\n<th>割当</th>\n</tr>\n</thead>\n' +
  '<tbody>\n<tr>\n<td>AGSでPT信号を取得する</td>\n<td>6h</td>\n</tr>\n</tbody>\n</table>\n';

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

  it('loads agent-written tables as table nodes', () => {
    // The HTML the API's note_markdown renders for a pipe table
    // (apps/api tests/test_note_markdown.py pins the same shape).
    const editor = new Editor({
      extensions: createContextNoteExtensions(),
      content: AGENT_TABLE_HTML,
    });

    const cell = (type: string, text: string) => ({
      type,
      attrs: { colspan: 1, rowspan: 1, colwidth: null, align: null },
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    });
    expect(editor.getJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [cell('tableHeader', 'タスク'), cell('tableHeader', '割当')],
            },
            {
              type: 'tableRow',
              content: [cell('tableCell', 'AGSでPT信号を取得する'), cell('tableCell', '6h')],
            },
          ],
        },
      ],
    });
    // The saved HTML loads back into the same table.
    const reloaded = new Editor({
      extensions: createContextNoteExtensions(),
      content: editor.getHTML(),
    });
    expect(reloaded.getJSON()).toEqual(editor.getJSON());
    reloaded.destroy();
    editor.destroy();
  });

  // What the API's note_markdown renders for
  // "前\n\n![損失の推移](attachment:<id>)\n\n後"
  // (apps/api tests/test_note_attachment_refs.py pins the same shape).
  const ID = '11111111-2222-4333-8444-555555555555';
  const AGENT_IMAGE_HTML =
    `<p>前</p>\n<img data-attachment-id="${ID}" alt="損失の推移">\n<p>後</p>\n`;
  const html = (content: string) => {
    const editor = new Editor({ extensions: createContextNoteExtensions(), content });
    const saved = editor.getHTML();
    editor.destroy();
    return saved;
  };

  it('loads an attached image and saves it without a URL', () => {
    const editor = new Editor({
      extensions: createContextNoteExtensions(),
      content: AGENT_IMAGE_HTML,
    });

    expect(editor.getJSON()).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '前' }] },
        { type: 'noteImage', attrs: { attachmentId: ID, alt: '損失の推移' } },
        { type: 'paragraph', content: [{ type: 'text', text: '後' }] },
      ],
    });
    expect(editor.getHTML()).toBe(
      `<p>前</p><img data-attachment-id="${ID}" alt="損失の推移"><p>後</p>`
    );
    editor.destroy();
  });

  it('escapes the caption in the saved HTML', () => {
    const saved = html(`<img data-attachment-id="${ID}" alt="a &quot;b&quot; &lt;c&gt; &amp; d">`);

    expect(saved).toBe(
      `<img data-attachment-id="${ID}" alt="a &quot;b&quot; <c> &amp; d">`
    );
    // Loading it again gives the same caption.
    expect(html(saved)).toBe(saved);
  });

  it('puts an image written inside a sentence on its own line', () => {
    expect(html(`<p>図 <img data-attachment-id="${ID}" alt="a"> を参照</p>`)).toBe(
      `<p>図</p><img data-attachment-id="${ID}" alt="a"><p> を参照</p>`
    );
  });

  it('keeps images in list items and table cells', () => {
    const image = `<img data-attachment-id="${ID}" alt="a">`;

    expect(html(`<ul><li><p>項目</p>${image}</li></ul>`)).toContain(`<p>項目</p>${image}</li>`);
    expect(html(`<table><tbody><tr><td>${image}</td></tr></tbody></table>`)).toContain(
      `<td>${image}</td>`
    );
  });

  it('writes the id in lower case', () => {
    expect(html(`<img data-attachment-id="${ID.toUpperCase()}" alt="">`)).toBe(
      `<img data-attachment-id="${ID}" alt="">`
    );
  });

  it('drops images that are not attachments', () => {
    expect(html('<p>a</p><img src="https://example.com/x.png" alt="外部"><p>b</p>')).toBe(
      '<p>a</p><p>b</p>'
    );
    expect(html('<p>a</p><img data-attachment-id="not-an-id" src="x"><p>b</p>')).toBe(
      '<p>a</p><p>b</p>'
    );
    // A URL next to the id is never kept or loaded.
    expect(html(`<img data-attachment-id="${ID}" src="https://example.com/x.png" alt="a">`)).toBe(
      `<img data-attachment-id="${ID}" alt="a">`
    );
  });
});
