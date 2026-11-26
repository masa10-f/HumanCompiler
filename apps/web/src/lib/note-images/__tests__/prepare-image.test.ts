// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_EDGE,
  NoteImageError,
  fitWithinLimits,
  isAttachableImage,
  prepareNoteImage,
} from '../prepare-image';

/** An encoder for a 3000x2000 image whose size depends on edge and quality. */
function encoderOf(bytesAt: (edge: number, quality: number) => number) {
  return jest.fn(async (edge: number, quality: number) => {
    const longEdge = Math.min(edge, 3000);
    return {
      blob: { size: bytesAt(longEdge, quality) } as Blob,
      width: longEdge,
      height: Math.round((longEdge * 2) / 3),
    };
  });
}

describe('fitWithinLimits', () => {
  it('keeps full size and quality when that already fits', async () => {
    const encode = encoderOf(() => 60 * 1024);

    const image = await fitWithinLimits(encode);

    expect(encode).toHaveBeenCalledTimes(1);
    expect(encode).toHaveBeenCalledWith(MAX_IMAGE_EDGE, 0.8);
    expect(image.width).toBe(MAX_IMAGE_EDGE);
  });

  it('lowers the quality before it makes the image smaller', async () => {
    const encode = encoderOf((_edge, quality) => (quality > 0.65 ? 400 : 250) * 1024);

    const image = await fitWithinLimits(encode);

    expect(encode.mock.calls).toEqual([
      [MAX_IMAGE_EDGE, 0.8],
      [MAX_IMAGE_EDGE, 0.7],
      [MAX_IMAGE_EDGE, 0.6],
    ]);
    expect(image.width).toBe(MAX_IMAGE_EDGE);
  });

  it('shrinks until the image fits', async () => {
    // Bytes grow with the area; only edges under 1200 px fit.
    const encode = encoderOf((edge) => Math.round((edge / 1200) ** 2 * MAX_IMAGE_BYTES) + 1);

    const image = await fitWithinLimits(encode);

    expect(image.blob.size).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
    expect(image.width).toBeLessThan(1200);
    expect(image.width).toBeGreaterThan(900);
    // Every step below full size uses the lowest quality.
    expect(encode.mock.calls.slice(4).every(([, quality]) => quality === 0.5)).toBe(true);
  });

  it('gives up instead of uploading an unreadably small image', async () => {
    const encode = encoderOf(() => MAX_IMAGE_BYTES + 1);

    await expect(fitWithinLimits(encode)).rejects.toBeInstanceOf(NoteImageError);
    const smallest = Math.min(...encode.mock.calls.map(([edge]) => edge));
    expect(smallest).toBeGreaterThanOrEqual(200);
  });
});

describe('isAttachableImage', () => {
  it.each(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])('accepts %s', (type) => {
    expect(isAttachableImage({ type })).toBe(true);
  });

  it.each(['image/svg+xml', 'text/plain', 'application/pdf', ''])('refuses %s', (type) => {
    expect(isAttachableImage({ type })).toBe(false);
  });
});

describe('prepareNoteImage', () => {
  it('refuses an SVG before reading it', async () => {
    const svg = new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], {
      type: 'image/svg+xml',
    });

    await expect(prepareNoteImage(svg)).rejects.toBeInstanceOf(NoteImageError);
  });
});
