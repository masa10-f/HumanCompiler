// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

// Tests for `humancompiler doctor`, against a local mock of the agent API.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { run, startMockApi, tempDir } from './helpers.mjs'

const ALL_READ = ['context:read', 'goals:read', 'logs:read', 'projects:read', 'tasks:read']
const TOKENS = {
  'full-token': ALL_READ,
  'roadmap-token': ['goals:read', 'logs:read', 'projects:read', 'tasks:read'],
  'hook-token': ['quick_tasks:write'],
}

describe('doctor', () => {
  let api
  let unhealthy

  before(async () => {
    api = await startMockApi((req) => {
      if (req.url === '/health') {
        return unhealthy
          ? { status: 503, body: { status: 'unhealthy' } }
          : { status: 200, body: { status: 'healthy', message: 'OK' } }
      }
      if (req.url === '/api/agent/v1/me') {
        const token = req.headers.authorization?.replace(/^Bearer /, '')
        if (token === 'dated-limit-token') {
          return { status: 429, headers: { 'Retry-After': 'Sat, 07 Nov 2026 05:00:00 GMT' }, body: { detail: 'Too many requests' } }
        }
        if (token === 'limited-token') {
          return { status: 429, headers: { 'Retry-After': '42' }, body: { detail: 'Too many requests' } }
        }
        const scopes = TOKENS[token]
        if (!scopes) return { status: 401, body: { detail: 'Invalid agent token' } }
        return {
          status: 200,
          body: { token_name: 'laptop', token_prefix: 'hc_agent_ab', scopes, user_id: 'u1' },
        }
      }
      return undefined
    })
  })

  after(() => api.close())

  const doctor = (args, token, extra = {}) =>
    run(['doctor', ...args], { HUMANCOMPILER_TOKEN: token, HUMANCOMPILER_API_URL: api.url, ...extra }, { cwd: tempDir() })

  test('passes with a token that has every scope', async () => {
    unhealthy = false
    const { code, stdout } = await doctor([], 'full-token')

    assert.equal(code, 0, stdout)
    assert.match(stdout, /\[ok\] {3}Node\.js \S+ \(needs 22\.4 or later\)/)
    assert.match(stdout, /\[ok\] {3}HUMANCOMPILER_TOKEN is set/)
    assert.match(stdout, /\[ok\] {3}The API at http:\/\/127\.0\.0\.1:\d+ answers/)
    assert.match(stdout, /\[ok\] {3}The token "laptop" \(hc_agent_ab\.\.\.\) is valid/)
    assert.match(stdout, /\[ok\] {3}roadmap: projects:read, goals:read, tasks:read, logs:read/)
    assert.match(stdout, /\[ok\] {3}context: context:read/)
    assert.match(stdout, /All checks passed\.\n$/)
    // /health needs no token; only /me gets it.
    const health = api.requests.findLast((r) => r.url === '/health')
    assert.equal(health.authorization, undefined)
  })

  test('fails when a subcommand lacks scopes, and says how to fix it', async () => {
    const { code, stdout } = await doctor([], 'roadmap-token')

    assert.equal(code, 1)
    assert.match(stdout, /\[ok\] {3}roadmap:/)
    assert.match(stdout, /\[fail\] context: missing context:read\n {7}Fix: Scopes are fixed when a token is created/)
    assert.match(stdout, /Some checks failed/)
  })

  test('checks only the named subcommands', async () => {
    const { code, stdout } = await doctor(['roadmap'], 'roadmap-token')

    assert.equal(code, 0, stdout)
    assert.doesNotMatch(stdout, /context:/)
  })

  test('lists every missing scope', async () => {
    const { code, stdout } = await doctor([], 'hook-token')
    assert.equal(code, 1)
    assert.match(stdout, /\[fail\] roadmap: missing projects:read, goals:read, tasks:read, logs:read/)
    assert.match(stdout, /\[info\] Scopes: quick_tasks:write/)
  })

  test('reports a rejected token', async () => {
    const { code, stdout } = await doctor([], 'bad-token')
    assert.equal(code, 1)
    assert.match(stdout, /\[fail\] The token was rejected: it is wrong, expired or revoked/)
    assert.match(stdout, /\[skip\] roadmap: needs .* \(not checked: no valid token\)/)
  })

  test('reports rate limiting with the wait', async () => {
    const { code, stdout } = await doctor([], 'limited-token')
    assert.equal(code, 1)
    assert.match(stdout, /Fix: Wait 42 seconds and run doctor again\./)
  })

  test('says "a minute" when Retry-After is a date', async () => {
    const { stdout } = await doctor([], 'dated-limit-token')
    assert.match(stdout, /Fix: Wait a minute and run doctor again\./)
  })

  test('reports a missing token without calling /me', async () => {
    const count = api.requests.filter((r) => r.url === '/api/agent/v1/me').length
    const { code, stdout } = await doctor([], '')

    assert.equal(code, 1)
    assert.match(stdout, /\[fail\] HUMANCOMPILER_TOKEN is not set\n {7}Fix: Create an agent token/)
    assert.match(stdout, /\[ok\] {3}The API at .* answers/)
    assert.equal(api.requests.filter((r) => r.url === '/api/agent/v1/me').length, count)
  })

  test('reports an API that is down', async () => {
    unhealthy = true
    try {
      const { code, stdout } = await doctor([], 'full-token')
      assert.equal(code, 1)
      assert.match(stdout, /reports it is unavailable \(503\)/)
    } finally {
      unhealthy = false
    }
  })

  test('reports an API it cannot reach', async () => {
    // A port that was just free and is now closed.
    const closed = await startMockApi(() => undefined)
    await closed.close()
    const { code, stdout } = await doctor([], 'full-token', { HUMANCOMPILER_API_URL: closed.url })
    assert.equal(code, 1)
    assert.match(stdout, /\[fail\] Could not reach http:\/\/127\.0\.0\.1:\d+: .*ECONNREFUSED/)
  })

  test('refuses an http API on another host', async () => {
    const { code, stdout } = await doctor([], 'full-token', { HUMANCOMPILER_API_URL: 'http://api.example.com' })
    assert.equal(code, 1)
    assert.match(stdout, /\[fail\] Refusing to send the agent token to http:\/\/api\.example\.com/)
  })

  for (const [version, ok] of [
    ['20.15.1', false],
    ['20.16.0', false],
    ['21.7.3', false],
    ['22.3.0', false],
    ['22.4.0', true],
    ['24.0.0', true],
  ]) {
    test(`judges Node.js ${version} ${ok ? 'supported' : 'unsupported'}`, async () => {
      const { stdout } = await run(
        ['doctor'],
        { HUMANCOMPILER_TOKEN: 'full-token', HUMANCOMPILER_API_URL: api.url },
        { nodeArgs: ['--require', path.join(writeNodeShim(version), 'shim.cjs')] },
      )
      if (ok) assert.match(stdout, new RegExp(`\\[ok\\] {3}Node\\.js ${version.replaceAll('.', '\\.')} `))
      else {
        assert.match(
          stdout,
          new RegExp(`\\[fail\\] Node\\.js ${version.replaceAll('.', '\\.')} is not supported \\(needs 22\\.4 or later\\)\\n {7}Fix: Install a current Node\\.js LTS`),
        )
      }
    })
  }

  test('shows whether setup has been run here', async () => {
    const cwd = tempDir()
    writeFileSync(path.join(cwd, '.mcp.json'), JSON.stringify({ mcpServers: { humancompiler: {} } }))
    const codexHome = tempDir()
    mkdirSync(codexHome, { recursive: true })
    writeFileSync(path.join(codexHome, 'config.toml'), '[mcp_servers.humancompiler]\nurl = "x"\n')

    const { stdout } = await run(
      ['doctor'],
      { HUMANCOMPILER_TOKEN: 'full-token', HUMANCOMPILER_API_URL: api.url, CODEX_HOME: codexHome },
      { cwd },
    )
    assert.match(stdout, /\[info\] Claude Code: .*\.mcp\.json has the humancompiler server/)
    assert.match(stdout, /\[info\] Codex: .*config\.toml has \[mcp_servers\.humancompiler\]/)
  })

  for (const [content, message] of [
    ['null', /\.mcp\.json is not a JSON object; fix it/],
    ['{ "mcpServers": ', /\.mcp\.json is not a JSON object; fix it/],
    ['{ "mcpServers": { "other": {} } }', /\.mcp\.json has no humancompiler server/],
  ]) {
    test(`describes a .mcp.json holding ${content}`, async () => {
      const cwd = tempDir()
      writeFileSync(path.join(cwd, '.mcp.json'), content)
      const { stdout } = await run(
        ['doctor'],
        { HUMANCOMPILER_TOKEN: 'full-token', HUMANCOMPILER_API_URL: api.url },
        { cwd },
      )
      assert.match(stdout, message)
      assert.doesNotMatch(stdout, /no \.mcp\.json here/)
    })
  }
})

function writeNodeShim(version) {
  const dir = tempDir()
  writeFileSync(
    path.join(dir, 'shim.cjs'),
    `Object.defineProperty(process.versions, 'node', { value: ${JSON.stringify(version)} })\n`,
  )
  return dir
}
