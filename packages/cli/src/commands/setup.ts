// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/**
 * `humancompiler setup <claude-code|codex>`: connects a coding agent to the
 * HumanCompiler MCP server and adds a short usage guide for the agent.
 *
 * - Claude Code: the project's `.mcp.json` and `CLAUDE.md`.
 * - Codex: `~/.codex/config.toml` (or `$CODEX_HOME/config.toml`) and the
 *   project's `AGENTS.md`.
 *
 * The token itself is never written: the configs name the
 * HUMANCOMPILER_TOKEN variable, and each client reads it when it starts.
 * Existing files are merged, not replaced, and running setup again changes
 * nothing. Replacing a different existing entry needs --force (or a yes at
 * the prompt when run in a terminal). Every change is planned before any
 * file is written, so a refusal leaves all files as they were.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'
import { CliError, DEFAULT_API_URL, TOKEN_ENV, validateApiUrl } from '../api'
import { usageError } from '../args'

export const SERVER_NAME = 'humancompiler'
const MCP_PATH = '/mcp'

export const SETUP_HELP = `Usage: humancompiler setup <claude-code|codex> [options]

Connects a coding agent to the HumanCompiler MCP server, and adds a short
guide for the agent (finding ids, the roadmap and context commands).

  claude-code   Adds the server to the project's .mcp.json, and the guide to
                CLAUDE.md.
  codex         Adds [mcp_servers.${SERVER_NAME}] to ~/.codex/config.toml
                (or $CODEX_HOME/config.toml), and the guide to AGENTS.md.

The token is never written to a file. The configs name the ${TOKEN_ENV}
environment variable, which the agent reads when it starts. Existing files
are merged, and running setup again changes nothing.

Options:
  --dir <path>          Project directory for .mcp.json and the guide
                        (default: the current directory).
  --guide-file <file>   Write the guide to this file instead of CLAUDE.md /
                        AGENTS.md (relative to --dir).
  --no-guide            Do not add the guide.
  --api-url <url>       API base URL (default: ${DEFAULT_API_URL}).
                        The MCP server is <url>${MCP_PATH}.
  --force               Replace an existing ${SERVER_NAME} entry or guide that
                        differs from this version's, without asking.
  -h, --help            Show this help.
`

type Client = 'claude-code' | 'codex'
const CLIENTS: readonly Client[] = ['claude-code', 'codex']

export const GUIDE_BODY = `## HumanCompiler

The user's tasks are managed in HumanCompiler, connected as the \`${SERVER_NAME}\` MCP server. Its agent token is in the \`${TOKEN_ENV}\` environment variable: never print it, pass it as an argument or write it to a file.

- Find the id of a project or goal with the MCP tool \`find\`.
- Roadmap and schedule: run \`npx humancompiler@0 roadmap <project-id> --goals-per-page 20\`. Read the printed summary first (projected dates, delays, what each goal waits on). Open the images (\`roadmap-1.png\`, ...) only when the picture itself helps, for example to show the user.
- Background before working on a project or goal, or for a report: run \`npx humancompiler@0 context <project|goal> <id> -o <file>.md\` to get its notes, tasks and work history as one Markdown file, then read the parts you need. Keep the file out of commits.
- If a command fails, run \`npx humancompiler@0 doctor\` and follow its hints.`

/**
 * Short hash of a guide body. The begin marker carries the hash of the body
 * setup wrote, so a later version can tell a block nobody edited (refresh it
 * without asking) from one the user changed (ask first).
 */
export function guideHash(body: string): string {
  return createHash('sha256').update(body).digest('hex').slice(0, 16)
}

export const GUIDE_BEGIN = `<!-- humancompiler:begin sha256=${guideHash(GUIDE_BODY)} (added by \`npx humancompiler setup\`; edits inside these markers may be replaced) -->`
export const GUIDE_END = '<!-- humancompiler:end -->'
const GUIDE_BEGIN_PREFIX = '<!-- humancompiler:begin'

// --- Planning ----------------------------------------------------------------

type Outcome = 'created' | 'added' | 'updated' | 'unchanged'

interface Change {
  file: string
  label: string
  outcome: Outcome
  /** The new content, unless unchanged. */
  content?: string
  /** Why this change replaces something that is there now. */
  conflict?: string
}

