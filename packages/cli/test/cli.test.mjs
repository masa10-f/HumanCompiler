// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

// Tests for the `humancompiler` entry point: help, version and dispatch.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { PACKAGE_JSON, run } from './helpers.mjs'

describe('help', () => {
  test('--help lists every command', async () => {
    const { code, stdout } = await run(['--help'])
    assert.equal(code, 0)
    assert.match(stdout, /^Usage: humancompiler <command>/)
    for (const command of ['roadmap', 'context', 'setup', 'doctor']) {
      assert.match(stdout, new RegExp(`^  ${command} `, 'm'))
    }
  })

  for (const [command, usage] of [
    ['roadmap', /^Usage: humancompiler roadmap <project-id>/],
    ['context', /^Usage: humancompiler context <project\|goal> <id>/],
    ['setup', /^Usage: humancompiler setup <claude-code\|codex>/],
    ['doctor', /^Usage: humancompiler doctor/],
  ]) {
    test(`${command} --help shows the command's usage`, async () => {
      const { code, stdout } = await run([command, '--help'])
      assert.equal(code, 0)
      assert.match(stdout, usage)
    })

    test(`help ${command} is the same as ${command} --help`, async () => {
      const [a, b] = await Promise.all([run(['help', command]), run([command, '--help'])])
      assert.equal(a.stdout, b.stdout)
    })
  }

  test('no arguments prints the help and exits with 2', async () => {
    const { code, stdout, stderr } = await run([])
    assert.equal(code, 2)
    assert.equal(stdout, '')
    assert.match(stderr, /^Usage: humancompiler <command>/)
  })
})

test('--version prints the package version, not the surrounding project\'s', async () => {
  const { version } = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'))
  for (const flag of ['--version', '-v']) {
    const { code, stdout } = await run([flag], { npm_package_version: '9.9.9' })
    assert.equal(code, 0)
    assert.equal(stdout.trim(), version)
  }
})

test('rejects an unknown command', async () => {
  const { code, stderr } = await run(['draw', 'project-1'])
  assert.equal(code, 2)
  assert.match(stderr, /^humancompiler: Unknown command draw\. Commands: roadmap, context, setup, doctor\./)
})

test('names the command in errors', async () => {
  const { code, stderr } = await run(['context', 'project', 'p1', '--bogus'])
  assert.equal(code, 2)
  assert.match(stderr, /^humancompiler context: Unknown option '--bogus'/)
})

test('the package is published as humancompiler with one bin', () => {
  const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'))
  assert.equal(pkg.name, 'humancompiler')
  assert.deepEqual(pkg.bin, { humancompiler: 'dist/cli.js' })
  // Trusted publishing checks that this matches the repository exactly.
  assert.equal(pkg.repository.url, 'git+https://github.com/masa10-f/HumanCompiler.git')
})
