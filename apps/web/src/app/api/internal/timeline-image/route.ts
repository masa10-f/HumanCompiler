// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/**
 * `POST /api/internal/timeline-image`: renders the project roadmap as a PNG
 * for the API's MCP tool `get_timeline_image`.
 *
 * It only turns timeline data into an image and reads no user data. The API
 * fetches the data with the agent's token and posts it here with the shared
 * secret `TIMELINE_RENDER_SECRET`, so the image is drawn by the same code as
 * the timeline page's export.
 */

import { createHash, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { renderTimelineImage, timelineImageRequestSchema } from '@/lib/timeline/image-request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 5 * 1024 * 1024

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

function digest(value: string) {
  return createHash('sha256').update(value).digest()
}

/** Constant-time check of `Authorization: Bearer <secret>`. */
function isAuthorized(header: string | null, secret: string): boolean {
  const match = /^Bearer (.+)$/.exec(header ?? '')
  if (!match) return false
  return timingSafeEqual(digest(match[1]!), digest(secret))
}

export async function POST(request: Request) {
  const secret = process.env.TIMELINE_RENDER_SECRET
  if (!secret) {
    return json({ detail: 'Timeline rendering is not configured' }, 503)
  }
  if (!isAuthorized(request.headers.get('authorization'), secret)) {
    return json({ detail: 'Unauthorized' }, 401)
  }

  const raw = await request.text()
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
    return json({ detail: 'Request body too large' }, 413)
  }
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return json({ detail: 'Request body must be JSON' }, 400)
  }
  const parsed = timelineImageRequestSchema.safeParse(body)
  if (!parsed.success) {
    return json({ detail: z.treeifyError(parsed.error) }, 422)
  }

  try {
    return json(await renderTimelineImage(parsed.data), 200)
  } catch (error) {
    console.error('Timeline image rendering failed', error)
    return json({ detail: 'Failed to render timeline image' }, 500)
  }
}
