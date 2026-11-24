// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/**
 * Images in exported Markdown. A note refers to an image as
 * `![caption](attachment:<id>)`; the export carries no image bytes. With
 * `context --with-images <dir>` the images are saved next to the document and
 * the references point to the saved files.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { ApiError, CliError, fetchAttachmentUrl, isSecureOrLocal, networkReason } from './api'

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
// The caption may hold escaped brackets (\]).
const REFERENCE = new RegExp(String.raw`(!\[(?:[^\]\\]|\\.)*\]\()attachment:(${UUID})(\))`, 'g')

const TIMEOUT_MS = 30_000
// Stored previews are at most 300 KB; anything far larger is not one.
const MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024

/** The ids of the images a Markdown document refers to, each once, in order. */
export function attachmentIds(markdown: string): string[] {
  const ids = new Set<string>()
  for (const match of markdown.matchAll(REFERENCE)) ids.add(match[2]!.toLowerCase())
  return [...ids]
}

/** A Markdown link destination for a relative file path. */
function destination(file: string): string {
  const posix = file.split(path.sep).join('/')
  if (!/[\s()<>]/.test(posix)) return posix
  // In angle brackets a destination may hold spaces and parentheses.
  return `<${posix.replaceAll('<', '%3C').replaceAll('>', '%3E')}>`
}

/** Download a signed URL without the agent token: it is for another host. */
async function download(url: string): Promise<Uint8Array> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('the API gave an invalid download URL')
  }
  if (!isSecureOrLocal(parsed)) {
    throw new Error(`refusing to download from ${parsed.origin}: not https`)
  }
  let response: Response
  try {
    response = await fetch(parsed, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' })
  } catch (error) {
    throw new Error(`could not reach ${parsed.origin}: ${networkReason(error)}`)
  }
  if (!response.ok) throw new Error(`${parsed.origin} returned ${response.status}`)
  const declared = Number(response.headers.get('content-length'))
  if (declared > MAX_DOWNLOAD_BYTES) throw new Error('the file is too large to be a note image')
  const data = new Uint8Array(await response.arrayBuffer())
  if (data.length > MAX_DOWNLOAD_BYTES) throw new Error('the file is too large to be a note image')
  return data
}

export interface SavedImages {
  markdown: string
  /** Images the document refers to. */
  found: number
  saved: number
  /** One line per image that could not be saved; its reference is unchanged. */
  warnings: string[]
}

/**
 * Save the images `markdown` refers to into `dir` as `<id>.webp`, and point
 * their references to the files, relative to `relativeTo`.
 *
 * An image that cannot be saved (deleted, unreachable) keeps its
 * `attachment:` reference and gives a warning. A token that is rejected or
 * lacks the scope stops the command: every image would fail the same way.
 */
export async function saveImages(
  markdown: string,
  { apiUrl, token, dir, relativeTo }: { apiUrl: string; token: string; dir: string; relativeTo: string },
): Promise<SavedImages> {
  const ids = attachmentIds(markdown)
  const files = new Map<string, string>()
  const warnings: string[] = []
  if (ids.length > 0) {
    try {
      mkdirSync(dir, { recursive: true })
    } catch (error) {
      throw new CliError(`Could not create ${dir}: ${(error as Error).message}`)
    }
  }
  for (const id of ids) {
    try {
      const { url } = await fetchAttachmentUrl(apiUrl, token, id)
      if (typeof url !== 'string') throw new Error('the API did not answer with a download URL')
      const file = path.join(dir, `${id}.webp`)
      writeFileSync(file, await download(url))
      files.set(id, destination(path.relative(relativeTo, file)))
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) throw error
      // An API error already names the image.
      warnings.push(
        error instanceof ApiError
          ? `${error.message} Its reference is left as it is.`
          : `Image ${id} was not saved: ${(error as Error).message}`,
      )
    }
  }
  const rewritten = markdown.replace(REFERENCE, (whole, open: string, id: string, close: string) => {
    const file = files.get(id.toLowerCase())
    return file === undefined ? whole : `${open}${file}${close}`
  })
  return { markdown: rewritten, found: ids.length, saved: files.size, warnings }
}
