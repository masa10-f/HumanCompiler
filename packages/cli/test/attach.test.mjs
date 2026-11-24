// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

// Tests for `humancompiler attach`, against a local mock of the agent API.
// The images are made here with sharp, and the uploaded preview is read back
// with it.

import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import sharp from 'sharp'
import { formOf, run, startMockApi, tempDir } from './helpers.mjs'

const TASK_ID = '33333333-3333-4333-8333-333333333333'
const ATTACHMENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const MAX_BYTES = 300 * 1024
const MAX_EDGE = 1600

const attachment = (caption, extra = {}) => ({
  id: ATTACHMENT_ID,
  note_id: '44444444-4444-4444-8444-444444444444',
  caption,
  width: 800,
  height: 400,
  byte_size: 1234,
  thumb_byte_size: 456,
  sha256: 'f'.repeat(64),
  source: null,
  created_at: '2026-11-24T09:00:00+00:00',
  markdown: `![${caption}](attachment:${ATTACHMENT_ID})`,
  reused: false,
  ...extra,
})

describe('attach', () => {
  let api
  let env
  let dir
  let plot

  before(async () => {
    api = await startMockApi(async (req, body) => {
      if (req.headers.authorization !== 'Bearer good-token') {
        return { status: 401, body: { detail: 'Invalid agent token' } }
      }
      const { pathname } = new URL(req.url, 'http://x')
      const match = /^\/api\/agent\/v1\/context-notes\/(projects|goals|tasks)\/([^/]+)\/(attachments|append)$/.exec(pathname)
      if (req.method !== 'POST' || !match) return undefined
      const [, , id, action] = match
      if (action === 'append') {
        return id === 'no-append'
          ? { status: 403, body: { detail: 'Missing required scope: notes:write' } }
          : { status: 200, body: { id: 'note', content: '' } }
      }
      switch (id) {
        case 'missing':
          return { status: 404, body: { detail: 'Task not found' } }
        case 'no-scope':
          return { status: 403, body: { detail: 'Missing required scope: attachments:write' } }
        case 'too-large':
          return { status: 413, body: { detail: 'Request body exceeds 409600 bytes' } }
        case 'over-quota':
          return { status: 422, body: { detail: 'Image storage is full (200 MB)' } }
        case 'wrong-shape':
          return { status: 201, body: { detail: 'ok' } }
        case 'reused':
          return { status: 200, body: attachment('again', { reused: true }) }
      }
      const form = await new Response(body, { headers: { 'content-type': req.headers['content-type'] } }).formData()
      return { status: 201, body: attachment(form.get('caption')) }
    })
    env = { HUMANCOMPILER_TOKEN: 'good-token', HUMANCOMPILER_API_URL: api.url }
    dir = tempDir()
    plot = path.join(dir, 'plot.png')
    await sharp({ create: { width: 800, height: 400, channels: 3, background: '#3366cc' } })
      .png()
      .toFile(plot)
  })

  after(() => api.close())

  test('uploads a preview with its caption and source, and prints the reference', async () => {
    const { code, stdout, stderr } = await run(
      ['attach', 'task', TASK_ID, 'plot.png', '--caption', '  Loss by epoch  ', '--source', 'python plot.py'],
      env,
      { cwd: dir },
    )

    assert.equal(code, 0, stderr)
    assert.equal(stdout, `![Loss by epoch](attachment:${ATTACHMENT_ID})\n`)
    assert.match(stderr, new RegExp(`^Attached image ${ATTACHMENT_ID}: \\d+ KB original -> \\d+ KB preview, 800x400 px, WebP quality 80\\.$`, 'm'))
    assert.match(stderr, /Put the reference above in the task's note/)

    const request = api.requests.at(-1)
    assert.equal(request.method, 'POST')
    assert.equal(request.url, `/api/agent/v1/context-notes/tasks/${TASK_ID}/attachments`)
    assert.equal(request.authorization, 'Bearer good-token')
    assert.match(request.contentType, /^multipart\/form-data; boundary=/)
    const form = await formOf(request)
    assert.deepEqual([...form.keys()].sort(), ['caption', 'file', 'source'])
    assert.equal(form.get('caption'), 'Loss by epoch')
    const file = form.get('file')
    assert.equal(file.name, 'preview.webp')
    assert.equal(file.type, 'image/webp')
    const meta = await sharp(Buffer.from(await file.arrayBuffer())).metadata()
    assert.deepEqual([meta.format, meta.width, meta.height], ['webp', 800, 400])
    assert.deepEqual(JSON.parse(form.get('source')), {
      path: plot,
      script: 'python plot.py',
      host: hostname(),
      sha256: createHash('sha256').update(readFileSync(plot)).digest('hex'),
    })
  })

  test('shrinks a large image that does not compress to within the limits', async () => {
    // Noise is the worst case: quality alone cannot bring it under 300 KB.
    const noise = path.join(dir, 'noise.png')
    await sharp(randomBytes(3000 * 2000 * 3), { raw: { width: 3000, height: 2000, channels: 3 } })
      .png({ compressionLevel: 0 })
      .toFile(noise)

    const { code, stderr } = await run(['attach', 'goal', 'g1', noise, '--caption', 'Noise'], env)

    assert.equal(code, 0, stderr)
    const request = api.requests.at(-1)
    assert.equal(request.url, '/api/agent/v1/context-notes/goals/g1/attachments')
    const file = (await formOf(request)).get('file')
    assert.ok(file.size <= MAX_BYTES, `${file.size} bytes`)
    const meta = await sharp(Buffer.from(await file.arrayBuffer())).metadata()
    assert.equal(meta.format, 'webp')
    assert.ok(Math.max(meta.width, meta.height) <= MAX_EDGE, `${meta.width}x${meta.height}`)
    // The aspect ratio is kept.
    assert.ok(Math.abs(meta.width / meta.height - 1.5) < 0.01)
    assert.match(stderr, /WebP quality 50\./)
  })

  test('limits the long edge to 1600 px without enlarging small images', async () => {
    const wide = path.join(dir, 'wide.png')
    await sharp({ create: { width: 4000, height: 1000, channels: 4, background: { r: 0, g: 128, b: 0, alpha: 0.5 } } })
      .png()
      .toFile(wide)

    const { code, stderr } = await run(['attach', 'project', 'p1', wide, '--caption', 'Wide'], env)

    assert.equal(code, 0, stderr)
    assert.equal(api.requests.at(-1).url, '/api/agent/v1/context-notes/projects/p1/attachments')
    const file = (await formOf(api.requests.at(-1))).get('file')
    const meta = await sharp(Buffer.from(await file.arrayBuffer())).metadata()
    assert.deepEqual([meta.width, meta.height, meta.hasAlpha], [1600, 400, true])
  })

  test('applies the EXIF orientation and sends no metadata', async () => {
    const photo = path.join(dir, 'photo.jpg')
    await sharp({ create: { width: 400, height: 200, channels: 3, background: '#cc3333' } })
      .withExif({ IFD0: { Copyright: 'Somebody' } })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toFile(photo)
    const original = await sharp(photo).metadata()
    assert.equal(original.orientation, 6)
    assert.ok(original.exif)

    const { code, stderr } = await run(['attach', 'task', TASK_ID, photo, '--caption', 'Photo'], env)

    assert.equal(code, 0, stderr)
    const file = (await formOf(api.requests.at(-1))).get('file')
    const meta = await sharp(Buffer.from(await file.arrayBuffer())).metadata()
    assert.deepEqual([meta.width, meta.height], [200, 400])
    assert.equal(meta.exif, undefined)
    assert.equal(meta.orientation, undefined)
  })

  test('--append adds the reference to the note', async () => {
    const { code, stdout, stderr } = await run(
      ['attach', 'task', TASK_ID, plot, '--caption', 'Loss', '--append'],
      env,
    )

    assert.equal(code, 0, stderr)
    assert.equal(stdout, `![Loss](attachment:${ATTACHMENT_ID})\n`)
    assert.match(stderr, /Appended the reference to the task's note\./)
    const [upload, append] = api.requests.slice(-2)
    assert.equal(upload.url, `/api/agent/v1/context-notes/tasks/${TASK_ID}/attachments`)
    assert.equal(append.method, 'POST')
    assert.equal(append.url, `/api/agent/v1/context-notes/tasks/${TASK_ID}/append`)
    assert.equal(append.contentType, 'application/json')
    assert.deepEqual(JSON.parse(append.body), { content_markdown: `![Loss](attachment:${ATTACHMENT_ID})` })
  })

  test('says the image is attached when only the append fails', async () => {
    const { code, stdout, stderr } = await run(
      ['attach', 'task', 'no-append', plot, '--caption', 'Loss', '--append'],
      env,
    )

    assert.equal(code, 1)
    assert.equal(stdout, `![Loss](attachment:${ATTACHMENT_ID})\n`)
    assert.match(
      stderr,
      /^humancompiler attach: The image is attached, but adding it to the note failed: Missing required scope: notes:write\. The token needs notes:write\.\nPut the reference printed above in the task's note by hand\.$/m,
    )
  })

  test('says when the same image was already attached', async () => {
    const { code, stdout, stderr } = await run(['attach', 'task', 'reused', plot, '--caption', 'again'], env)
    assert.equal(code, 0, stderr)
    assert.equal(stdout, `![again](attachment:${ATTACHMENT_ID})\n`)
    assert.match(stderr, new RegExp(`^Already attached to this note; reused image ${ATTACHMENT_ID}: `))
  })

  for (const [id, token, message] of [
    ['missing', 'good-token', /Task missing was not found \(Task not found\)/],
    ['no-scope', 'good-token', /Missing required scope: attachments:write\. The token needs attachments:write\./],
    ['too-large', 'good-token', /The API refused the upload as too large \(Request body exceeds 409600 bytes\)/],
    ['over-quota', 'good-token', /The API rejected the request \(Image storage is full \(200 MB\)\)/],
    ['wrong-shape', 'good-token', /did not answer with an attachment\. Check the API URL\./],
    [TASK_ID, 'bad-token', /token was rejected \(Invalid agent token\)/],
  ]) {
    test(`reports ${message}`, async () => {
      const { code, stdout, stderr } = await run(
        ['attach', 'task', id, plot, '--caption', 'Loss', '--append'],
        { ...env, HUMANCOMPILER_TOKEN: token },
      )
      assert.equal(code, 1)
      assert.equal(stdout, '')
      assert.match(stderr, message)
      // Nothing is appended for an image that was not attached.
      assert.doesNotMatch(api.requests.at(-1).url, /\/append$/)
    })
  }

  for (const [name, args, message] of [
    ['no caption', ['task', TASK_ID, 'plot.png'], /--caption is required: say what the image shows/],
    ['a blank caption', ['task', TASK_ID, 'plot.png', '--caption', '   '], /--caption is required/],
    ['a caption over 500 characters', ['task', TASK_ID, 'plot.png', '--caption', 'x'.repeat(501)], /--caption must be at most 500 characters/],
    ['a source over 1000 characters', ['task', TASK_ID, 'plot.png', '--caption', 'x', '--source', 'y'.repeat(1001)], /--source must be at most 1000 characters/],
    ['an unknown kind', ['note', TASK_ID, 'plot.png', '--caption', 'x'], /The first argument must be project, goal or task, not note/],
    ['no file', ['task', TASK_ID, '--caption', 'x'], /Give project, goal or task, an id, and an image file/],
    ['two files', ['task', TASK_ID, 'a.png', 'b.png', '--caption', 'x'], /Give project, goal or task, an id, and an image file/],
  ]) {
    test(`rejects ${name} with a usage error`, async () => {
      const count = api.requests.length
      const { code, stdout, stderr } = await run(['attach', ...args], env, { cwd: dir })
      assert.equal(code, 2)
      assert.equal(stdout, '')
      assert.match(stderr, message)
      assert.match(stderr, /Usage: humancompiler attach/)
      assert.equal(api.requests.length, count)
    })
  }

  test('reports a file it cannot read, and one that is not an image', async () => {
    const count = api.requests.length
    const missing = await run(['attach', 'task', TASK_ID, 'nope.png', '--caption', 'x'], env, { cwd: dir })
    assert.equal(missing.code, 1)
    assert.match(missing.stderr, /^humancompiler attach: Could not read nope\.png: /)

    writeFileSync(path.join(dir, 'notes.txt'), 'not an image')
    const text = await run(['attach', 'task', TASK_ID, 'notes.txt', '--caption', 'x'], env, { cwd: dir })
    assert.equal(text.code, 1)
    assert.match(text.stderr, /^humancompiler attach: Could not read the file as an image: /)
    assert.doesNotMatch(text.stderr, /unexpected error|\n\s+at /)
    assert.equal(api.requests.length, count)
  })

  test('needs HUMANCOMPILER_TOKEN, before reading the file', async () => {
    const { code, stderr } = await run(['attach', 'task', TASK_ID, 'nope.png', '--caption', 'x'], {
      HUMANCOMPILER_API_URL: api.url,
    })
    assert.equal(code, 1)
    assert.match(stderr, /Set HUMANCOMPILER_TOKEN/)
  })

  test('refuses to send the token over plain http to another host', async () => {
    const { code, stderr } = await run(['attach', 'task', TASK_ID, plot, '--caption', 'x'], {
      HUMANCOMPILER_TOKEN: 'good-token',
      HUMANCOMPILER_API_URL: 'http://api.example.com',
    })
    assert.equal(code, 1)
    assert.match(stderr, /Refusing to send the agent token/)
  })
})
