// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

// Tests for `humancompiler roadmap`.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { CLI, FIXTURE, run as runCli, startMockApi, tempDir } from './helpers.mjs'

const NOW = '2026-11-06T12:00:00Z'
const timeline = JSON.parse(readFileSync(FIXTURE, 'utf8'))

const run = (args, env) => runCli(['roadmap', ...args], env)

function pngSize(file) {
  const png = readFileSync(file)
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG')
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

describe('drawing from a file', () => {
  test('saves a PNG and prints the schedule as Markdown', async () => {
    const out = path.join(tempDir(), 'roadmap.png')
    const { code, stdout, stderr } = await run(['--input', FIXTURE, '--now', NOW, '-o', out])

    assert.equal(code, 0, stderr)
    assert.match(stdout, /^# HumanCompiler v2 開発 ロードマップ（2026\/11\/6 時点）/)
    assert.match(stdout, /週 14h で計画（容量設定から）/)
    assert.match(stdout, /\| API 実装 \| 進行中 \| .* \| 2026\/11\/15（見込み） \| 2026\/11\/17 \|/)
    assert.match(stdout, /\| ベータリリース \| 未着手 \| .* \| フロントエンド画面、MCP 連携 \|/)
    // 1400 CSS px wide at the default 2x.
    assert.equal(pngSize(out).width, 2800)
    assert.ok(stdout.includes(`${out}（2800×`))
  })

  test('prints JSON with the projected dates and image list', async () => {
    const out = path.join(tempDir(), 'roadmap.png')
    const { code, stdout } = await run([
      '--input', FIXTURE, '--now', NOW, '-o', out, '--json', '--pixel-ratio', '1',
    ])

    assert.equal(code, 0)
    const summary = JSON.parse(stdout)
    assert.equal(summary.project.id, 'project-1')
    assert.equal(summary.weekly_hours, 14)
    assert.equal(summary.weekly_hours_source, 'capacity')
    assert.equal(summary.goals.length, 6)
    const api = summary.goals.find((goal) => goal.title === 'API 実装')
    assert.equal(api.phase, 'active')
    assert.equal(api.remaining_hours, 18)
    assert.equal(api.delay_days, 0)
    const beta = summary.goals.find((goal) => goal.title === 'ベータリリース')
    assert.deepEqual(
      beta.waiting_on.map((goal) => goal.title),
      ['フロントエンド画面', 'MCP 連携'],
    )
    assert.deepEqual(summary.images, [
      { path: out, width: 1400, height: pngSize(out).height, goal_ids: summary.goals.map((g) => g.id) },
    ])
  })

  test('--weekly-hours overrides the capacity and moves the dates', async () => {
    const base = JSON.parse((await run(['--input', FIXTURE, '--now', NOW, '--no-image', '--json'])).stdout)
    const slow = JSON.parse(
      (await run(['--input', FIXTURE, '--now', NOW, '--no-image', '--json', '--weekly-hours', '7'])).stdout,
    )

    assert.equal(slow.weekly_hours, 7)
    assert.equal(slow.weekly_hours_source, 'option')
    assert.ok(new Date(slow.projected_end) > new Date(base.projected_end))
  })

  test('falls back to 20h a week without an effort ratio, and says so', async () => {
    const dir = tempDir()
    const input = path.join(dir, 'timeline.json')
    const data = structuredClone(timeline)
    data.project.weekly_work_hours = 0
    data.project.capacity = { ...data.project.capacity, effort_percent: 0, weekly_work_hours: 0 }
    writeFileSync(input, JSON.stringify(data))

    const { code, stdout, stderr } = await run(['--input', input, '--now', NOW, '--no-image'])

    assert.equal(code, 0)
    assert.match(stdout, /週 20h で計画（容量設定が無いため仮の値）/)
    assert.match(stderr, /no effort ratio/)
  })

  test('splits goals into several images with --goals-per-page', async () => {
    const dir = tempDir()
    const { code, stdout } = await run([
      '--input', FIXTURE, '--now', NOW, '-o', path.join(dir, 'map.png'), '--goals-per-page', '4',
    ])

    assert.equal(code, 0)
    assert.deepEqual(readdirSync(dir).sort(), ['map-1.png', 'map-2.png'])
    assert.match(stdout, /map-1\.png（.*ゴール 4 件）/)
    assert.match(stdout, /map-2\.png（.*ゴール 2 件）/)
  })

  test('writes SVG for an .svg output, escaping titles', async () => {
    const dir = tempDir()
    const input = path.join(dir, 'timeline.json')
    const data = structuredClone(timeline)
    data.project.title = 'A & <B>'
    writeFileSync(input, JSON.stringify(data))
    const out = path.join(dir, 'roadmap.svg')

    const { code } = await run(['--input', input, '--now', NOW, '-o', out])

    assert.equal(code, 0)
    const svg = readFileSync(out, 'utf8')
    assert.ok(svg.startsWith('<?xml'))
    assert.ok(svg.includes('A &amp; &lt;B&gt;'))
  })

  test('--no-image writes no file', async () => {
    const dir = tempDir()
    const { code, stdout } = await run([
      '--input', FIXTURE, '--now', NOW, '--no-image', '-o', path.join(dir, 'x.png'),
    ])

    assert.equal(code, 0)
    assert.equal(existsSync(path.join(dir, 'x.png')), false)
    assert.doesNotMatch(stdout, /画像:/)
  })

  test('--hide-completed leaves finished goals out', async () => {
    const { stdout } = await run(['--input', FIXTURE, '--now', NOW, '--no-image', '--json', '--hide-completed'])

    assert.deepEqual(
      JSON.parse(stdout).goals.map((goal) => goal.phase),
      ['active', 'planned', 'planned', 'planned'],
    )
  })

  for (const [args, message] of [
    [['--zoom', 'year'], /--zoom must be/],
    [['--width', '10'], /--width must be a whole number from 640/],
    [['--width', '1400.5'], /--width must be a whole number from 640 to 4000/],
    [['-o', 'roadmap.jpg'], /--output must end in .png or .svg/],
    [['--now', 'yesterday'], /--now must be an ISO date-time/],
    [['--bogus'], /Unknown option/],
    [['--goals-per-page', '2.5'], /--goals-per-page must be a whole number from 0 to 1000/],
  ]) {
    test(`rejects ${args.join(' ')}`, async () => {
      const { code, stderr } = await run(['--input', FIXTURE, ...args])
      assert.notEqual(code, 0)
      assert.match(stderr, message)
    })
  }
})

test('stops on Node versions without negative options', async () => {
  // Pretend to be Node 20.15 before the CLI starts. With -e, argv[1] is the
  // first argument, so a placeholder stands in for the script path.
  const child = await new Promise((resolve) => {
    const proc = spawn(
      process.execPath,
      ['-e', `Object.defineProperty(process.versions, 'node', { value: '20.15.1' }); require(${JSON.stringify(CLI)})`, '--', 'cli.js', 'roadmap', '--input', FIXTURE, '--no-image'],
    )
    let stderr = ''
    proc.stderr.on('data', (chunk) => (stderr += chunk))
    proc.on('close', (code) => resolve({ code, stderr }))
  })
  assert.equal(child.code, 1)
  assert.match(child.stderr, /Node\.js 20\.16 or later is required \(this is 20\.15\.1\)/)
})

describe('fetching from the agent API', () => {
  let api
  let baseUrl

  before(async () => {
    api = await startMockApi((req) => {
      if (req.url === '/api/agent/v1/projects/proxy-error/timeline') {
        return { status: 502, statusText: 'Bad Gateway', body: { error: 'upstream down' } }
      }
      if (req.url === '/api/agent/v1/projects/html/timeline') {
        return { status: 200, headers: { 'Content-Type': 'text/html' }, body: '<html>login</html>' }
      }
      if (req.headers.authorization !== 'Bearer good-token') {
        return { status: 401, body: { detail: 'Invalid agent token' } }
      }
      if (req.url === '/api/agent/v1/projects/project-1/timeline') return { status: 200, body: timeline }
      if (req.url === '/api/agent/v1/projects/no-scope/timeline') {
        return { status: 403, body: { detail: 'Missing required scope: logs:read' } }
      }
      return { status: 404, body: { detail: 'Project not found' } }
    })
    baseUrl = api.url
  })

  after(() => api.close())

  test('fetches the project with the token and draws it', async () => {
    const out = path.join(tempDir(), 'roadmap.png')
    const { code, stdout, stderr } = await run(['project-1', '--now', NOW, '-o', out], {
      HUMANCOMPILER_TOKEN: 'good-token',
      HUMANCOMPILER_API_URL: baseUrl,
    })

    assert.equal(code, 0, stderr)
    assert.match(stdout, /HumanCompiler v2 開発 ロードマップ/)
    assert.ok(existsSync(out))
    assert.deepEqual(api.requests.at(-1), {
      url: '/api/agent/v1/projects/project-1/timeline',
      authorization: 'Bearer good-token',
    })
  })

  for (const [project, token, message] of [
    ['project-1', 'bad-token', /token was rejected \(Invalid agent token\)/],
    ['no-scope', 'good-token', /Missing required scope: logs:read\. The token needs/],
    ['missing', 'good-token', /Project missing was not found/],
    ['html', 'good-token', /did not return JSON/],
    ['proxy-error', 'good-token', /The API returned 502: Bad Gateway/],
  ]) {
    test(`reports ${message}`, async () => {
      const { code, stderr } = await run([project, '--no-image'], {
        HUMANCOMPILER_TOKEN: token,
        HUMANCOMPILER_API_URL: baseUrl,
      })
      assert.equal(code, 1)
      assert.match(stderr, message)
    })
  }

  test('needs HUMANCOMPILER_TOKEN', async () => {
    const { code, stderr } = await run(['project-1'], { HUMANCOMPILER_API_URL: baseUrl })
    assert.equal(code, 1)
    assert.match(stderr, /Set HUMANCOMPILER_TOKEN/)
  })

  test('refuses to send the token over plain http to another host', async () => {
    const count = api.requests.length
    const { code, stderr } = await run(['project-1'], {
      HUMANCOMPILER_TOKEN: 'good-token',
      HUMANCOMPILER_API_URL: 'http://api.example.com',
    })
    assert.equal(code, 1)
    assert.match(stderr, /Refusing to send the agent token/)
    assert.equal(api.requests.length, count)
  })
})
