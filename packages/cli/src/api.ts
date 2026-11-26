// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/**
 * The HumanCompiler agent API client every subcommand shares: where the API
 * is, where the token comes from, and how a failed request is reported.
 */

import type { ProjectTimelineData } from '@/lib/timeline/types'

export const DEFAULT_API_URL = 'https://humancompiler-api-masa.fly.dev'
export const TOKEN_ENV = 'HUMANCOMPILER_TOKEN'
export const API_URL_ENV = 'HUMANCOMPILER_API_URL'
const AGENT_PATH = '/api/agent/v1'
const TIMEOUT_MS = 30_000

export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message)
    this.name = 'CliError'
  }
}

/** https, or http to this machine (local development). */
export function isSecureOrLocal(url: URL): boolean {
  if (url.protocol === 'https:') return true
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
}

/** Only https, except to this machine (local development). */
export function validateApiUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new CliError(`Invalid API URL: ${raw}`)
  }
  if (!isSecureOrLocal(url)) {
    throw new CliError(
      `Refusing to send the agent token to ${url.origin}: use https (http only to localhost)`,
    )
  }
  return url.origin + url.pathname.replace(/\/+$/, '')
}

/** `--api-url`, else $HUMANCOMPILER_API_URL, else the hosted API. Validated. */
export function resolveApiUrl(option?: string): string {
  return validateApiUrl(option || process.env[API_URL_ENV] || DEFAULT_API_URL)
}

/** The agent token, from the environment only (never a command-line argument). */
export function readToken(): string | undefined {
  return process.env[TOKEN_ENV]?.trim() || undefined
}

export function requireToken(): string {
  const token = readToken()
  if (!token) {
    throw new CliError(`Set ${TOKEN_ENV} to an agent token (see Settings > Agent tokens).`)
  }
  return token
}

/** FastAPI's `detail`, a string or a list of validation errors. */
async function detailOf(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown } | null
    const detail = body?.detail
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail)) {
      const messages = detail
        .map((item: { loc?: unknown[]; msg?: unknown }) => {
          if (typeof item?.msg !== 'string') return undefined
          const field = Array.isArray(item.loc) ? item.loc.at(-1) : undefined
          return field === undefined ? item.msg : `${String(field)}: ${item.msg}`
        })
        .filter(Boolean)
      if (messages.length > 0) return messages.join('; ')
    }
    // An error page from a proxy may be JSON without a detail.
    return detail === undefined ? response.statusText : JSON.stringify(detail)
  } catch {
    return response.statusText
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST'
  /** A JSON string (give `contentType`) or a form, which sets its own type. */
  body?: string | FormData
  contentType?: string
}

/**
 * A request without following redirects, so the token never goes to another
 * host. Network failures become a CliError; HTTP errors are left to the caller.
 */
export async function request(
  apiUrl: string,
  path: string,
  token?: string,
  { method = 'GET', body, contentType }: RequestOptions = {},
): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (contentType) headers['Content-Type'] = contentType
  try {
    return await fetch(`${apiUrl}${path}`, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'error',
    })
  } catch (error) {
    throw new CliError(`Could not reach ${apiUrl}: ${networkReason(error)}`)
  }
}

/** fetch() says only "fetch failed"; the cause names the real problem. */
export function networkReason(error: unknown): string {
  const cause = error instanceof Error ? (error.cause as Error | undefined) : undefined
  return cause?.message || (error instanceof Error ? error.message : String(error))
}

export interface AgentRequestOptions {
  /** What a 404 is about, e.g. "Project 123". */
  subject: string
  /** Scopes the endpoint needs, named in the 403 message. */
  scopes: readonly string[]
}