function readText(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8')
  } catch (error) {
    // ENOTDIR: a parent is a file, so this file cannot exist either.
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return undefined
    throw new CliError(`Could not read ${file}: ${(error as Error).message}`)
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sameJson(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => sameJson(item, b[i]))
    )
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a)
    return (
      keys.length === Object.keys(b).length && keys.every((key) => sameJson(a[key], b[key]))
    )
  }
  return a === b
}

/**
 * Names (never values) of the fields that differ, for messages: an existing
 * entry may hold a literal token, which must not reach a terminal or an
 * agent's transcript.
 */
function differingKeys(current: unknown, wanted: Record<string, unknown>): string {
  if (!isPlainObject(current)) return 'value (not an object)'
  const keys = [...new Set([...Object.keys(current), ...Object.keys(wanted)])].filter(
    (key) => !sameJson(current[key], wanted[key]),
  )
  return keys.length > 0 ? keys.join(', ') : 'value'
}

export function claudeServerEntry(mcpUrl: string) {
  return {
    type: 'http',
    url: mcpUrl,
    headers: { Authorization: `Bearer \${${TOKEN_ENV}}` },
  }
}

/** Adds the server to `.mcp.json`, keeping every other server and key. */
export function planMcpJson(file: string, mcpUrl: string): Change {
  const label = 'humancompiler MCP server'
  const entry = claudeServerEntry(mcpUrl)
  const text = readText(file)
  if (text === undefined || text.trim() === '') {
    const content = `${JSON.stringify({ mcpServers: { [SERVER_NAME]: entry } }, null, 2)}\n`
    return { file, label, outcome: text === undefined ? 'created' : 'added', content }
  }

  let config: unknown
  try {
    config = JSON.parse(text)
  } catch (error) {
    throw new CliError(
      `${file} is not valid JSON (${(error as Error).message}). Fix it, then run setup again.`,
    )
  }
  if (!isPlainObject(config)) throw new CliError(`${file} does not hold a JSON object.`)
  const servers = config.mcpServers ?? {}
  if (!isPlainObject(servers)) throw new CliError(`mcpServers in ${file} is not an object.`)

  const current = servers[SERVER_NAME]
  if (sameJson(current, entry)) return { file, label, outcome: 'unchanged' }

  // Keep the file's indentation (2 spaces, 4 spaces or tabs).
  const indent = /^([ \t]+)"/m.exec(text)?.[1] ?? 2
  const next = { ...config, mcpServers: { ...servers, [SERVER_NAME]: entry } }
  const content = `${JSON.stringify(next, null, indent)}\n`
  if (current === undefined) return { file, label, outcome: 'added', content }
  return {
    file,
    label,
    outcome: 'updated',
    content,
    conflict: `mcpServers.${SERVER_NAME} is already set, with a different ${differingKeys(current, entry)}`,
  }
}

