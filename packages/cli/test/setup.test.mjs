// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

// Tests for `humancompiler setup`. Each test uses a temporary project
// directory and a temporary HOME, never the real ~/.codex.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { run, tempDir } from './helpers.mjs'

const MCP_URL = 'https://humancompiler-api-masa.fly.dev/mcp'
const SECRET = 'hc_agent_secret_value_never_written'
const ENTRY = {
  type: 'http',
  url: MCP_URL,
  headers: { Authorization: 'Bearer ${HUMANCOMPILER_TOKEN}' },
}
const CODEX_BLOCK = `[mcp_servers.humancompiler]
url = "${MCP_URL}"
bearer_token_env_var = "HUMANCOMPILER_TOKEN"`
const BEGIN = /<!-- humancompiler:begin[^>]*-->/g

function project() {
  const dir = tempDir('project-')
  const home = tempDir('home-')
  const setup = (args, env = {}) =>
    run(['setup', ...args], { HOME: home, HUMANCOMPILER_TOKEN: SECRET, ...env }, { cwd: dir })
  const read = (file) => readFileSync(path.join(dir, file), 'utf8')
  const codexConfig = path.join(home, '.codex', 'config.toml')
  return { dir, home, setup, read, codexConfig }
}

describe('setup claude-code', () => {
  test('creates .mcp.json and CLAUDE.md without the token', async () => {
    const { dir, setup, read } = project()
    const { code, stdout, stderr } = await setup(['claude-code'])

    assert.equal(code, 0, stderr)
    assert.deepEqual(JSON.parse(read('.mcp.json')), { mcpServers: { humancompiler: ENTRY } })
    const guide = read('CLAUDE.md')
    assert.equal(guide.match(BEGIN).length, 1)
    assert.match(guide, /MCP tool `find`/)
    assert.match(guide, /npx humancompiler roadmap <project-id> --goals-per-page 20/)
    assert.match(guide, /npx humancompiler context <project\|goal> <id>/)
    assert.match(guide, /<!-- humancompiler:end -->\n$/)
    assert.match(stdout, /\.mcp\.json: created with the humancompiler MCP server/)
    assert.match(stdout, /CLAUDE\.md: created with the HumanCompiler guide/)
    for (const file of ['.mcp.json', 'CLAUDE.md']) assert.ok(!read(file).includes(SECRET))
    assert.ok(!stdout.includes(SECRET))
    assert.equal(existsSync(path.join(dir, 'AGENTS.md')), false)
  })

  test('running it again changes nothing', async () => {
    const { setup, read } = project()
    await setup(['claude-code'])
    const before = [read('.mcp.json'), read('CLAUDE.md')]

    const { code, stdout } = await setup(['claude-code'])

    assert.equal(code, 0)
    assert.deepEqual([read('.mcp.json'), read('CLAUDE.md')], before)
    assert.match(stdout, /\.mcp\.json: already has the humancompiler MCP server/)
    assert.match(stdout, /CLAUDE\.md: already has the HumanCompiler guide/)
  })

  test('merges into existing files, keeping other servers, keys and text', async () => {
    const { dir, setup, read } = project()
    const other = { command: 'npx', args: ['other-server'] }
    writeFileSync(
      path.join(dir, '.mcp.json'),
      `${JSON.stringify({ $schema: 'x', mcpServers: { other } }, null, 4)}\n`,
    )
    writeFileSync(path.join(dir, 'CLAUDE.md'), '# My project\n\nUse pnpm.\n')

    const { code, stdout } = await setup(['claude-code'])

    assert.equal(code, 0)
    const config = JSON.parse(read('.mcp.json'))
    assert.deepEqual(config, { $schema: 'x', mcpServers: { other, humancompiler: ENTRY } })
    assert.match(read('.mcp.json'), /^ {4}"\$schema"/m, 'keeps the 4-space indent')
    assert.match(read('CLAUDE.md'), /^# My project\n\nUse pnpm\.\n\n<!-- humancompiler:begin/)
    assert.match(stdout, /\.mcp\.json: added the humancompiler MCP server/)
    assert.match(stdout, /CLAUDE\.md: added the HumanCompiler guide/)
  })

  test('will not replace a different humancompiler entry without --force', async () => {
    const { dir, setup, read } = project()
    const old = { type: 'http', url: 'https://old.example.com/mcp', headers: { Authorization: `Bearer ${SECRET}` } }
    writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { humancompiler: old } }))
    const before = read('.mcp.json')

    const refused = await setup(['claude-code'])

    assert.equal(refused.code, 1)
    assert.match(
      refused.stderr,
      /Nothing was changed, because setup would replace:\n- mcpServers\.humancompiler is already set, with a different url, headers\n/,
    )
    assert.ok(!refused.stderr.includes(SECRET), 'never prints the old token')
    assert.match(refused.stderr, /--force/)
    assert.equal(read('.mcp.json'), before)
    assert.equal(existsSync(path.join(dir, 'CLAUDE.md')), false, 'writes nothing when refusing')

    const forced = await setup(['claude-code', '--force'])

    assert.equal(forced.code, 0, forced.stderr)
    assert.deepEqual(JSON.parse(read('.mcp.json')).mcpServers.humancompiler, ENTRY)
    assert.match(forced.stdout, /\.mcp\.json: updated the humancompiler MCP server/)
  })

  test('refreshes an edited guide only with --force, leaving the rest of the file', async () => {
    const { dir, setup, read } = project()
    await setup(['claude-code'])
    writeFileSync(
      path.join(dir, 'CLAUDE.md'),
      `# Top\n\n${read('CLAUDE.md').replace('## HumanCompiler', '## HumanCompiler (old)')}\nBottom\n`,
    )

    const refused = await setup(['claude-code'])
    assert.equal(refused.code, 1)
    assert.match(refused.stderr, /the HumanCompiler guide in .*CLAUDE\.md differs/)

    const forced = await setup(['claude-code', '--force'])
    assert.equal(forced.code, 0)
    const guide = read('CLAUDE.md')
    assert.match(guide, /^# Top\n\n<!-- humancompiler:begin/)
    assert.match(guide, /<!-- humancompiler:end -->\n\nBottom\n$/)
    assert.doesNotMatch(guide, /\(old\)/)
    assert.equal(guide.match(BEGIN).length, 1)
  })

  test('stops on a .mcp.json that is not JSON', async () => {
    const { dir, setup, read } = project()
    writeFileSync(path.join(dir, '.mcp.json'), '{ "mcpServers": ')
    const { code, stderr } = await setup(['claude-code', '--force'])
    assert.equal(code, 1)
    assert.match(stderr, /\.mcp\.json is not valid JSON/)
    assert.equal(read('.mcp.json'), '{ "mcpServers": ')
  })

  test('--no-guide, --guide-file, --dir and --api-url', async () => {
    const { dir, setup } = project()
    const sub = path.join(dir, 'app')
    mkdirSync(sub)

    const noGuide = await setup(['claude-code', '--dir', sub, '--no-guide'])
    assert.equal(noGuide.code, 0)
    assert.equal(existsSync(path.join(sub, 'CLAUDE.md')), false)

    const custom = await setup([
      'claude-code', '--dir', sub, '--guide-file', 'docs/AGENT.md', '--api-url', 'http://localhost:8000', '--force',
    ])
    assert.equal(custom.code, 0, custom.stderr)
    assert.ok(existsSync(path.join(sub, 'docs', 'AGENT.md')))
    const config = JSON.parse(readFileSync(path.join(sub, '.mcp.json'), 'utf8'))
    assert.equal(config.mcpServers.humancompiler.url, 'http://localhost:8000/mcp')
  })

  test('ignores HUMANCOMPILER_API_URL, so a dev URL does not land in a committed file', async () => {
    const { setup, read } = project()
    await setup(['claude-code'], { HUMANCOMPILER_API_URL: 'http://localhost:8000' })
    assert.equal(JSON.parse(read('.mcp.json')).mcpServers.humancompiler.url, MCP_URL)
  })

  test('rejects http to another host and unknown agents', async () => {
    const { setup } = project()
    const http = await setup(['claude-code', '--api-url', 'http://api.example.com'])
    assert.equal(http.code, 1)
    assert.match(http.stderr, /use https/)

    const unknown = await setup(['cursor'])
    assert.equal(unknown.code, 2)
    assert.match(unknown.stderr, /Unknown agent cursor: give claude-code or codex/)

    const none = await setup([])
    assert.equal(none.code, 2)
  })
})

