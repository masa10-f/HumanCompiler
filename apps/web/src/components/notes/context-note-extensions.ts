'use client';

import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { TableKit } from '@tiptap/extension-table';
import { common, createLowlight } from 'lowlight';

const lowlight = createLowlight(common);

export function createContextNoteExtensions(placeholder?: string) {
  return [
    StarterKit.configure({
      codeBlock: false,
      // Tiptap v3 bundles these into StarterKit; Link is configured below and
      // the others are kept off to preserve the v2 schema and behavior.
      link: false,
      underline: false,
      trailingNode: false,
      heading: {
        levels: [1, 2, 3],
      },
    }),
    Placeholder.configure({
      placeholder,
    }),
    Link.configure({
      openOnClick: true,
      HTMLAttributes: {
        class: 'text-blue-600 dark:text-blue-400 underline underline-offset-2 cursor-pointer break-words',
      },
    }),
    TaskList,
    TaskItem.configure({
      nested: true,
    }),
    CodeBlockLowlight.configure({
      lowlight,
    }),
    // Agents write GitHub-style pipe tables, which the API renders as <table>.
    // Without a table node the editor would drop the markup and keep the text.
    TableKit.configure({
      table: {
        resizable: false,
        // Wraps the table in div.tableWrapper so a wide table scrolls sideways.
        renderWrapper: true,
      },
    }),
  ];
}