export const TOML_HEADER = new RegExp(
  String.raw`^\s*\[\s*mcp_servers\s*\.\s*(?:${SERVER_NAME}|"${SERVER_NAME}"|'${SERVER_NAME}')\s*\]\s*(?:#.*)?$`,
)
const TOML_ANY_HEADER = /^\s*\[/
const TOML_MCP_SERVERS_HEADER = /^\s*\[\s*mcp_servers\s*\]\s*(?:#.*)?$/
// Other ways TOML could define the same server, which this tool does not edit:
// dotted keys (`mcp_servers.humancompiler.url = ...`) and, under
// [mcp_servers], `humancompiler = { ... }`. Subtables such as
// [mcp_servers.humancompiler.env] or .tools.* are left alone; the header
// subtables are not (TOML_HEADER_SUBTABLE).
const TOML_DOTTED = new RegExp(String.raw`^\s*mcp_servers\s*\.\s*["']?${SERVER_NAME}["']?\s*[.=]`)
const TOML_BARE_KEY = new RegExp(String.raw`^\s*["']?${SERVER_NAME}["']?\s*[.=]`)
// `mcp_servers = { ... }` at the top level: appending a table would define
// mcp_servers twice and make the whole file invalid.
const TOML_ROOT_MCP_SERVERS = /^\s*["']?mcp_servers["']?\s*=/
// Header subtables that send other headers (possibly a literal token) along
// with the bearer token. setup cannot tell what they hold, so it stops.
const TOML_HEADER_SUBTABLE = new RegExp(
  String.raw`^\s*\[\s*mcp_servers\s*\.\s*["']?${SERVER_NAME}["']?\s*\.\s*["']?(http_headers|env_http_headers)["']?\s*\]`,
)

/** The key a `key = value` line sets, for messages that must not show values. */
function tomlKey(line: string): string {
  return /^\s*([^=]+?)\s*=/.exec(line)?.[1] ?? 'a setting'
}

function tomlString(value: string): string {
  return JSON.stringify(value)
}

function codexBlock(mcpUrl: string): string[] {
  return [
    `[mcp_servers.${SERVER_NAME}]`,
    `url = ${tomlString(mcpUrl)}`,
    `bearer_token_env_var = ${tomlString(TOKEN_ENV)}`,
  ]
}

/** Value of a `key = "string"` (or 'literal') line, if the line sets that key. */
function tomlStringValue(line: string, key: string): string | null | undefined {
  // Keys may be bare or quoted ("url" = ...); both name the same key.
  const match = new RegExp(String.raw`^\s*(?:${key}|"${key}"|'${key}')\s*=\s*(.*?)\s*$`).exec(line)
  if (!match) return undefined
  const raw = match[1]!.replace(/\s+#.*$/, '')
  const basic = /^"((?:[^"\\]|\\.)*)"$/.exec(raw)
  if (basic) {
    try {
      return JSON.parse(`"${basic[1]}"`) as string
    } catch {
      return null
    }
  }
  const literal = /^'([^']*)'$/.exec(raw)
  return literal ? literal[1]! : null
}

/**
 * Adds `[mcp_servers.humancompiler]` to Codex's config.toml. Edits lines
 * rather than re-serializing, so the user's comments and layout stay.
 */
