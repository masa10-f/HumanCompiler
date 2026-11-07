// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/**
 * `humancompiler doctor`: checks what the other subcommands need and says
 * how to fix what is missing. Exits non-zero when something is.
 *
 * Reachability is checked with GET /health, which needs no token. Only the
 * one GET /me that follows can count against the API's per-IP limit on
 * failed authentications.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import {
  API_URL_ENV,
  type AgentMe,
  COMMAND_SCOPES,
  CliError,
  DEFAULT_API_URL,
  TOKEN_ENV,
  readToken,
  request,
  validateApiUrl,
} from '../api'
import { SUPPORTED_NODE, nodeVersionOk, usageError } from '../args'
import { SERVER_NAME, TOML_HEADER, codexConfigPath } from './setup'

export const DOCTOR_HELP = `Usage: humancompiler doctor [roadmap|context ...] [options]

Checks Node.js, the ${TOKEN_ENV} token, that the API answers, and that the
token is valid and has the scopes each subcommand needs. Prints how to fix
what is missing, and exits with 1 if anything is.

Give subcommand names to check only their scopes (default: all of them).

Options:
  --api-url <url>   API base URL (default: $${API_URL_ENV} or
                    ${DEFAULT_API_URL}).
  -h, --help        Show this help.
`

type ScopedCommand = keyof typeof COMMAND_SCOPES
const SCOPED_COMMANDS = Object.keys(COMMAND_SCOPES) as ScopedCommand[]

const NEW_TOKEN_HINT =
  'Scopes are fixed when a token is created. Create a new token under Settings > Agent tokens ' +
  'with a preset that includes them (the read and agent presets include every read scope), ' +
  `and put it in ${TOKEN_ENV}.`

interface Report {
  failed: boolean
  out: string[]
}

function pass(report: Report, text: string): void {
  report.out.push(`[ok]   ${text}`)
}

function fail(report: Report, text: string, fix: string): void {
  report.failed = true
  report.out.push(`[fail] ${text}`, `       Fix: ${fix}`)
}

function info(report: Report, text: string): void {
  report.out.push(`[info] ${text}`)
}

/** Whether `setup` has been run here, for information only. */
function setupStatus(report: Report): void {
  const mcpJson = path.resolve('.mcp.json')
  try {
    const config = JSON.parse(readFileSync(mcpJson, 'utf8')) as {
      mcpServers?: Record<string, unknown>
    }
    if (config.mcpServers?.[SERVER_NAME]) info(report, `Claude Code: ${mcpJson} has the ${SERVER_NAME} server`)
    else info(report, `Claude Code: ${mcpJson} has no ${SERVER_NAME} server (humancompiler setup claude-code)`)
  } catch {
    info(report, 'Claude Code: no .mcp.json here (humancompiler setup claude-code)')
  }
  const codex = codexConfigPath()
  try {
    const text = readFileSync(codex, 'utf8')
    // The same header test setup uses, so the two never disagree.
    const configured = text.split(/\r?\n/).some((line) => TOML_HEADER.test(line))
    info(
      report,
      configured
        ? `Codex: ${codex} has [mcp_servers.${SERVER_NAME}]`
        : `Codex: ${codex} has no [mcp_servers.${SERVER_NAME}] (humancompiler setup codex)`,
    )
  } catch {
    info(report, `Codex: no ${codex} (humancompiler setup codex)`)
  }
}

async function checkApi(report: Report, apiUrl: string): Promise<boolean> {
  try {
    const response = await request(apiUrl, '/health')
    if (response.ok) {
      pass(report, `The API at ${apiUrl} answers`)
      return true
    }
    if (response.status === 503) {
      fail(
        report,
        `The API at ${apiUrl} answers but reports it is unavailable (503)`,
        'Try again in a few minutes.',
      )
    } else {
      fail(
        report,
        `${apiUrl}/health returned ${response.status}; this may not be the HumanCompiler API`,
        `Check --api-url or ${API_URL_ENV} (unset it to use ${DEFAULT_API_URL}).`,
      )
    }
  } catch (error) {
    fail(
      report,
      (error as Error).message,
      `Check your network connection, and --api-url or ${API_URL_ENV}.`,
    )
  }
  return false
}