describe('setup codex', () => {
  test('creates ~/.codex/config.toml and AGENTS.md without the token', async () => {
    const { dir, setup, read, codexConfig } = project()
    const { code, stdout, stderr } = await setup(['codex'])

    assert.equal(code, 0, stderr)
    assert.equal(readFileSync(codexConfig, 'utf8'), `${CODEX_BLOCK}\n`)
    assert.match(read('AGENTS.md'), /npx humancompiler roadmap/)
    assert.equal(existsSync(path.join(dir, 'CLAUDE.md')), false)
    assert.equal(existsSync(path.join(dir, '.mcp.json')), false)
    assert.ok(!readFileSync(codexConfig, 'utf8').includes(SECRET))
    assert.match(stdout, /config\.toml: created with the \[mcp_servers\.humancompiler\]/)
  })

  test('uses $CODEX_HOME when set', async () => {
    const { setup, codexConfig } = project()
    const codexHome = tempDir('codex-')
    const { code } = await setup(['codex', '--no-guide'], { CODEX_HOME: codexHome })
    assert.equal(code, 0)
    assert.ok(existsSync(path.join(codexHome, 'config.toml')))
    assert.equal(existsSync(codexConfig), false)
  })

  test('appends to an existing config, keeping comments and other tables, and is idempotent', async () => {
    const { setup, codexConfig } = project()
    mkdirSync(path.dirname(codexConfig), { recursive: true })
    const existing = `# my settings\nmodel = "gpt-5"\n\n[mcp_servers.other]\ncommand = "npx"\nargs = ["other"]  # keep\n`
    writeFileSync(codexConfig, existing)

    const first = await setup(['codex', '--no-guide'])
    assert.equal(first.code, 0, first.stderr)
    const after = readFileSync(codexConfig, 'utf8')
    assert.equal(after, `${existing}\n${CODEX_BLOCK}\n`)

    const second = await setup(['codex', '--no-guide'])
    assert.equal(second.code, 0)
    assert.equal(readFileSync(codexConfig, 'utf8'), after)
    assert.match(second.stdout, /already has the \[mcp_servers\.humancompiler\]/)
  })

  test('accepts an equivalent existing table with other settings as unchanged', async () => {
    const { setup, codexConfig } = project()
    mkdirSync(path.dirname(codexConfig), { recursive: true })
    const existing = `[mcp_servers.humancompiler]\nbearer_token_env_var = 'HUMANCOMPILER_TOKEN'\nurl = "${MCP_URL}" # hosted\nstartup_timeout_sec = 20\n`
    writeFileSync(codexConfig, existing)

    const { code, stdout } = await setup(['codex', '--no-guide'])
    assert.equal(code, 0)
    assert.equal(readFileSync(codexConfig, 'utf8'), existing)
    assert.match(stdout, /already has/)
  })

  test('replaces a different table only with --force, keeping its other settings', async () => {
    const { setup, codexConfig } = project()
    mkdirSync(path.dirname(codexConfig), { recursive: true })
    const existing = [
      'model = "gpt-5"',
      '',
      '[mcp_servers.humancompiler]',
      'url = "https://old.example.com/mcp"',
      `bearer_token = "${SECRET}"`,
      'tool_timeout_sec = 90',
      '',
      '[mcp_servers.humancompiler.tools.find]',
      'enabled = true',
      '',
      '[profiles.fast]',
      'model = "gpt-5-mini"',
      '',
    ].join('\n')
    writeFileSync(codexConfig, existing)

    const refused = await setup(['codex', '--no-guide'])
    assert.equal(refused.code, 1)
    assert.match(refused.stderr, /\[mcp_servers\.humancompiler\] is already set, with url, bearer_token\n/)
    assert.ok(!refused.stderr.includes(SECRET), 'never prints the old token')
    assert.equal(readFileSync(codexConfig, 'utf8'), existing)

    const forced = await setup(['codex', '--no-guide', '--force'])
    assert.equal(forced.code, 0, forced.stderr)
    assert.equal(
      readFileSync(codexConfig, 'utf8'),
      [
        'model = "gpt-5"',
        '',
        CODEX_BLOCK,
        'tool_timeout_sec = 90',
        '',
        '[mcp_servers.humancompiler.tools.find]',
        'enabled = true',
        '',
        '[profiles.fast]',
        'model = "gpt-5-mini"',
        '',
      ].join('\n'),
    )
  })

  test('stops on a server defined in a form it does not edit', async () => {
    const { setup, codexConfig } = project()
    mkdirSync(path.dirname(codexConfig), { recursive: true })
    for (const existing of [
      '[mcp_servers]\nhumancompiler = { url = "x" }\n',
      `mcp_servers.humancompiler.bearer_token = "${SECRET}"\n`,
    ]) {
      writeFileSync(codexConfig, existing)
      const { code, stderr } = await setup(['codex', '--no-guide', '--force'])
      assert.equal(code, 1)
      assert.match(stderr, /in a form setup does not edit/)
      assert.ok(!stderr.includes(SECRET))
      assert.equal(readFileSync(codexConfig, 'utf8'), existing)
    }
  })

  test('stops rather than half-remove a setting that spans lines', async () => {
    const { setup, codexConfig } = project()
    mkdirSync(path.dirname(codexConfig), { recursive: true })
    for (const [existing, key] of [
      ['[mcp_servers.humancompiler]\ncommand = "npx"\nargs = [\n  "old-server",\n]\n', 'args'],
      ['[mcp_servers.humancompiler]\nurl = """\nhttps://old.example.com/mcp"""\n', 'url'],
      [`[mcp_servers.humancompiler]\nbearer_token = \'\'\'\n${SECRET}\'\'\'\n`, 'bearer_token'],
      ['[mcp_servers.humancompiler]\nhttp_headers = {\n}\n', 'http_headers'],
    ]) {
      writeFileSync(codexConfig, existing)
      const { code, stderr } = await setup(['codex', '--no-guide', '--force'])
      assert.equal(code, 1, existing)
      assert.match(stderr, new RegExp(`: ${key} in \\[mcp_servers\\.humancompiler\\] spans lines\\.`))
      assert.ok(!stderr.includes(SECRET))
      assert.equal(readFileSync(codexConfig, 'utf8'), existing)
    }
  })

  test('replaces single-line triple-quoted values', async () => {
    const { setup, codexConfig } = project()
    mkdirSync(path.dirname(codexConfig), { recursive: true })
    writeFileSync(codexConfig, '[mcp_servers.humancompiler]\nurl = """https://old.example.com/mcp"""\n')
    const { code, stderr } = await setup(['codex', '--no-guide', '--force'])
    assert.equal(code, 0, stderr)
    assert.equal(readFileSync(codexConfig, 'utf8'), `${CODEX_BLOCK}\n`)
  })

  test('adds the guide to an AGENTS.md shared with Claude Code setup only once', async () => {
    const { setup, read } = project()
    await setup(['codex'])
    await setup(['claude-code', '--guide-file', 'AGENTS.md'])
    assert.equal(read('AGENTS.md').match(BEGIN).length, 1)
  })
})
