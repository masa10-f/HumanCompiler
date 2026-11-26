// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

// Tests for `humancompiler context`, against a local mock of the agent API.

import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { run, startMockApi, tempDir } from './helpers.mjs'

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const GOAL_ID = '22222222-2222-4222-8222-222222222222'
const MARKDOWN = '# AIコンテキスト: Website renewal\n\n## ゴール: API 実装\n'

// A project whose notes refer to images: one twice, one deleted, one whose
// download URL is not https, and one whose caption holds brackets.
const IMAGES_ID = '55555555-5555-4555-8555-555555555555'
const IMAGE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const IMAGE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const IMAGE_DELETED = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const IMAGE_INSECURE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const IMAGE_BYTES = Buffer.from('RIFF\x10\x00\x00\x00WEBPVP8 fake image bytes', 'latin1')
const IMAGES_MARKDOWN = [
  '# Notes',
  `![Loss by epoch](attachment:${IMAGE_A})`,
  `Again: ![Loss by epoch](attachment:${IMAGE_A.toUpperCase()}) and ![a \\[b\\] c](attachment:${IMAGE_B})`,
  `![Gone](attachment:${IMAGE_DELETED})`,
  `![Elsewhere](attachment:${IMAGE_INSECURE})`,
  '![External](https://example.com/x.png) and [a link](attachment:not-an-image)',
  '',
].join('\n')