async function checkToken(report: Report, apiUrl: string, token: string): Promise<AgentMe | undefined> {
  let response: Response
  try {
    response = await request(apiUrl, '/api/agent/v1/me', token)
  } catch (error) {
    fail(report, (error as Error).message, 'Check your network connection.')
    return undefined
  }
  if (response.ok) {
    try {
      const me = (await response.json()) as AgentMe
      if (Array.isArray(me?.scopes)) {
        pass(report, `The token "${me.token_name}" (${me.token_prefix}...) is valid`)
        info(report, `Scopes: ${me.scopes.length > 0 ? me.scopes.join(', ') : '(none)'}`)
        return me
      }
    } catch {
      // Reported below.
    }
    fail(report, `${apiUrl} did not answer /me as expected`, `Check --api-url or ${API_URL_ENV}.`)
    return undefined
  }
  switch (response.status) {
    case 401:
      fail(
        report,
        'The token was rejected: it is wrong, expired or revoked',
        `Create a new token under Settings > Agent tokens and put it in ${TOKEN_ENV}. ` +
          'Check that the whole token was copied.',
      )
      break
    case 429:
      fail(
        report,
        'The API is rate limiting this machine',
        (() => {
          const seconds = response.headers.get('retry-after')
          return `Wait ${seconds ? `${seconds} seconds` : 'a minute'} and run doctor again.`
        })(),
      )
      break
    default:
      fail(
        report,
        `GET /api/agent/v1/me returned ${response.status}`,
        `Check --api-url or ${API_URL_ENV}, and try again later.`,
      )
  }
  return undefined
}

export async function doctor(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      'api-url': { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })
  if (values.help) {
    process.stdout.write(DOCTOR_HELP)
    return
  }
  for (const name of positionals) {
    if (!SCOPED_COMMANDS.includes(name as ScopedCommand)) {
      throw usageError(`doctor checks the scopes of ${SCOPED_COMMANDS.join(' and ')}, not ${name}.`, DOCTOR_HELP)
    }
  }
  const commands = positionals.length > 0 ? (positionals as ScopedCommand[]) : SCOPED_COMMANDS

  const report: Report = { failed: false, out: [] }
  const node = process.versions.node
  if (nodeVersionOk(node)) pass(report, `Node.js ${node} (needs ${SUPPORTED_NODE})`)
  else {
    fail(
      report,
      `Node.js ${node} is not supported (needs ${SUPPORTED_NODE})`,
      'Install a current Node.js LTS (22 or later).',
    )
  }

  const token = readToken()
  if (token) pass(report, `${TOKEN_ENV} is set`)
  else {
    fail(
      report,
      `${TOKEN_ENV} is not set`,
      `Create an agent token under Settings > Agent tokens in HumanCompiler, and export it as ${TOKEN_ENV} ` +
        '(in your shell profile, or from a password manager). Do not pass it on the command line.',
    )
  }

  let apiUrl: string | undefined
  try {
    apiUrl = validateApiUrl(values['api-url'] || process.env[API_URL_ENV] || DEFAULT_API_URL)
  } catch (error) {
    fail(report, (error as CliError).message, `Fix --api-url or ${API_URL_ENV}, or unset it.`)
  }

  const reachable = apiUrl !== undefined && (await checkApi(report, apiUrl))
  const me = reachable && token ? await checkToken(report, apiUrl!, token) : undefined

  report.out.push('', 'Scopes by subcommand:')
  for (const command of commands) {
    const needed = COMMAND_SCOPES[command]
    if (!me) {
      report.out.push(`[skip] ${command}: needs ${needed.join(', ')} (not checked: no valid token)`)
      continue
    }
    const missing = needed.filter((scope) => !me.scopes.includes(scope))
    if (missing.length === 0) pass(report, `${command}: ${needed.join(', ')}`)
    else fail(report, `${command}: missing ${missing.join(', ')}`, NEW_TOKEN_HINT)
  }
  report.out.push('[ok]   setup: needs no scopes (the MCP tools use the token\'s scopes)')

  report.out.push('', 'Agent setup in this directory:')
  setupStatus(report)

  report.out.push('', report.failed ? 'Some checks failed; see the fixes above.' : 'All checks passed.')
  process.stdout.write(`${report.out.join('\n')}\n`)
  if (report.failed) process.exitCode = 1
}
