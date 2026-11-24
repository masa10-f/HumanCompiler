// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/**
 * Turns an image file into the light preview HumanCompiler stores: WebP, at
 * most 1600 px on the long edge and 300 KB, without metadata. The original
 * stays where it is; only the preview is uploaded.
 */

import { CliError } from './api'

/** The API's limits for an uploaded image. */
export const MAX_EDGE = 1600
export const MAX_BYTES = 300 * 1024

// Tried in order at full size; below the last one the image is scaled down.
const QUALITIES = [80, 70, 60, 50] as const
const SHRINK = 0.85
// Smaller than this, a figure is no longer worth attaching.
const MIN_EDGE = 200

export interface Preview {
  data: Buffer
  width: number
  height: number
  quality: number
}

type Sharp = (typeof import('sharp'))['default']

/** Loaded on demand: only `attach` needs the native image library. */
async function loadSharp(): Promise<Sharp> {
  try {
    const module = await import('sharp')
    return module.default
  } catch (error) {
    throw new CliError(
      `Could not load the image library (sharp): ${(error as Error).message}\n` +
        'It has no prebuilt binary for this platform, or the install skipped it. ' +
        'Reinstall with npm install humancompiler, without --omit=optional.',
    )
  }
}

async function encode(
  sharp: Sharp,
  input: Uint8Array,
  edge: number,
  quality: number,
): Promise<Preview> {
  const { data, info } = await sharp(input)
    // Applies the EXIF orientation, which is dropped with the rest of the metadata.
    .autoOrient()
    .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
    .webp({ quality })
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height, quality }
}

/**
 * The preview of an image: quality 80 at up to 1600 px, then lower quality,
 * then smaller, until it is within 300 KB. An animation gives its first frame.
 */
export async function makePreview(input: Uint8Array): Promise<Preview> {
  const sharp = await loadSharp()
  let preview: Preview | undefined
  try {
    for (const quality of QUALITIES) {
      preview = await encode(sharp, input, MAX_EDGE, quality)
      if (preview.data.length <= MAX_BYTES) return preview
    }
    const quality = QUALITIES[QUALITIES.length - 1]!
    while (preview !== undefined) {
      const edge = Math.floor(Math.max(preview.width, preview.height) * SHRINK)
      if (edge < MIN_EDGE) break
      preview = await encode(sharp, input, edge, quality)
      if (preview.data.length <= MAX_BYTES) return preview
    }
  } catch (error) {
    throw new CliError(`Could not read the file as an image: ${(error as Error).message}`)
  }
  throw new CliError(
    `Could not make a preview under ${MAX_BYTES / 1024} KB even at ${MIN_EDGE} px.`,
  )
}
