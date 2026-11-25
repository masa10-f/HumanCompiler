// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

'use client';

import { Node, ReactNodeViewRenderer } from '@tiptap/react';
import { NoteImageView } from './note-image-view';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The attachment id an element refers to, or null if it is not one. */
export function attachmentIdOf(element: HTMLElement): string | null {
  const id = element.getAttribute('data-attachment-id');
  return id !== null && UUID.test(id) ? id.toLowerCase() : null;
}

export interface NoteImageAttributes {
  attachmentId: string;
  /** The caption: what the image shows, for readers who cannot see it. */
  alt: string;
}

/**
 * An image attached to the note.
 *
 * Saved as `<img data-attachment-id="<uuid>" alt="caption">`, the markup the
 * API writes for an agent's `![caption](attachment:<uuid>)`. There is no
 * `src`: the image is private, and the node view asks the API for a signed
 * URL when it shows it. An `<img>` without an attachment id (an image from
 * another site) is not this node and is dropped, as before.
 */
export const NoteImage = Node.create({
  name: 'noteImage',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      attachmentId: {
        default: null,
        parseHTML: (element: HTMLElement) => attachmentIdOf(element),
        renderHTML: (attributes: Partial<NoteImageAttributes>) => ({
          'data-attachment-id': attributes.attachmentId,
        }),
      },
      alt: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('alt') ?? '',
        renderHTML: (attributes: Partial<NoteImageAttributes>) => ({
          alt: attributes.alt ?? '',
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'img[data-attachment-id]',
        getAttrs: (element: HTMLElement) => (attachmentIdOf(element) === null ? false : null),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['img', HTMLAttributes];
  },

  addNodeView() {
    return ReactNodeViewRenderer(NoteImageView);
  },
});
