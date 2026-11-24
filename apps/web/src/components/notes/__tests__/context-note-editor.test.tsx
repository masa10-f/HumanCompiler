// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { notesApi } from '@/lib/api';
import { ApiError } from '@/lib/errors';
import { prepareNoteImage } from '@/lib/note-images/prepare-image';
import { ContextNoteEditor } from '../context-note-editor';
import { ContextNoteViewer } from '../context-note-viewer';

jest.mock('@/lib/api', () => ({
  notesApi: { uploadAttachment: jest.fn(), getAttachmentUrls: jest.fn() },
}));
// jsdom has no canvas: the shrinking itself is tested in prepare-image.test.ts.
jest.mock('@/lib/note-images/prepare-image', () => ({
  ...jest.requireActual('@/lib/note-images/prepare-image'),
  prepareNoteImage: jest.fn(),
}));

const mockUpload = notesApi.uploadAttachment as jest.Mock;
const mockUrls = notesApi.getAttachmentUrls as jest.Mock;
const mockPrepare = prepareNoteImage as jest.Mock;

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

describe('images in notes', () => {
  const TARGET = { type: 'goal' as const, id: 'goal-1' };
  const PREPARED = { blob: new Blob(['webp'], { type: 'image/webp' }), width: 1600, height: 1000 };
  const urlsOf = (ids: string[]) => ({
    items: ids.map((id) => ({
      id,
      url: `https://storage.test/${id}/preview.webp`,
      thumb_url: `https://storage.test/${id}/thumb.webp`,
      width: 1600,
      height: 1000,
      caption: '',
    })),
    expires_at: new Date(Date.now() + 600_000).toISOString(),
  });
  let nextId = 0;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrepare.mockResolvedValue(PREPARED);
    mockUrls.mockImplementation(async (ids: string[]) => urlsOf(ids));
    mockUpload.mockImplementation(async () => {
      nextId += 1;
      return {
        id: `00000000-0000-4000-8000-${nextId.toString().padStart(12, '0')}`,
        caption: '',
        reused: false,
      };
    });
  });

  const png = (name = 'image.png') => new File(['png bytes'], name, { type: 'image/png' });
  const clipboard = (files: File[], text = '') => ({
    clipboardData: { files, getData: (type: string) => (type === 'text/plain' ? text : '') },
  });

  async function renderEditor(props: Partial<React.ComponentProps<typeof ContextNoteEditor>> = {}) {
    const onUpdate = jest.fn();
    const view = render(
      <ContextNoteEditor content="<p>前</p>" onUpdate={onUpdate} attachmentTarget={TARGET} {...props} />
    );
    await screen.findByText('前');
    const editor = view.container.querySelector('.ProseMirror') as HTMLElement;
    return { onUpdate, editor, ...view };
  }

  const lastHtml = (onUpdate: jest.Mock): string => onUpdate.mock.calls.at(-1)?.[0] ?? '';

  it('uploads a pasted image and puts its id in the note', async () => {
    const { onUpdate, editor } = await renderEditor();
    const file = png();

    fireEvent.paste(editor, clipboard([file]));

    const caption = await screen.findByLabelText('画像のキャプション');
    expect(mockPrepare).toHaveBeenCalledWith(file);
    expect(mockUpload).toHaveBeenCalledWith(TARGET, PREPARED.blob, '');
    const id = (await mockUpload.mock.results[0]!.value).id;
    // The note holds the id and the caption, never a URL.
    expect(lastHtml(onUpdate)).toContain(`<img data-attachment-id="${id}" alt="">`);
    expect(lastHtml(onUpdate)).not.toContain('storage.test');
    // The caption field is ready to type in.
    await waitFor(() => expect(caption).toHaveFocus());

    fireEvent.change(caption, { target: { value: '損失の推移' } });
    expect(lastHtml(onUpdate)).toContain(`<img data-attachment-id="${id}" alt="損失の推移">`);

    const image = await screen.findByAltText('損失の推移');
    expect(image).toHaveAttribute('src', `https://storage.test/${id}/thumb.webp`);
    expect(image).toHaveAttribute('loading', 'lazy');
  });

  it('leaves a line to go on writing in after an image that ends the note', async () => {
    const onUpdate = jest.fn();
    const view = render(
      <ContextNoteEditor content="" onUpdate={onUpdate} attachmentTarget={TARGET} />
    );
    const editor = await waitFor(() => {
      const element = view.container.querySelector('.ProseMirror');
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });

    fireEvent.paste(editor, clipboard([png()]));

    await screen.findByLabelText('画像のキャプション');
    expect(lastHtml(onUpdate)).toMatch(/^<img [^>]*><p><\/p>$/);
  });

  it('adds images chosen with the toolbar button', async () => {
    const { onUpdate } = await renderEditor();
    const input = screen.getByLabelText('Insert Image') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [png('a.png'), png('b.png')] } });

    await waitFor(() => expect(screen.getAllByLabelText('画像のキャプション')).toHaveLength(2));
    expect(mockUpload).toHaveBeenCalledTimes(2);
    const ids = [...lastHtml(onUpdate).matchAll(/data-attachment-id="([^"]+)"/g)].map((m) => m[1]);
    // In the order they were chosen.
    expect(ids).toEqual([...ids].sort());
  });

  it('pastes the text of a copy that also carries a picture', async () => {
    const { editor } = await renderEditor();

    fireEvent.paste(editor, clipboard([png()], 'cell text'));
    await act(async () => {});

    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('ignores files that are not images', async () => {
    const { editor } = await renderEditor();
    const svg = new File(['<svg/>'], 'a.svg', { type: 'image/svg+xml' });
    const text = new File(['a'], 'a.txt', { type: 'text/plain' });

    fireEvent.paste(editor, clipboard([svg, text]));
    await act(async () => {});

    expect(mockPrepare).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('cannot add images without a target, and offers no button', async () => {
    const { editor } = await renderEditor({ attachmentTarget: undefined });

    fireEvent.paste(editor, clipboard([png()]));
    await act(async () => {});

    expect(screen.queryByTitle('Insert Image')).not.toBeInTheDocument();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('still shows the images of a note it cannot add images to', async () => {
    const id = '11111111-2222-4333-8444-555555555555';
    const onUpdate = jest.fn();
    render(
      <ContextNoteEditor
        content={`<p>前</p><img data-attachment-id="${id}" alt="図1">`}
        onUpdate={onUpdate}
      />
    );

    const image = await screen.findByAltText('図1');
    expect(image).toHaveAttribute('src', `https://storage.test/${id}/thumb.webp`);
  });

  it('says why an upload failed and leaves the note as it was', async () => {
    mockUpload.mockRejectedValueOnce(
      new ApiError(422, 'The storage for attached images is full (200 MB).')
    );
    const { onUpdate, editor } = await renderEditor();

    fireEvent.paste(editor, clipboard([png()]));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The storage for attached images is full (200 MB).');
    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('画像のキャプション')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('閉じる'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows an image and its caption when the note is read', async () => {
    const id = '11111111-2222-4333-8444-555555555555';
    render(<ContextNoteViewer content={`<img data-attachment-id="${id}" alt="損失の推移">`} />);

    const image = await screen.findByAltText('損失の推移');
    expect(image).toHaveAttribute('src', `https://storage.test/${id}/thumb.webp`);
    expect(image).toHaveAttribute('width', '480');
    expect(image).toHaveAttribute('height', '300');
    expect(screen.getByText('損失の推移')).toBeInTheDocument();
    expect(screen.queryByLabelText('画像のキャプション')).not.toBeInTheDocument();

    // Clicking opens the full preview.
    fireEvent.click(screen.getByTitle('クリックで拡大'));
    const dialog = await screen.findByRole('dialog');
    const full = dialog.querySelector('img');
    expect(full).toHaveAttribute('src', `https://storage.test/${id}/preview.webp`);
  });

  it('says so when an image is gone or is not the reader\'s', async () => {
    mockUrls.mockResolvedValue({ items: [], expires_at: new Date().toISOString() });
    const id = '22222222-2222-4333-8444-555555555555';
    render(<ContextNoteViewer content={`<img data-attachment-id="${id}" alt="消えた図">`} />);

    expect(await screen.findByText(/画像を表示できません/)).toBeInTheDocument();
    // The caption still says what was there.
    expect(screen.getByText('消えた図')).toBeInTheDocument();
  });

  it('asks for a new URL once when the image fails to load', async () => {
    const id = '33333333-2222-4333-8444-555555555555';
    render(<ContextNoteViewer content={`<img data-attachment-id="${id}" alt="図">`} />);
    const image = await screen.findByAltText('図');
    expect(mockUrls).toHaveBeenCalledTimes(1);

    fireEvent.error(image);
    await waitFor(() => expect(mockUrls).toHaveBeenCalledTimes(2));

    // A second failure is not retried: the file itself is the problem.
    fireEvent.error(await screen.findByAltText('図'));
    expect(await screen.findByText('画像を読み込めませんでした')).toBeInTheDocument();
    expect(mockUrls).toHaveBeenCalledTimes(2);
  });
});
