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

/** Only https, except to this machine (local development). */
export function validateApiUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new CliError(`Invalid API URL: ${raw}`)
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
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

/**
 * GET without following redirects, so the token never goes to another host.
 * Network failures become a CliError; HTTP errors are left to the caller.
 */
export async function request(
  apiUrl: string,
  path: string,
  token?: string,
): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  try {
    return await fetch(`${apiUrl}${path}`, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'error',
    })
  } catch (error) {
    // fetch() says only "fetch failed"; the cause names the real problem.
    const cause = error instanceof Error ? (error.cause as Error | undefined) : undefined
    const reason = cause?.message || (error instanceof Error ? error.message : String(error))
    throw new CliError(`Could not reach ${apiUrl}: ${reason}`)
  }
}

export interface AgentGetOptions {
  /** What a 404 is about, e.g. "Project 123". */
  subject: string
  /** Scopes the endpoint needs, named in the 403 message. */
  scopes: readonly string[]
}

/** GET an agent API path (relative to /api/agent/v1) and parse the JSON. */
export async function agentGet<T>(
  apiUrl: string,
  token: string,
  path: string,
  { subject, scopes }: AgentGetOptions,
): Promise<T> {
  const response = await request(apiUrl, `${AGENT_PATH}${path}`, token)
  if (response.ok) {
    try {
      return (await response.json()) as T
    } catch {
      throw new CliError(`${apiUrl} did not return JSON. Check the API URL.`)
    }
  }

  const detail = await detailOf(response)
  switch (response.status) {
    case 401:
      throw new CliError(`The agent token was rejected (${detail}). Check ${TOKEN_ENV}.`)
    case 403:
      throw new CliError(
        scopes.length > 0 ? `${detail}. The token needs ${scopes.join(', ')}.` : detail,
      )
    case 404:
      throw new CliError(`${subject} was not found (${detail}).`)
    case 422:
      throw new CliError(`The API rejected the request (${detail}).`)
    case 429:
      throw new CliError(`Rate limited by the API (${detail}). Try again later.`)
    default:
      throw new CliError(`The API returned ${response.status}: ${detail}`)
  }
}

// --- Endpoints -------------------------------------------------------------

/** Scopes each API-backed subcommand needs. `doctor` checks the token against these. */
export const COMMAND_SCOPES = {
  roadmap: ['projects:read', 'goals:read', 'tasks:read', 'logs:read'],
  context: ['context:read'],
} as const satisfies Record<string, readonly string[]>

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
  if (query.periodDays !== undefined) params.set('period_days', String(query.periodDays))
  const subject = kind === 'project' ? `Project ${id}` : `Goal ${id}`
  return agentGet(
    apiUrl,
    token,
    `/context-export/${kind}s/${encodeURIComponent(id)}?${params}`,
    { subject, scopes: COMMAND_SCOPES.context },
  )
}
