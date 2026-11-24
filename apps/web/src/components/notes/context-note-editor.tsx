'use client';

import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { notesApi } from '@/lib/api';
import { ApiError } from '@/lib/errors';
import {
  NoteImageError,
  isAttachableImage,
  prepareNoteImage,
} from '@/lib/note-images/prepare-image';
import type { NoteAttachmentTarget } from '@/types/context-note';
import { createContextNoteExtensions } from './context-note-extensions';
import { NoteImage, type NoteImageAttributes } from './note-image-extension';
import { requestCaptionFocus } from './note-image-view';
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  List,
  ListOrdered,
  CheckSquare,
  Quote,
  Heading1,
  Heading2,
  Heading3,
  Link as LinkIcon,
  Undo,
  Redo,
  Minus,
  Loader2,
  Table,
  BetweenHorizontalEnd,
  BetweenVerticalEnd,
  Rows3,
  Columns3,
  Trash2,
  ImagePlus,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ContextNoteEditorProps {
  content: string;
  onUpdate: (content: string) => void;
  onSave?: () => void;
  saving?: boolean;
  placeholder?: string;
  className?: string;
  readOnly?: boolean;
  variant?: 'full' | 'compact';
  /**
   * The project, goal or task this note is on. With it, images can be added
   * by pasting, dropping and the toolbar; without it (a note that cannot hold
   * attachments) images already in the content still show.
   */
  attachmentTarget?: NoteAttachmentTarget;
}

const IMAGE_FILE_TYPES = 'image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp';

function imageFilesOf(data: DataTransfer | null): File[] {
  return Array.from(data?.files ?? []).filter(isAttachableImage);
}

/**
 * Put an image in the note: at `position` (a drop), else at the selection.
 *
 * The editor is not focused here: the image's caption field takes the focus
 * when the node appears, and focusing the editor would take it back.
 */
function insertNoteImage(
  editor: Editor,
  attrs: NoteImageAttributes,
  position?: number
): void {
  const node = { type: NoteImage.name, attrs };
  if (position === undefined) {
    editor.commands.insertContent(node);
  } else {
    editor.commands.insertContentAt(position, node);
  }
  // The note has no trailing node: after an image that ends it, add a
  // paragraph to go on writing in.
  const { doc } = editor.state;
  if (doc.lastChild?.type.name === NoteImage.name) {
    editor.commands.insertContentAt(doc.content.size, { type: 'paragraph' });
  }
}

function uploadErrorMessage(error: unknown): string {
  if (error instanceof NoteImageError) return error.message;
  if (error instanceof ApiError) {
    if (error.statusCode === 413) return '画像が大きすぎます。';
    if (error.statusCode === 503) {
      return '画像の保存先に接続できませんでした。少し待ってからもう一度お試しください。';
    }
    return `画像を添付できませんでした: ${error.message}`;
  }
  return '画像を添付できませんでした。';
}

