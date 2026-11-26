// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/**
 * `humancompiler attach`: puts an image made on this machine (a plot, a
 * screenshot) on the note of a project, goal or task.
 *
 * The image is shrunk and converted here, and only that preview is uploaded.
 * HumanCompiler keeps no original: the upload carries where the original is
 * (path, script, machine, SHA-256) so it can be found again.
 *
 * Standard output is the Markdown reference alone, so an agent can capture
 * it; everything else goes to standard error.
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { hostname } from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import {
  API_URL_ENV,
  type AttachmentSource,
  COMMAND_SCOPES,
  CliError,
  DEFAULT_API_URL,
  type NoteKind,
  OPTION_SCOPES,
  TOKEN_ENV,
  appendToNote,
  requireToken,
  resolveApiUrl,
  uploadAttachment,
} from '../api'
import { usageError } from '../args'
import { MAX_BYTES, MAX_EDGE, makePreview } from '../preview'

const CAPTION_MAX = 500
const SOURCE_TEXT_MAX = 1000
const HOST_MAX = 255

export const ATTACH_HELP = `Usage: humancompiler attach <project|goal|task> <id> <file> --caption "..." [options]

Attaches an image to the note of a project, goal or task. The image is shrunk
and converted on this machine (WebP, at most ${MAX_EDGE} px on the long edge and
${MAX_BYTES / 1024} KB) and only that preview is uploaded. The original stays where it
is; its path, this machine's name and its SHA-256 are recorded with the
preview so it can be found again.

Prints the Markdown reference of the image, ![caption](attachment:<id>). The
image shows once the reference is in one of the item's two notes, its
overview or its log: pass --append to add it to the log, or put the reference
where you want it yourself (for example with the MCP tools append_note and
replace_note).

Needs the ${TOKEN_ENV} environment variable (an agent token with
${COMMAND_SCOPES.attach.join(', ')}; ${OPTION_SCOPES.attach.option} also needs ${OPTION_SCOPES.attach.scopes.join(', ')}).

Options:
  --caption <text>     What the image shows (required, up to ${CAPTION_MAX} characters).
                       Readers that cannot see images get only this.
  --source <script>    The script or command that made the image.
  --append             Also add the reference to the end of the item's log.
  --api-url <url>      API base URL (default: $${API_URL_ENV} or
                       ${DEFAULT_API_URL}).
  -h, --help           Show this help.
`

const KINDS: readonly NoteKind[] = ['project', 'goal', 'task']

const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`

export async function attach(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      caption: { type: 'string' },
      source: { type: 'string' },
      append: { type: 'boolean', default: false },
      'api-url': { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })
  if (values.help) {
    process.stdout.write(ATTACH_HELP)
    return
  }

  const [kind, id, file, ...rest] = positionals
  if (kind === undefined || id === undefined || file === undefined || rest.length > 0) {
    throw usageError('Give project, goal or task, an id, and an image file.', ATTACH_HELP)
  }
  if (!KINDS.includes(kind as NoteKind)) {
    throw usageError(`The first argument must be project, goal or task, not ${kind}.`, ATTACH_HELP)
  }
  const caption = values.caption?.trim() ?? ''
  if (caption === '') {
    throw usageError('--caption is required: say what the image shows.', ATTACH_HELP)
  }
  if (caption.length > CAPTION_MAX) {
    throw usageError(`--caption must be at most ${CAPTION_MAX} characters.`, ATTACH_HELP)
  }
  const script = values.source?.trim() || undefined
  if (script !== undefined && script.length > SOURCE_TEXT_MAX) {
    throw usageError(`--source must be at most ${SOURCE_TEXT_MAX} characters.`, ATTACH_HELP)
  }

  const token = requireToken()
  const apiUrl = resolveApiUrl(values['api-url'])

  let original: Buffer
  try {
    original = readFileSync(file)
  } catch (error) {
    throw new CliError(`Could not read ${file}: ${(error as Error).message}`)
  }
  const preview = await makePreview(original)

  const absolute = path.resolve(file)
  const source: AttachmentSource = {
    // A path too long for the API is left out rather than cut short.
    ...(absolute.length <= SOURCE_TEXT_MAX ? { path: absolute } : {}),
    ...(script === undefined ? {} : { script }),
    host: hostname().slice(0, HOST_MAX),
    sha256: createHash('sha256').update(original).digest('hex'),
  }

  const attachment = await uploadAttachment(apiUrl, token, kind as NoteKind, id, {
    preview: preview.data,
    caption,
    source,
  })
  if (typeof attachment?.markdown !== 'string' || typeof attachment.id !== 'string') {
    throw new CliError(`${apiUrl} did not answer with an attachment. Check the API URL.`)
  }

  process.stderr.write(
    `${attachment.reused ? 'Already attached to this note; reused image' : 'Attached image'} ${attachment.id}: ` +
      `${kb(original.length)} original -> ${kb(preview.data.length)} preview, ` +
      `${preview.width}x${preview.height} px, WebP quality ${preview.quality}.\n`,
  )
  process.stdout.write(`${attachment.markdown}\n`)

  if (!values.append) {
    process.stderr.write(`Put the reference above in the ${kind}'s note to show the image there.\n`)
    return
  }
  try {
    await appendToNote(apiUrl, token, kind as NoteKind, id, attachment.markdown)
  } catch (error) {
    if (!(error instanceof CliError)) throw error
    throw new CliError(
      `The image is attached, but adding it to the note failed: ${error.message}\n` +
        `Put the reference printed above in the ${kind}'s note by hand.`,
    )
  }
  process.stderr.write(`Appended the reference to the ${kind}'s note.\n`)
}
