// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { ImageOff, Loader2, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { ResolvedAttachment } from '@/lib/note-images/attachment-urls';
import { noteAttachmentUrls } from '@/lib/note-images/note-attachment-urls';

/** The long edge of the thumbnail the API stores (attachment_images.py). */
const THUMB_EDGE = 480;
const CAPTION_MAX_LENGTH = 500;

type ImageState =
  | { status: 'loading' }
  | { status: 'ready'; image: ResolvedAttachment }
  /** Deleted, or not this user's. */
  | { status: 'missing' }
  | { status: 'error' };

// Attachments whose caption field takes the focus when their node appears:
// the editor asks for it right after inserting an uploaded image.
const captionFocusRequests = new Set<string>();

export function requestCaptionFocus(attachmentId: string): void {
  captionFocusRequests.add(attachmentId);
}

function thumbnailSize(image: ResolvedAttachment): { width: number; height: number } {
  const scale = Math.min(1, THUMB_EDGE / Math.max(image.width, image.height, 1));
  return {
    width: Math.max(1, Math.round(image.width * scale)),
    height: Math.max(1, Math.round(image.height * scale)),
  };
}

/**
 * An attached image in a note: the thumbnail, loaded when it scrolls into
 * view, which opens the full preview when clicked. While the note is being
 * edited the caption is a text field under it.
 */
export function NoteImageView({
  node,
  editor,
  selected,
  updateAttributes,
  deleteNode,
  getPos,
}: NodeViewProps) {
  const attachmentId = node.attrs.attachmentId as string | null;
  const caption = (node.attrs.alt as string | null) ?? '';
  const editable = editor.isEditable;

  const [state, setState] = useState<ImageState>({ status: 'loading' });
  const [open, setOpen] = useState(false);
  // One retry with a new URL per failed load, so a deleted file cannot loop.
  const retried = useRef(false);
  const captionInput = useRef<HTMLInputElement>(null);

  const load = useCallback(
    async (fresh: boolean): Promise<ImageState> => {
      if (!attachmentId) return { status: 'missing' };
      try {
        const image = await noteAttachmentUrls.resolve(attachmentId, { fresh });
        return image ? { status: 'ready', image } : { status: 'missing' };
      } catch {
        return { status: 'error' };
      }
    },
    [attachmentId]
  );

  useEffect(() => {
    let current = true;
    retried.current = false;
    setState({ status: 'loading' });
    void load(false).then((next) => {
      if (current) setState(next);
    });
    return () => {
      current = false;
    };
  }, [load]);

  useEffect(() => {
    if (editable && attachmentId && captionFocusRequests.delete(attachmentId)) {
      captionInput.current?.focus();
    }
  }, [editable, attachmentId]);

  // A signed URL lasts a few minutes: an image that scrolls into view later,
  // or is opened later, may need a new one.
  const refresh = useCallback(async () => {
    if (retried.current) {
      setState({ status: 'error' });
      return;
    }
    retried.current = true;
    setState(await load(true));
  }, [load]);

  const openPreview = useCallback(async () => {
    const next = await load(false);
    setState(next);
    if (next.status === 'ready') setOpen(true);
  }, [load]);

  // Enter in the caption goes on writing below the image.
  const leaveCaption = useCallback(() => {
    const position = getPos();
    if (typeof position !== 'number') {
      editor.commands.focus();
      return;
    }
    const after = position + node.nodeSize;
    if (after >= editor.state.doc.content.size) {
      // The image ends the note: there is no line below it yet.
      editor.chain().insertContentAt(after, { type: 'paragraph' }).focus(after + 1).run();
    } else {
      editor.chain().focus(after).run();
    }
  }, [editor, getPos, node.nodeSize]);

  return (
    <NodeViewWrapper
      as="figure"
      className={cn(
        'note-image group/note-image relative my-4 w-fit max-w-full',
        editable && selected && 'rounded-md outline outline-2 outline-offset-2 outline-blue-500'
      )}
      data-attachment-id={attachmentId ?? undefined}
    >
      {state.status === 'ready' ? (
        <button
          type="button"
          className="block max-w-full cursor-zoom-in rounded-md border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800"
          onClick={() => {
            void openPreview();
          }}
          title="クリックで拡大"
          data-drag-handle
        >
          {/* A private image behind a signed URL: next/image cannot optimise it. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={state.image.thumbUrl}
            alt={caption}
            {...thumbnailSize(state.image)}
            loading="lazy"
            decoding="async"
            draggable={false}
            className="block h-auto max-w-full rounded-md"
            onError={() => {
              void refresh();
            }}
          />
        </button>
      ) : (
        <div
          className="flex h-32 w-64 max-w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-gray-300 bg-gray-50 px-3 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
          role={state.status === 'loading' ? 'status' : undefined}
          data-drag-handle
        >
          {state.status === 'loading' ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="sr-only">画像を読み込んでいます</span>
            </>
          ) : (
            <>
              <ImageOff className="h-5 w-5" />
              <span>
                {state.status === 'missing'
                  ? '画像を表示できません（削除されたか、閲覧できない画像です）'
                  : '画像を読み込めませんでした'}
              </span>
              {state.status === 'error' && (
                <button
                  type="button"
                  className="text-blue-600 underline underline-offset-2 dark:text-blue-400"
                  onClick={() => {
                    retried.current = false;
                    setState({ status: 'loading' });
                    void load(true).then(setState);
                  }}
                >
                  再読み込み
                </button>
              )}
            </>
          )}
        </div>
      )}

      {editable ? (
        <>
          <input
            ref={captionInput}
            type="text"
            value={caption}
            maxLength={CAPTION_MAX_LENGTH}
            placeholder="キャプション（この画像が示す内容）"
            aria-label="画像のキャプション"
            className="mt-2 block w-full min-w-48 rounded-md border border-gray-200 bg-white px-2 py-1 text-sm text-gray-700 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
            onChange={(event) => updateAttributes({ alt: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault();
                leaveCaption();
              }
            }}
          />
          {caption.trim() === '' && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
              キャプションがないと、検索やエージェントにはこの画像の内容が伝わりません。
            </p>
          )}
          <button
            type="button"
            className="absolute right-1 top-1 rounded-md border border-gray-200 bg-white/90 p-1 text-gray-600 opacity-0 shadow-sm transition-opacity hover:text-red-600 focus:opacity-100 group-hover/note-image:opacity-100 dark:border-gray-700 dark:bg-gray-900/90 dark:text-gray-300"
            onClick={() => deleteNode()}
            title="画像をノートから外す"
            aria-label="画像をノートから外す"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </>
      ) : (
        caption && (
          <figcaption className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {caption}
          </figcaption>
        )
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-w-none"
          // As wide as the image needs, within the window.
          style={
            state.status === 'ready'
              ? { width: `min(96vw, ${Math.max(state.image.width, 320) + 48}px)` }
              : undefined
          }
        >
          <DialogTitle className="pr-8 text-base font-medium">
            {caption || '画像'}
          </DialogTitle>
          <DialogDescription className="sr-only">
            ノートに添付した画像の拡大表示
          </DialogDescription>
          {state.status === 'ready' && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={state.image.url}
              alt={caption}
              width={state.image.width}
              height={state.image.height}
              className="mx-auto h-auto max-h-[80dvh] w-auto max-w-full"
              onError={() => {
                void refresh();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </NodeViewWrapper>
  );
}
