// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/**
 * Shrinks an image in the browser before it is attached to a note.
 *
 * HumanCompiler keeps a light preview, not the original: at most 1600 px on
 * the long edge and 300 KB, as WebP. Shrinking here keeps the upload small;
 * the API checks the same limits again. Drawing to a canvas also drops the
 * image's metadata (EXIF and the like).
 */

/** The API's limits for an uploaded image (apps/api attachment_images.py). */
export const MAX_IMAGE_EDGE = 1600;
export const MAX_IMAGE_BYTES = 300 * 1024;

// Tried in order at full size; below the last one the image is scaled down.
const QUALITIES = [0.8, 0.7, 0.6, 0.5] as const;
const SHRINK = 0.85;
// Smaller than this, an image is no longer worth attaching.
const MIN_EDGE = 200;

export class NoteImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoteImageError';
  }
}

export interface PreparedImage {
  blob: Blob;
  width: number;
  height: number;
}

/** Encodes the image with its long edge at most `edge` px. */
export type EncodeImage = (edge: number, quality: number) => Promise<PreparedImage>;

/** True for a file the editor can attach. SVG is not: it can carry script. */
export function isAttachableImage(file: { type: string }): boolean {
  return file.type.startsWith('image/') && file.type !== 'image/svg+xml';
}

/**
 * The first encoding within the byte limit: quality 0.8 at up to 1600 px,
 * then lower quality, then smaller.
 */
export async function fitWithinLimits(encode: EncodeImage): Promise<PreparedImage> {
  let image: PreparedImage | undefined;
  for (const quality of QUALITIES) {
    image = await encode(MAX_IMAGE_EDGE, quality);
    if (image.blob.size <= MAX_IMAGE_BYTES) return image;
  }
  const quality = QUALITIES[QUALITIES.length - 1]!;
  while (image !== undefined) {
    const edge = Math.floor(Math.max(image.width, image.height) * SHRINK);
    if (edge < MIN_EDGE) break;
    image = await encode(edge, quality);
    if (image.blob.size <= MAX_IMAGE_BYTES) return image;
  }
  throw new NoteImageError('画像を300 KB以下に縮小できませんでした。');
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

async function decode(file: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      // Fall through: some browsers decode a format in <img> but not here.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const element = new Image();
    element.decoding = 'async';
    element.src = url;
    await element.decode();
    return {
      source: element,
      width: element.naturalWidth,
      height: element.naturalHeight,
      close: () => {},
    };
  } catch {
    throw new NoteImageError('このファイルは画像として読み込めませんでした。');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new NoteImageError('画像を変換できませんでした。')),
      type,
      quality
    );
  });
}

/**
 * The preview of `file` to upload: WebP, or JPEG where the browser cannot
 * write WebP (the API then stores it as WebP).
 */
export async function prepareNoteImage(file: Blob): Promise<PreparedImage> {
  if (!isAttachableImage(file)) {
    throw new NoteImageError('画像ファイル（PNG、JPEG、WebP など）を選んでください。');
  }
  const decoded = await decode(file);
  if (decoded.width < 1 || decoded.height < 1) {
    decoded.close();
    throw new NoteImageError('このファイルは画像として読み込めませんでした。');
  }
  const canvas = document.createElement('canvas');
  try {
    return await fitWithinLimits(async (edge, quality) => {
      const scale = Math.min(1, edge / Math.max(decoded.width, decoded.height));
      const width = Math.max(1, Math.round(decoded.width * scale));
      const height = Math.max(1, Math.round(decoded.height * scale));
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new NoteImageError('画像を変換できませんでした。');
      context.imageSmoothingQuality = 'high';
      context.clearRect(0, 0, width, height);
      context.drawImage(decoded.source, 0, 0, width, height);
      let blob = await toBlob(canvas, 'image/webp', quality);
      if (blob.type !== 'image/webp') {
        // This browser wrote its default format instead. JPEG has no
        // transparency, so put the image on white first.
        context.globalCompositeOperation = 'destination-over';
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, width, height);
        context.globalCompositeOperation = 'source-over';
        blob = await toBlob(canvas, 'image/jpeg', quality);
      }
      return { blob, width, height };
    });
  } finally {
    decoded.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}