export function ContextNoteEditor({
  content,
  onUpdate,
  onSave,
  saving = false,
  placeholder = 'Write your notes here...',
  className,
  readOnly = false,
  variant = 'full',
  attachmentTarget,
}: ContextNoteEditorProps) {
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isCompact = variant === 'compact';
  const canAttach = !readOnly && attachmentTarget !== undefined;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // The editor is created once; its paste and drop handlers read the latest
  // attach function through this ref.
  const attachImagesRef = useRef<((files: File[], position?: number) => void) | null>(null);

  const editor = useEditor({
    extensions: createContextNoteExtensions(placeholder),
    content,
    editable: !readOnly,
    immediatelyRender: false,
    // The toolbar reads editor.isActive() during render.
    shouldRerenderOnTransaction: true,
    editorProps: {
      handlePaste: (_view, event) => {
        const attach = attachImagesRef.current;
        const files = imageFilesOf(event.clipboardData);
        // A copy from a spreadsheet or document carries a picture of the
        // selection next to its text: paste the text, as before.
        if (!attach || files.length === 0 || event.clipboardData?.getData('text/plain')) {
          return false;
        }
        event.preventDefault();
        attach(files);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        const attach = attachImagesRef.current;
        const files = imageFilesOf(event.dataTransfer);
        // `moved` is a drag inside the editor (an image node being moved).
        if (!attach || moved || files.length === 0) return false;
        event.preventDefault();
        const position = view.posAtCoords({ left: event.clientX, top: event.clientY });
        attach(files, position?.pos);
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      onUpdate(html);

      // Auto-save with debounce
      if (onSave && !readOnly) {
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
        }
        saveTimeoutRef.current = setTimeout(() => {
          onSave();
        }, 2000); // Auto-save after 2 seconds of inactivity
      }
    },
  });

  const attachImages = useCallback(
    async (files: File[], position?: number) => {
      if (!editor || !attachmentTarget) return;
      setUploadError(null);
      let insertAt = position;
      for (const file of files) {
        setUploading((count) => count + 1);
        try {
          const prepared = await prepareNoteImage(file);
          const attachment = await notesApi.uploadAttachment(attachmentTarget, prepared.blob, '');
          if (editor.isDestroyed) return;
          // The node goes in only now that the image is stored, so a save
          // never carries a reference to an upload that failed.
          requestCaptionFocus(attachment.id);
          insertNoteImage(
            editor,
            { attachmentId: attachment.id, alt: attachment.caption },
            insertAt
          );
          // The next image of the same paste or drop follows this one.
          insertAt = undefined;
        } catch (error) {
          setUploadError(uploadErrorMessage(error));
        } finally {
          setUploading((count) => count - 1);
        }
      }
    },
    [editor, attachmentTarget]
  );

  useEffect(() => {
    attachImagesRef.current = canAttach
      ? (files, position) => {
          void attachImages(files, position);
        }
      : null;
  }, [canAttach, attachImages]);

  // Update editor content when prop changes
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content, { emitUpdate: false });
    }
  }, [content, editor]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  const setLink = useCallback(() => {
    if (!editor) return;

    const previousUrl = editor.getAttributes('link').href;
    const url = window.prompt('URL', previousUrl);

    if (url === null) {
      return;
    }

    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }

    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }, [editor]);

  if (!editor) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className={cn('relative', className)}>
      {/* Toolbar */}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-1 border border-gray-200 bg-gray-50 p-2 dark:border-gray-700 dark:bg-gray-800 rounded-t-lg">
          {/* History */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().undo()}
            title="Undo"
          >
            <Undo className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().redo()}
            title="Redo"
          >
            <Redo className="h-4 w-4" />
          </Button>

          <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1" />

          {/* Headings */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            className={editor.isActive('heading', { level: 1 }) ? 'bg-gray-200 dark:bg-gray-700' : ''}
            title="Heading 1"
          >
            <Heading1 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            className={editor.isActive('heading', { level: 2 }) ? 'bg-gray-200 dark:bg-gray-700' : ''}
            title="Heading 2"
          >
            <Heading2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            className={editor.isActive('heading', { level: 3 }) ? 'bg-gray-200 dark:bg-gray-700' : ''}
            title="Heading 3"
          >
            <Heading3 className="h-4 w-4" />
          </Button>

          <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1" />

          {/* Text formatting */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={editor.isActive('bold') ? 'bg-gray-200 dark:bg-gray-700' : ''}
            title="Bold"
          >
            <Bold className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={editor.isActive('italic') ? 'bg-gray-200 dark:bg-gray-700' : ''}
            title="Italic"
          >
            <Italic className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleStrike().run()}
            className={editor.isActive('strike') ? 'bg-gray-200 dark:bg-gray-700' : ''}
            title="Strikethrough"
          >
            <Strikethrough className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleCode().run()}
            className={editor.isActive('code') ? 'bg-gray-200 dark:bg-gray-700' : ''}
            title="Inline Code"
          >
            <Code className="h-4 w-4" />
          </Button>

          <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1" />

          {/* Lists */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={editor.isActive('bulletList') ? 'bg-gray-200 dark:bg-gray-700' : ''}
            title="Bullet List"
          >
            <List className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            className={editor.isActive('orderedList') ? 'bg-gray-200 dark:bg-gray-700' : ''}
            title="Numbered List"
          >
            <ListOrdered className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleTaskList().run()}
            className={editor.isActive('taskList') ? 'bg-gray-200 dark:bg-gray-700' : ''}
            title="Task List"
          >
            <CheckSquare className="h-4 w-4" />
          </Button>

          <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1" />

          {/* Blocks */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            className={editor.isActive('blockquote') ? 'bg-gray-200 dark:bg-gray-700' : ''}
            title="Quote"
          >
            <Quote className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            className={editor.isActive('codeBlock') ? 'bg-gray-200 dark:bg-gray-700' : ''}
            title="Code Block"
          >
            <Code className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            title="Horizontal Rule"
          >
            <Minus className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
            }
            disabled={editor.isActive('table')}
            title="Insert Table"
          >
            <Table className="h-4 w-4" />
          </Button>

          {/* Table editing, shown while the cursor is in a table */}
          {editor.isActive('table') && (
            <>
              <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1" />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => editor.chain().focus().addRowAfter().run()}
                title="Add Row Below"
              >
                <BetweenHorizontalEnd className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => editor.chain().focus().addColumnAfter().run()}
                title="Add Column Right"
              >
                <BetweenVerticalEnd className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => editor.chain().focus().deleteRow().run()}
                title="Delete Row"
              >
                <Rows3 className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => editor.chain().focus().deleteColumn().run()}
                title="Delete Column"
              >
                <Columns3 className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => editor.chain().focus().deleteTable().run()}
                title="Delete Table"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          )}

          <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1" />

          {/* Link */}
          <Button
            variant="ghost"
            size="sm"
            onClick={setLink}
            className={editor.isActive('link') ? 'bg-gray-200 dark:bg-gray-700' : ''}
            title="Link"
          >
            <LinkIcon className="h-4 w-4" />
          </Button>

          {/* Image */}
          {canAttach && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                title="Insert Image"
              >
                <ImagePlus className="h-4 w-4" />
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept={IMAGE_FILE_TYPES}
                multiple
                hidden
                aria-label="Insert Image"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  // Lets the same file be chosen again.
                  event.target.value = '';
                  if (files.length > 0) void attachImages(files);
                }}
              />
            </>
          )}

          {/* Save indicator */}
          <div className="flex-1" />
          {uploading > 0 && (
            <div
              className="flex items-center text-sm text-gray-500 dark:text-gray-400"
              role="status"
            >
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
              画像を添付しています…
            </div>
          )}
          {saving && (
            <div className="flex items-center text-sm text-gray-500 dark:text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
              Saving...
            </div>
          )}
        </div>
      )}

      {uploadError && (
        <div
          role="alert"
          className="flex items-start justify-between gap-2 border-x border-gray-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-gray-700 dark:bg-red-950 dark:text-red-200"
        >
          <span>{uploadError}</span>
          <button
            type="button"
            onClick={() => setUploadError(null)}
            aria-label="閉じる"
            className="shrink-0 rounded p-0.5 hover:bg-red-100 dark:hover:bg-red-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Editor Content */}
      <EditorContent
        editor={editor}
        className={cn(
          'context-note-content context-note-editor max-w-none',
          isCompact ? 'min-h-[180px] p-3' : 'min-h-[300px] p-4',
          'border border-gray-200 dark:border-gray-700',
          !readOnly && 'border-t-0',
          !readOnly && 'rounded-b-lg',
          readOnly && 'rounded-lg',
          'bg-white dark:bg-gray-900',
          'focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent',
          '[&_.ProseMirror]:outline-none',
          isCompact ? '[&_.ProseMirror]:min-h-[150px]' : '[&_.ProseMirror]:min-h-[260px]',
          // Placeholder styles
          '[&_.is-editor-empty:first-child::before]:text-gray-400',
          '[&_.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]',
          '[&_.is-editor-empty:first-child::before]:float-left',
          '[&_.is-editor-empty:first-child::before]:h-0',
          '[&_.is-editor-empty:first-child::before]:pointer-events-none'
        )}
      />

      {/* Bubble Menu for quick formatting */}
      {editor && !readOnly && (
        <BubbleMenu
          editor={editor}
          className="flex items-center gap-1 p-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700"
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={editor.isActive('bold') ? 'bg-gray-200 dark:bg-gray-700' : ''}
          >
            <Bold className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={editor.isActive('italic') ? 'bg-gray-200 dark:bg-gray-700' : ''}
          >
            <Italic className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={setLink}
            className={editor.isActive('link') ? 'bg-gray-200 dark:bg-gray-700' : ''}
          >
            <LinkIcon className="h-3 w-3" />
          </Button>
        </BubbleMenu>
      )}
    </div>
  );
}
