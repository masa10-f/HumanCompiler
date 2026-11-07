// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/**
 * `humancompiler context`: fetches the Markdown context export of a project
 * or goal (notes, tasks, work history) and writes it to a file or stdout.
 *
 * With `-o`, the document goes to the file without passing through an
 * agent's context; the agent then reads only the parts it needs.
 */

import { parseArgs } from 'node:util'
import {
  API_URL_ENV,
  COMMAND_SCOPES,
  CliError,
  type ContextKind,
  DEFAULT_API_URL,
  TOKEN_ENV,
  fetchContext,
  requireToken,
  resolveApiUrl,
} from '../api'
import { numberOption, usageError, writeOutput } from '../args'

export const CONTEXT_HELP = `Usage: humancompiler context <project|goal> <id> [options]

Fetches the context export of a project or goal as Markdown: the notes and
tasks under it and the work history (logs, work sessions, daily plans). The
same document as the AI context export in the web app.

Needs the ${TOKEN_ENV} environment variable (an agent token with
${COMMAND_SCOPES.context.join(', ')}, which the read presets include).

Options:
  -o, --output <file>      Write the Markdown to this file (default: stdout).
  --period-days <n>        Only work history from the last n days (1-3650).
  --no-completed           Leave completed goals and tasks out.
  --no-work-sessions       Leave work sessions out.
  --no-daily-plans         Leave daily plans out.
  --api-url <url>          API base URL (default: $${API_URL_ENV} or
                           ${DEFAULT_API_URL}).
  -h, --help               Show this help.
`

const KINDS: readonly ContextKind[] = ['project', 'goal']

export async function context(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    allowNegative: true,
    options: {
      output: { type: 'string', short: 'o' },
      'period-days': { type: 'string' },
      completed: { type: 'boolean', default: true },
      'work-sessions': { type: 'boolean', default: true },
      'daily-plans': { type: 'boolean', default: true },
      'api-url': { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })
  if (values.help) {
    process.stdout.write(CONTEXT_HELP)
    return
  }

  const [kind, id, ...rest] = positionals
  if (kind === undefined || id === undefined || rest.length > 0) {
    throw usageError('Give project or goal, and an id.', CONTEXT_HELP)
  }
  if (!KINDS.includes(kind as ContextKind)) {
    throw usageError(`The first argument must be project or goal, not ${kind}.`, CONTEXT_HELP)
  }
  const periodDays = numberOption('period-days', values['period-days'], 1, 3650, {
    integer: true,
  })

  const token = requireToken()
  const apiUrl = resolveApiUrl(values['api-url'])
  const result = await fetchContext(apiUrl, token, kind as ContextKind, id, {
    includeCompleted: values.completed,
    includeWorkSessions: values['work-sessions'],
    includeDailyPlans: values['daily-plans'],
    periodDays,
  })

  if (typeof result?.markdown !== 'string') {
    throw new CliError(`${apiUrl} did not answer with a context export. Check the API URL.`)
  }
  const markdown = result.markdown.endsWith('\n') ? result.markdown : `${result.markdown}\n`
  if (values.output === undefined) {
    process.stdout.write(markdown)
    return
  }
  writeOutput(values.output, markdown)
  const lines = markdown.split('\n').length - 1
  process.stdout.write(
    `Wrote the ${kind} context to ${values.output} (${lines} ${lines === 1 ? 'line' : 'lines'}, ${Buffer.byteLength(markdown)} bytes).\n`,
  )
}
