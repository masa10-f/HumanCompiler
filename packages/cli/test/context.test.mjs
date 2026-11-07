// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

// Tests for `humancompiler context`, against a local mock of the agent API.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { run, startMockApi, tempDir } from './helpers.mjs'

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const GOAL_ID = '22222222-2222-4222-8222-222222222222'
const MARKDOWN = '# AIコンテキスト: Website renewal\n\n## ゴール: API 実装\n'

describe('context', () => {
  let api
  let env

  before(async () => {
    api = await startMockApi((req) => {
      if (req.headers.authorization !== 'Bearer good-token') {
        return { status: 401, body: { detail: 'Invalid agent token' } }
      }
      const url = new URL(req.url, 'http://x')
      if (url.pathname === `/api/agent/v1/context-export/projects/${PROJECT_ID}`) {
        return {
          status: 200,
          body: { filename: 'context.md', markdown: MARKDOWN, generated_at: '2026-11-06T12:00:00+00:00' },
        }
      }
      if (url.pathname === `/api/agent/v1/context-export/goals/${GOAL_ID}`) {
        return {
          status: 200,
          body: { filename: 'goal.md', markdown: '# Goal', generated_at: '2026-11-06T12:00:00+00:00' },
        }
      }
      if (url.pathname === '/api/agent/v1/context-export/projects/no-scope') {
        return { status: 403, body: { detail: 'Missing required scope: context:read' } }
      }
      if (url.pathname === '/api/agent/v1/context-export/goals/not-a-uuid') {
        return {
          status: 422,
          body: {
            detail: [{ loc: ['path', 'goal_id'], msg: 'Input should be a valid UUID', type: 'uuid_parsing' }],
          },
        }
      }
      return { status: 404, body: { detail: 'Project not found' } }
    })
    env = { HUMANCOMPILER_TOKEN: 'good-token', HUMANCOMPILER_API_URL: api.url }
  })

  after(() => api.close())

  test('prints a project\'s context to stdout with the default options', async () => {
    const { code, stdout, stderr } = await run(['context', 'project', PROJECT_ID], env)

    assert.equal(code, 0, stderr)
    assert.equal(stdout, MARKDOWN)
    const { url, authorization } = api.requests.at(-1)
    assert.equal(authorization, 'Bearer good-token')
    assert.equal(
      url,
      `/api/agent/v1/context-export/projects/${PROJECT_ID}?include_completed=true&include_work_sessions=true&include_daily_plans=true`,
    )
  })

  test('writes a goal\'s context to a file and passes the options', async () => {
    const out = path.join(tempDir(), 'nested', 'goal.md')
    const { code, stdout } = await run(
      [
        'context', 'goal', GOAL_ID, '-o', out,
        '--period-days', '30', '--no-completed', '--no-work-sessions', '--no-daily-plans',
      ],
      env,
    )

    assert.equal(code, 0)
    assert.equal(readFileSync(out, 'utf8'), '# Goal\n')
    assert.match(stdout, /^Wrote the goal context to .*goal\.md \(1 line, 7 bytes\)\.$/m)
    const url = new URL(api.requests.at(-1).url, 'http://x')
    assert.equal(url.pathname, `/api/agent/v1/context-export/goals/${GOAL_ID}`)
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      include_completed: 'false',
      include_work_sessions: 'false',
      include_daily_plans: 'false',
      period_days: '30',
    })
  })

  for (const [args, token, message] of [
    [['project', 'no-scope'], 'good-token', /Missing required scope: context:read\. The token needs context:read\./],
    [['project', 'missing'], 'good-token', /Project missing was not found \(Project not found\)/],
    [['goal', 'not-a-uuid'], 'good-token', /The API rejected the request \(goal_id: Input should be a valid UUID\)/],
    [['project', PROJECT_ID], 'bad-token', /token was rejected \(Invalid agent token\)/],
  ]) {
    test(`reports ${message}`, async () => {
      const { code, stderr } = await run(['context', ...args], { ...env, HUMANCOMPILER_TOKEN: token })
      assert.equal(code, 1)
      assert.match(stderr, message)
    })
  }

  for (const [args, message] of [
    [['task', 'x'], /The first argument must be project or goal, not task/],
    [['project'], /Give project or goal, and an id/],
    [['project', 'a', 'b'], /Give project or goal, and an id/],
    [['project', 'a', '--period-days', '0'], /--period-days must be a whole number from 1 to 3650/],
  ]) {
    test(`rejects ${args.join(' ')}`, async () => {
      const count = api.requests.length
      const { code, stderr } = await run(['context', ...args], env)
      assert.notEqual(code, 0)
      assert.match(stderr, message)
      assert.equal(api.requests.length, count)
    })
  }

  test('needs HUMANCOMPILER_TOKEN', async () => {
    const { code, stderr } = await run(['context', 'project', PROJECT_ID], { HUMANCOMPILER_API_URL: api.url })
    assert.equal(code, 1)
    assert.match(stderr, /Set HUMANCOMPILER_TOKEN/)
  })

  test('refuses to send the token over plain http to another host', async () => {
    const { code, stderr } = await run(['context', 'project', PROJECT_ID], {
      HUMANCOMPILER_TOKEN: 'good-token',
      HUMANCOMPILER_API_URL: 'http://api.example.com',
    })
    assert.equal(code, 1)
    assert.match(stderr, /Refusing to send the agent token/)
  })
})
