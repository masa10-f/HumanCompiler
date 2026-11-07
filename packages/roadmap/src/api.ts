// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/** Fetches a project's timeline data from the HumanCompiler agent API. */

import type { ProjectTimelineData } from '@/lib/timeline/types'

export const DEFAULT_API_URL = 'https://humancompiler-api-masa.fly.dev'
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

async function detailOf(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown } | null
    const detail = body?.detail
    if (typeof detail === 'string') return detail
    // An error page from a proxy may be JSON without a detail.
    return detail === undefined ? response.statusText : JSON.stringify(detail)
  } catch {
    return response.statusText
  }
}

export async function fetchTimeline(
  apiUrl: string,
  token: string,
  projectId: string,
): Promise<ProjectTimelineData> {
  const url = `${apiUrl}/api/agent/v1/projects/${encodeURIComponent(projectId)}/timeline`
  let response: Response
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // Never forward the token to another host.
      redirect: 'error',
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new CliError(`Could not reach ${apiUrl}: ${reason}`)
  }
  if (response.ok) {
    try {
      return (await response.json()) as ProjectTimelineData
    } catch {
      throw new CliError(`${apiUrl} did not return JSON. Check the API URL.`)
    }
  }

  const detail = await detailOf(response)
  switch (response.status) {
    case 401:
      throw new CliError(`The agent token was rejected (${detail}). Check HUMANCOMPILER_TOKEN.`)
    case 403:
      throw new CliError(
        `${detail}. The token needs projects:read, goals:read, tasks:read and logs:read.`,
      )
    case 404:
      throw new CliError(`Project ${projectId} was not found (${detail}).`)
    case 429:
      throw new CliError(`Rate limited by the API (${detail}). Try again later.`)
    default:
      throw new CliError(`The API returned ${response.status}: ${detail}`)
  }
}
