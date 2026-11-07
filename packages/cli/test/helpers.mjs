// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

// Shared by the CLI tests: they run the built CLI (dist/cli.js) as a user or
// agent would. `pnpm test` builds it first.

import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const CLI = path.join(here, '..', 'dist', 'cli.js')
export const PACKAGE_JSON = path.join(here, '..', 'package.json')
export const FIXTURE = path.join(here, 'fixtures', 'timeline.json')

export const tempDir = (prefix = 'humancompiler-') => mkdtempSync(path.join(tmpdir(), prefix))

/**
 * Runs the CLI. The token, API URL and Codex home are cleared, and HOME points
 * to an empty directory, so a test never touches the real ~/.codex or API.
 */
export function run(args, env = {}, { cwd, nodeArgs = [] } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [...nodeArgs, CLI, ...args], {
      cwd,
      env: {
        ...process.env,
        HUMANCOMPILER_TOKEN: '',
        HUMANCOMPILER_API_URL: '',
        CODEX_HOME: '',
        HOME: tempDir('home-'),
        ...env,
      },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

/**
 * A local stand-in for the agent API. `handler(req)` returns
 * `{ status, body, headers }` or undefined for a 404. Requests are recorded.
 */
export async function startMockApi(handler) {
  const requests = []
  const server = createServer((req, res) => {
    requests.push({ url: req.url, authorization: req.headers.authorization })
    const reply = handler(req) ?? { status: 404, body: { detail: 'Not Found' } }
    res.writeHead(reply.status, reply.statusText, {
      'Content-Type': 'application/json',
      ...reply.headers,
    })
    res.end(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}