export function planCodexToml(file: string, mcpUrl: string): Change {
  const label = `[mcp_servers.${SERVER_NAME}]`
  const block = codexBlock(mcpUrl)
  const text = readText(file)
  if (text === undefined || text.trim() === '') {
    return {
      file,
      label,
      outcome: text === undefined ? 'created' : 'added',
      content: `${block.join('\n')}\n`,
    }
  }

  const lines = text.split(/\r?\n/)
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  let inMcpServers = false
  let beforeFirstHeader = true
  for (const line of lines) {
    if (TOML_ANY_HEADER.test(line)) {
      inMcpServers = TOML_MCP_SERVERS_HEADER.test(line)
      beforeFirstHeader = false
    }
    if (beforeFirstHeader && TOML_ROOT_MCP_SERVERS.test(line)) {
      throw new CliError(
        `${file} sets mcp_servers as an inline table (mcp_servers = ...), which setup does not edit. ` +
          `Add the server by hand:\n\n${block.join('\n')}`,
      )
    }
    const subtable = TOML_HEADER_SUBTABLE.exec(line)
    if (subtable) {
      throw new CliError(
        `${file} has [mcp_servers.${SERVER_NAME}.${subtable[1]}], which sends other headers with the token. ` +
          `Remove it, then run setup again, or set the server by hand:\n\n${block.join('\n')}`,
      )
    }
    if (TOML_DOTTED.test(line) || (inMcpServers && TOML_BARE_KEY.test(line))) {
      throw new CliError(
        `${file} defines the ${SERVER_NAME} server in a form setup does not edit (${tomlKey(line)} = ...). ` +
          `Set it by hand:\n\n${block.join('\n')}`,
      )
    }
  }

  const start = lines.findIndex((line) => TOML_HEADER.test(line))
  if (start === -1) {
    const body = text.replace(/(\r?\n)*$/, '')
    return {
      file,
      label,
      outcome: 'added',
      content: `${body}${eol}${eol}${block.join(eol)}${eol}`,
    }
  }
  if (lines.findIndex((line, i) => i > start && TOML_HEADER.test(line)) !== -1) {
    throw new CliError(`${file} has [mcp_servers.${SERVER_NAME}] twice. Fix it by hand.`)
  }

  let end = lines.findIndex((line, i) => i > start && TOML_ANY_HEADER.test(line))
  if (end === -1) end = lines.length
  const table = lines.slice(start + 1, end)
  const settings = table.filter((line) => line.trim() !== '' && !line.trim().startsWith('#'))
  const urlValue = settings.map((line) => tomlStringValue(line, 'url')).find((v) => v !== undefined)
  const envValue = settings
    .map((line) => tomlStringValue(line, 'bearer_token_env_var'))
    .find((v) => v !== undefined)
  // Keys that would send another token or start a local server instead.
  const clashing = settings.filter((line) =>
    // Also dotted keys such as http_headers.Authorization = "...".
    /^\s*(["']?)(bearer_token|command|args|http_headers|env_http_headers)\1\s*[.=]/.test(line),
  )
  if (urlValue === mcpUrl && envValue === TOKEN_ENV && clashing.length === 0) {
    return { file, label, outcome: 'unchanged' }
  }

  // Every setting this replaces: url, bearer_token_env_var and the clashing keys.
  const removed = table.filter(
    (line) =>
      tomlStringValue(line, 'url') !== undefined ||
      tomlStringValue(line, 'bearer_token_env_var') !== undefined ||
      clashing.includes(line),
  )
  // Removing a value that spans lines (a multi-line array, inline table or
  // string) one line at a time would break the file.
  const multiLine = removed.find((line) => {
    const count = (pattern: RegExp) => (line.match(pattern) ?? []).length
    return (
      count(/\[/g) !== count(/\]/g) ||
      count(/\{/g) !== count(/\}/g) ||
      count(/"""/g) % 2 === 1 ||
      count(/'''/g) % 2 === 1
    )
  })
  if (multiLine !== undefined) {
    throw new CliError(
      `${file}: ${tomlKey(multiLine)} in [mcp_servers.${SERVER_NAME}] spans lines. ` +
        `Replace the table by hand with:\n\n${block.join('\n')}`,
    )
  }

  // Keep the table's other settings (timeouts, enabled, ...) and its comments.
  const kept = table.filter((line) => !removed.includes(line))
  // Drop blank lines left between the header and the next kept setting, but
  // not the file's final newline when the table ends the file.
  while (kept[0]?.trim() === '' && kept.slice(1).some((line) => line.trim() !== '')) {
    kept.shift()
  }
  const next = [...lines.slice(0, start), ...block, ...kept, ...lines.slice(end)]
  return {
    file,
    label,
    outcome: 'updated',
    content: next.join(eol),
    // Key names only: a bearer_token line holds a literal token.
    conflict: `${label} is already set, with ${removed.map(tomlKey).join(', ')}`,
  }
}

/** Adds or refreshes the guide between the markers, leaving the rest alone. */
export function planGuide(file: string): Change {
  const label = 'HumanCompiler guide'
  const section = `${GUIDE_BEGIN}\n${GUIDE_BODY}\n${GUIDE_END}`
  const text = readText(file)
  if (text === undefined || text.trim() === '') {
    return { file, label, outcome: text === undefined ? 'created' : 'added', content: `${section}\n` }
  }

  const begin = text.indexOf(GUIDE_BEGIN_PREFIX)
  if (begin === -1) {
    const eol = text.includes('\r\n') ? '\r\n' : '\n'
    const body = text.replace(/(\r?\n)*$/, '')
    return {
      file,
      label,
      outcome: 'added',
      content: `${body}${eol}${eol}${section.replaceAll('\n', eol)}${eol}`,
    }
  }
  if (text.indexOf(GUIDE_BEGIN_PREFIX, begin + 1) !== -1) {
    throw new CliError(`${file} has the HumanCompiler guide markers twice. Remove one copy.`)
  }
  const endMarker = text.indexOf(GUIDE_END, begin)
  if (endMarker === -1) {
    throw new CliError(
      `${file} has the start of the HumanCompiler guide but not its end (${GUIDE_END}). Fix it by hand.`,
    )
  }
  const end = endMarker + GUIDE_END.length
  const current = text.slice(begin, end).replaceAll('\r\n', '\n')
  if (current === section) return { file, label, outcome: 'unchanged' }
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const content = text.slice(0, begin) + section.replaceAll('\n', eol) + text.slice(end)

  // A block whose body still matches the hash in its marker was written by an
  // earlier version and never edited: refresh it without asking.
  const beginLine = current.slice(0, current.indexOf('\n') + 1 || current.length)
  const writtenHash = /^<!-- humancompiler:begin sha256=([0-9a-f]{16})\b/.exec(beginLine)?.[1]
  const body = current.slice(beginLine.length, current.length - GUIDE_END.length).replace(/\n$/, '')
  if (writtenHash !== undefined && guideHash(body) === writtenHash) {
    return { file, label, outcome: 'updated', content }
  }
  return {
    file,
    label,
    outcome: 'updated',
    content,
    conflict: `the HumanCompiler guide in ${file} was edited, or differs from this version's`,
  }
}

// --- Running -----------------------------------------------------------------

export function codexConfigPath(): string {
  const codexHome = process.env.CODEX_HOME?.trim()
  return path.join(codexHome || path.join(homedir(), '.codex'), 'config.toml')
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  try {
    const answer = await rl.question(`${question} [y/N] `)
    return /^y(es)?$/i.test(answer.trim())
  } finally {
    rl.close()
  }
}

const OUTCOME_TEXT: Record<Outcome, string> = {
  created: 'created with the',
  added: 'added the',
  updated: 'updated the',
  unchanged: 'already has the',
}

export async function setup(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    allowNegative: true,
    options: {
      dir: { type: 'string' },
      'guide-file': { type: 'string' },
      guide: { type: 'boolean', default: true },
      'api-url': { type: 'string' },
      force: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })
  if (values.help) {
    process.stdout.write(SETUP_HELP)
    return
  }
  if (positionals.length !== 1) throw usageError('Give claude-code or codex.', SETUP_HELP)
  const client = positionals[0] as Client
  if (!CLIENTS.includes(client)) {
    throw usageError(`Unknown agent ${positionals[0]}: give claude-code or codex.`, SETUP_HELP)
  }

  // Only the option or the hosted API: the .mcp.json is often committed, so a
  // development URL from the environment should not slip into it.
  const mcpUrl = `${validateApiUrl(values['api-url'] ?? DEFAULT_API_URL)}${MCP_PATH}`
  const dir = path.resolve(values.dir ?? '.')
  if (!existsSync(dir)) throw new CliError(`${dir} does not exist`)

  const changes: Change[] = [
    client === 'claude-code'
      ? planMcpJson(path.join(dir, '.mcp.json'), mcpUrl)
      : planCodexToml(codexConfigPath(), mcpUrl),
  ]
  if (values.guide) {
    const guideFile = values['guide-file'] ?? (client === 'claude-code' ? 'CLAUDE.md' : 'AGENTS.md')
    changes.push(planGuide(path.resolve(dir, guideFile)))
  }

  const conflicts = changes.filter((change) => change.conflict)
  if (conflicts.length > 0 && !values.force) {
    const details = conflicts.map((change) => `- ${change.conflict}`).join('\n')
    const interactive = process.stdin.isTTY && process.stderr.isTTY
    if (!interactive) {
      throw new CliError(`Nothing was changed, because setup would replace:\n${details}\nRun again with --force to replace it.`)
    }
    process.stderr.write(`Setup would replace:\n${details}\n`)
    if (!(await confirm('Replace it?'))) throw new CliError('Nothing was changed.')
  }

  const written: string[] = []
  for (const change of changes) {
    if (change.content === undefined) continue
    try {
      mkdirSync(path.dirname(change.file), { recursive: true })
      writeFileSync(change.file, change.content)
    } catch (error) {
      const done = written.length > 0 ? ` Already written: ${written.join(', ')}.` : ''
      throw new CliError(`Could not write ${change.file}: ${(error as Error).message}.${done}`)
    }
    written.push(change.file)
  }
  for (const change of changes) {
    process.stdout.write(`${change.file}: ${OUTCOME_TEXT[change.outcome]} ${change.label}\n`)
  }

  const next =
    client === 'claude-code'
      ? [
          `Claude Code reads ${TOKEN_ENV} from the environment each time it loads .mcp.json,`,
          'so set it in the shell that starts Claude Code. Claude Code asks you to approve',
          'the project server the first time; check it with /mcp.',
        ]
      : [
          `Codex reads ${TOKEN_ENV} from the environment when it starts, so set it in the`,
          'shell that starts Codex. Check the server with /mcp in Codex.',
        ]
  process.stdout.write(
    `\nNext:\n- Put an agent token in ${TOKEN_ENV} (Settings > Agent tokens in HumanCompiler).\n` +
      `- ${next.join('\n  ')}\n- Run \`npx humancompiler doctor\` to check the token and its scopes.\n`,
  )
}
