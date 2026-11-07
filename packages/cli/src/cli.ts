// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/**
 * `humancompiler`: HumanCompiler on the command line, mainly for coding
 * agents. Dispatches to the subcommands.
 */

import { CliError, TOKEN_ENV } from './api'
import { checkNodeVersion } from './args'

// Injected from package.json by scripts/build.mjs.
declare const __VERSION__: string
const VERSION = __VERSION__

const HELP = `Usage: humancompiler <command> [options]

HumanCompiler on the command line, mainly for coding agents.

Commands:
  roadmap <project-id>          Draw a project's roadmap (PNG/SVG) on this
                                machine and print its schedule.
  context <project|goal> <id>   Export a project's or goal's notes, tasks and
                                work history as Markdown.
  setup <claude-code|codex>     Connect a coding agent to the HumanCompiler MCP
                                server and add a usage guide for it.
  doctor                        Check Node.js, the token, the API and the
                                token's scopes, and say how to fix problems.

Run humancompiler <command> --help for a command's options.

The agent token is read from the ${TOKEN_ENV} environment variable
only. Create one under Settings > Agent tokens in HumanCompiler.

Options:
  -h, --help       Show this help.
  -v, --version    Show the version.
`

type Command = (argv: string[]) => Promise<void>

// Loaded on demand: roadmap brings in the drawing code and the native
// rasterizer, which the other commands do not need.
const COMMANDS: Record<string, () => Promise<Command>> = {
  roadmap: async () => (await import('./commands/roadmap')).roadmap,
  context: async () => (await import('./commands/context')).context,
  setup: async () => (await import('./commands/setup')).setup,
  doctor: async () => (await import('./commands/doctor')).doctor,
}

let commandName: string | undefined

async function main(argv: string[]): Promise<void> {
  const [first, ...rest] = argv
  if (first === undefined) {
    process.stderr.write(HELP)
    process.exitCode = 2
    return
  }
  if (first === '-h' || first === '--help') {
    process.stdout.write(HELP)
    return
  }
  if (first === '-v' || first === '--version') {
    process.stdout.write(`${VERSION}\n`)
    return
  }
  if (first === 'help') {
    if (rest[0] && Object.hasOwn(COMMANDS, rest[0])) return main([rest[0], '--help'])
    process.stdout.write(HELP)
    return
  }

  if (!Object.hasOwn(COMMANDS, first)) {
    throw new CliError(
      `Unknown command ${first}. Commands: ${Object.keys(COMMANDS).join(', ')}.\nRun humancompiler --help for usage.`,
      2,
    )
  }
  commandName = first
  // doctor reports an old Node.js itself, with how to fix it.
  if (first !== 'doctor') checkNodeVersion()
  const command = await COMMANDS[first]!()
  await command(rest)
}

const prefix = () => (commandName ? `humancompiler ${commandName}` : 'humancompiler')

main(process.argv.slice(2)).catch((error: unknown) => {
  if (error instanceof CliError) {
    process.stderr.write(`${prefix()}: ${error.message}\n`)
    process.exitCode = error.exitCode
    return
  }
  if (error instanceof TypeError && 'code' in error && String(error.code).startsWith('ERR_PARSE_ARGS')) {
    process.stderr.write(`${prefix()}: ${error.message}\nRun with --help for usage.\n`)
    process.exitCode = 2
    return
  }
  process.stderr.write(`${prefix()}: unexpected error\n${(error as Error)?.stack ?? error}\n`)
  process.exitCode = 1
})