describe('context', () => {
  let api
  let env
  let noImageScope = false

  before(async () => {
    api = await startMockApi((req) => {
      // The storage host: signed URLs carry their own token.
      if (req.url.startsWith('/storage/')) {
        return req.url.endsWith('?token=signed')
          ? { status: 200, headers: { 'Content-Type': 'image/webp' }, body: IMAGE_BYTES }
          : { status: 400, body: { detail: 'bad signature' } }
      }
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
      if (url.pathname === `/api/agent/v1/context-export/projects/${IMAGES_ID}`) {
        return {
          status: 200,
          body: { filename: 'images.md', markdown: IMAGES_MARKDOWN, generated_at: '2026-11-06T12:00:00+00:00' },
        }
      }
      const image = /^\/api\/agent\/v1\/attachments\/([^/]+)\/url$/.exec(url.pathname)
      if (image) {
        if (noImageScope) return { status: 403, body: { detail: 'Missing required scope: attachments:read' } }
        if (url.searchParams.get('variant') !== 'full') return { status: 422, body: { detail: 'variant' } }
        if (image[1] === IMAGE_DELETED) return { status: 404, body: { detail: 'Attachment not found' } }
        const signed =
          image[1] === IMAGE_INSECURE
            ? 'http://storage.example.com/x.webp?token=s'
            : `http://${req.headers.host}/storage/${image[1]}.webp?token=signed`
        return { status: 200, body: { url: signed, expires_at: '2026-11-06T12:10:00+00:00' } }
      }
      if (url.pathname === '/api/agent/v1/context-export/projects/wrong-shape') {
        return { status: 200, body: { detail: 'ok' } }
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
    [['project', 'wrong-shape'], 'good-token', /did not answer with a context export\. Check the API URL\./],
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

  test('leaves image references as they are without --with-images', async () => {
    const { code, stdout, stderr } = await run(['context', 'project', IMAGES_ID], env)
    assert.equal(code, 0, stderr)
    assert.equal(stdout, IMAGES_MARKDOWN)
    assert.equal(stderr, '')
    assert.doesNotMatch(api.requests.at(-1).url, /attachments/)
  })

  test('--with-images saves the images and points the references to them', async () => {
    const dir = tempDir()
    const out = path.join(dir, 'docs', 'context.md')
    const count = api.requests.length
    const { code, stdout, stderr } = await run(
      ['context', 'project', IMAGES_ID, '-o', out, '--with-images', path.join(dir, 'docs', 'my images')],
      env,
    )

    assert.equal(code, 0, stderr)
    assert.equal(
      readFileSync(out, 'utf8'),
      [
        '# Notes',
        `![Loss by epoch](<my images/${IMAGE_A}.webp>)`,
        `Again: ![Loss by epoch](<my images/${IMAGE_A}.webp>) and ![a \\[b\\] c](<my images/${IMAGE_B}.webp>)`,
        // Not saved: the references stay, so the caption and id are not lost.
        `![Gone](attachment:${IMAGE_DELETED})`,
        `![Elsewhere](attachment:${IMAGE_INSECURE})`,
        '![External](https://example.com/x.png) and [a link](attachment:not-an-image)',
        '',
      ].join('\n'),
    )
    for (const id of [IMAGE_A, IMAGE_B]) {
      assert.deepEqual(readFileSync(path.join(dir, 'docs', 'my images', `${id}.webp`)), IMAGE_BYTES)
    }
    assert.match(stdout, /^Wrote the project context to .*context\.md /)
    assert.match(
      stderr,
      new RegExp(`^humancompiler context: Image ${IMAGE_DELETED} was not found \\(Attachment not found\\)\\. Its reference is left as it is\\.$`, 'm'),
    )
    assert.match(
      stderr,
      new RegExp(`^humancompiler context: Image ${IMAGE_INSECURE} was not saved: refusing to download from http://storage\\.example\\.com: not https$`, 'm'),
    )
    assert.match(stderr, /^Saved 2 of 4 images to .*my images\.$/m)

    const requests = api.requests.slice(count)
    // One URL request per image, however often the notes refer to it.
    assert.equal(requests.filter((r) => r.url === `/api/agent/v1/attachments/${IMAGE_A}/url?variant=full`).length, 1)
    // The agent token goes to the API only, never to the storage host.
    const downloads = requests.filter((r) => r.url.startsWith('/storage/'))
    assert.equal(downloads.length, 2)
    for (const download of downloads) assert.equal(download.authorization, undefined)
  })

  test('--with-images links relative to the current directory when printing', async () => {
    const cwd = tempDir()
    const { code, stdout, stderr } = await run(
      ['context', 'project', IMAGES_ID, '--with-images', 'img'],
      env,
      { cwd },
    )
    assert.equal(code, 0, stderr)
    assert.match(stdout, new RegExp(`^!\\[Loss by epoch\\]\\(img/${IMAGE_A}\\.webp\\)$`, 'm'))
    assert.ok(existsSync(path.join(cwd, 'img', `${IMAGE_B}.webp`)))
    assert.match(stderr, /^Saved 2 of 4 images to img\.$/m)
  })

  test('--with-images creates no directory for notes without images', async () => {
    const cwd = tempDir()
    const { code, stdout, stderr } = await run(
      ['context', 'project', PROJECT_ID, '--with-images', 'img'],
      env,
      { cwd },
    )
    assert.equal(code, 0, stderr)
    assert.equal(stdout, MARKDOWN)
    assert.equal(stderr, 'The notes refer to no images.\n')
    assert.ok(!existsSync(path.join(cwd, 'img')))
  })

  test('--with-images stops when the token may not read images', async () => {
    noImageScope = true
    try {
      const cwd = tempDir()
      const { code, stdout, stderr } = await run(
        ['context', 'project', IMAGES_ID, '-o', 'context.md', '--with-images', 'img'],
        env,
        { cwd },
      )
      assert.equal(code, 1)
      assert.equal(stdout, '')
      assert.match(stderr, /Missing required scope: attachments:read\. The token needs attachments:read\./)
      assert.ok(!existsSync(path.join(cwd, 'context.md')))
    } finally {
      noImageScope = false
    }
  })

  test('reports a file it cannot write without a stack trace', async () => {
    const dir = tempDir()
    writeFileSync(path.join(dir, 'file'), 'not a directory')
    const { code, stderr } = await run(['context', 'project', PROJECT_ID, '-o', path.join(dir, 'file', 'out.md')], env)
    assert.equal(code, 1)
    assert.match(stderr, /^humancompiler context: Could not write .*out\.md: /)
    assert.doesNotMatch(stderr, /unexpected error|\n\s+at /)
  })

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