/** An HTTP error from the agent API, with its status for callers that branch on it. */
export class ApiError extends CliError {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function apiError(
  response: Response,
  { subject, scopes }: AgentRequestOptions,
): Promise<ApiError> {
  const detail = await detailOf(response)
  const message = (() => {
    switch (response.status) {
      case 401:
        return `The agent token was rejected (${detail}). Check ${TOKEN_ENV}.`
      case 403:
        return scopes.length > 0 ? `${detail}. The token needs ${scopes.join(', ')}.` : detail
      case 404:
        return `${subject} was not found (${detail}).`
      case 413:
        return `The API refused the upload as too large (${detail}).`
      case 422:
        return `The API rejected the request (${detail}).`
      case 429:
        return `Rate limited by the API (${detail}). Try again later.`
      default:
        return `The API returned ${response.status}: ${detail}`
    }
  })()
  return new ApiError(message, response.status)
}

async function agentRequest<T>(
  apiUrl: string,
  token: string,
  path: string,
  options: AgentRequestOptions,
  init?: RequestOptions,
): Promise<T> {
  const response = await request(apiUrl, `${AGENT_PATH}${path}`, token, init)
  if (!response.ok) throw await apiError(response, options)
  try {
    return (await response.json()) as T
  } catch {
    throw new CliError(`${apiUrl} did not return JSON. Check the API URL.`)
  }
}

/** GET an agent API path (relative to /api/agent/v1) and parse the JSON. */
export function agentGet<T>(
  apiUrl: string,
  token: string,
  path: string,
  options: AgentRequestOptions,
): Promise<T> {
  return agentRequest(apiUrl, token, path, options)
}

/** POST JSON or a form to an agent API path and parse the JSON answer. */
export function agentPost<T>(
  apiUrl: string,
  token: string,
  path: string,
  body: FormData | Record<string, unknown>,
  options: AgentRequestOptions,
): Promise<T> {
  const init: RequestOptions =
    body instanceof FormData
      ? { method: 'POST', body }
      : { method: 'POST', body: JSON.stringify(body), contentType: 'application/json' }
  return agentRequest(apiUrl, token, path, options, init)
}

// --- Endpoints -------------------------------------------------------------

/** Scopes each API-backed subcommand needs. `doctor` checks the token against these. */
export const COMMAND_SCOPES = {
  roadmap: ['projects:read', 'goals:read', 'tasks:read', 'logs:read'],
  context: ['context:read'],
  attach: ['attachments:write'],
} as const satisfies Record<string, readonly string[]>

/** Scopes an option needs on top of its subcommand's. */
export const OPTION_SCOPES = {
  context: { option: '--with-images', scopes: ['attachments:read'] },
  attach: { option: '--append', scopes: ['notes:write'] },
} as const satisfies Partial<
  Record<keyof typeof COMMAND_SCOPES, { option: string; scopes: readonly string[] }>
>

export function fetchTimeline(
  apiUrl: string,
  token: string,
  projectId: string,
): Promise<ProjectTimelineData> {
  return agentGet(apiUrl, token, `/projects/${encodeURIComponent(projectId)}/timeline`, {
    subject: `Project ${projectId}`,
    scopes: COMMAND_SCOPES.roadmap,
  })
}

export interface AgentMe {
  token_name: string
  token_prefix: string
  scopes: string[]
  user_id: string
}

export type ContextKind = 'project' | 'goal'

export interface ContextExportQuery {
  includeCompleted: boolean
  includeWorkSessions: boolean
  includeDailyPlans: boolean
  /** The logs of the notes; their overviews are always exported. */
  includeNoteLogs?: boolean
  periodDays?: number
}

export interface ContextExport {
  filename: string
  markdown: string
  generated_at: string
}

export function fetchContext(
  apiUrl: string,
  token: string,
  kind: ContextKind,
  id: string,
  query: ContextExportQuery,
): Promise<ContextExport> {
  const params = new URLSearchParams({
    include_completed: String(query.includeCompleted),
    include_work_sessions: String(query.includeWorkSessions),
    include_daily_plans: String(query.includeDailyPlans),
  })
  if (query.includeNoteLogs) params.set('include_note_logs', 'true')
  if (query.periodDays !== undefined) params.set('period_days', String(query.periodDays))
  const subject = kind === 'project' ? `Project ${id}` : `Goal ${id}`
  return agentGet(
    apiUrl,
    token,
    `/context-export/${kind}s/${encodeURIComponent(id)}?${params}`,
    { subject, scopes: COMMAND_SCOPES.context },
  )
}

// --- Note images -------------------------------------------------------------

export type NoteKind = 'project' | 'goal' | 'task'

const NOTE_SUBJECT: Record<NoteKind, string> = { project: 'Project', goal: 'Goal', task: 'Task' }

const notePath = (kind: NoteKind, id: string) =>
  `/context-notes/${kind}s/${encodeURIComponent(id)}`

/** Where the original of an attached image is; HumanCompiler keeps only a preview. */
export interface AttachmentSource {
  path?: string
  script?: string
  host?: string
  /** SHA-256 of the original file. */
  sha256?: string
}

export interface Attachment {
  id: string
  note_id: string
  caption: string
  width: number
  height: number
  byte_size: number
  thumb_byte_size: number
  sha256: string
  source: AttachmentSource | null
  created_at: string
  /** The reference to put in a note: `![caption](attachment:<id>)`. */
  markdown: string
  /** True when the same bytes were already attached to this note. */
  reused?: boolean
}

/** Upload a preview image to the note of a project, goal or task. */
export function uploadAttachment(
  apiUrl: string,
  token: string,
  kind: NoteKind,
  id: string,
  upload: { preview: Uint8Array; caption: string; source: AttachmentSource },
): Promise<Attachment> {
  const form = new FormData()
  // Copied into a plain ArrayBuffer view, the type a Blob part needs.
  form.set('file', new Blob([new Uint8Array(upload.preview)], { type: 'image/webp' }), 'preview.webp')
  form.set('caption', upload.caption)
  form.set('source', JSON.stringify(upload.source))
  return agentPost(apiUrl, token, `${notePath(kind, id)}/attachments`, form, {
    subject: `${NOTE_SUBJECT[kind]} ${id}`,
    scopes: COMMAND_SCOPES.attach,
  })
}

/** Add Markdown to the end of the note of a project, goal or task. */
export async function appendToNote(
  apiUrl: string,
  token: string,
  kind: NoteKind,
  id: string,
  markdown: string,
): Promise<void> {
  await agentPost(
    apiUrl,
    token,
    `${notePath(kind, id)}/append`,
    { content_markdown: markdown },
    { subject: `${NOTE_SUBJECT[kind]} ${id}`, scopes: OPTION_SCOPES.attach.scopes },
  )
}

export interface AttachmentUrl {
  /** A short-lived signed URL on the storage host. Fetch it without the token. */
  url: string
  expires_at: string
}

export function fetchAttachmentUrl(
  apiUrl: string,
  token: string,
  id: string,
  variant: 'full' | 'thumb' = 'full',
): Promise<AttachmentUrl> {
  return agentGet(apiUrl, token, `/attachments/${encodeURIComponent(id)}/url?variant=${variant}`, {
    subject: `Image ${id}`,
    scopes: OPTION_SCOPES.context.scopes,
  })
}
