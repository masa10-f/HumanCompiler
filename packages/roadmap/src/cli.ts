// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/**
 * humancompiler-roadmap: draws a HumanCompiler project's roadmap on this
 * machine and prints its schedule.
 *
 * The data comes straight from the agent API with the agent token, so it
 * never passes through an agent's context. The agent reads the printed
 * summary (projected dates, delays) and opens the image only when needed.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import type { ProjectTimelineData, TimeScale } from '@/lib/timeline/types'
import { CliError, DEFAULT_API_URL, fetchTimeline, validateApiUrl } from './api'
import { drawPages, MAX_WIDTH, MIN_WIDTH, planRoadmap, rasterize } from './render'
import { type ImageFile, summaryJson, summaryMarkdown } from './summary'

// Injected from package.json by scripts/build.mjs.
declare const __VERSION__: string
const VERSION = __VERSION__

const HELP = `Usage: humancompiler-roadmap <project-id> [options]
       humancompiler-roadmap --input <timeline.json> [options]

Draws the roadmap of a HumanCompiler project as the timeline page's export
does, saves it as PNG or SVG, and prints the schedule as Markdown.

Data:
  <project-id>             Fetch the project from the agent API. Needs the
                           HUMANCOMPILER_TOKEN environment variable (an agent
                           token with projects:read, goals:read, tasks:read
                           and logs:read).
  --input <file>           Read the timeline JSON from a file instead
                           (the body of GET /api/agent/v1/projects/{id}/timeline).
  --api-url <url>          API base URL (default: $HUMANCOMPILER_API_URL or
                           ${DEFAULT_API_URL}).

Output:
  -o, --output <file>      Image file; .png or .svg (default: roadmap.png).
                           With several pages: roadmap-1.png, roadmap-2.png, ...
  --no-image               Print the schedule only.
  --json                   Print the schedule as JSON instead of Markdown.

Plan and view:
  --weekly-hours <h>       Weekly hours to plan with (default: the project's
                           share in the capacity triage settings, else 20).
  --now <iso-datetime>     Plan as of this time (default: now).
  --zoom <z>               fit (default), day, week or month.
  --width <px>             Image width (default 1400, ${MIN_WIDTH}-${MAX_WIDTH}).
  --goals-per-page <n>     Split into images of n goals each (default 0: one
                           image). About 20 keeps each image readable for AI.
  --expand-tasks           Show task rows under each goal.
  --hide-completed         Leave finished goals out.
  --no-dependencies        Do not draw dependency links.
  --pixel-ratio <r>        PNG pixels per point, 1-2 (default 2).

  -h, --help               Show this help.
  -v, --version            Show the version.
`

const ZOOMS: readonly TimeScale[] = ['fit', 'day', 'week', 'month']

function numberOption(
  name: string,
  raw: string | undefined,
  min: number,
  max: number,
  { integer = false } = {},
) {
  if (raw === undefined) return undefined
  const value = Number(raw)
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    const kind = integer ? 'a whole number' : 'a number'
    throw new CliError(`--${name} must be ${kind} from ${min} to ${max}`)
  }
  return value
}

function pagePath(output: string, index: number, total: number): string {
  if (total === 1) return output
  const ext = path.extname(output)
  return `${output.slice(0, output.length - ext.length)}-${index + 1}${ext}`
}

/** `parseArgs` handles `--no-...` options (allowNegative) from Node 20.16. */
export function checkNodeVersion(version = process.versions.node): void {
  const [major = 0, minor = 0] = version.split('.').map(Number)
  if (major < 20 || (major === 20 && minor < 16)) {
    throw new CliError(`Node.js 20.16 or later is required (this is ${version})`)
  }
}

export async function main(argv: string[]): Promise<void> {
  checkNodeVersion()
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    allowNegative: true,
    options: {
      input: { type: 'string' },
      'api-url': { type: 'string' },
      output: { type: 'string', short: 'o', default: 'roadmap.png' },
      image: { type: 'boolean', default: true },
      json: { type: 'boolean', default: false },
      'weekly-hours': { type: 'string' },
      now: { type: 'string' },
      zoom: { type: 'string', default: 'fit' },
      width: { type: 'string', default: '1400' },
      'goals-per-page': { type: 'string', default: '0' },
      'expand-tasks': { type: 'boolean', default: false },
      'hide-completed': { type: 'boolean', default: false },
      dependencies: { type: 'boolean', default: true },
      'pixel-ratio': { type: 'string', default: '2' },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
  })
  if (values.help) {
    process.stdout.write(HELP)
    return
  }
  if (values.version) {
    process.stdout.write(`${VERSION}\n`)
    return
  }

  const zoom = values.zoom as TimeScale
  if (!ZOOMS.includes(zoom)) throw new CliError('--zoom must be fit, day, week or month')
  const output = values.output
  const format = path.extname(output).toLowerCase()
  if (values.image && format !== '.png' && format !== '.svg') {
    throw new CliError('--output must end in .png or .svg')
  }
  const now = values.now === undefined ? undefined : new Date(values.now)
  if (now && Number.isNaN(now.getTime())) throw new CliError('--now must be an ISO date-time')
  const weeklyHours = numberOption('weekly-hours', values['weekly-hours'], 0.01, 168)
  const width = numberOption('width', values.width, MIN_WIDTH, MAX_WIDTH)!
  const goalsPerPage = numberOption('goals-per-page', values['goals-per-page'], 0, 1000, { integer: true })!
  const pixelRatio = numberOption('pixel-ratio', values['pixel-ratio'], 1, 2)!

  let data: ProjectTimelineData
  if (values.input !== undefined) {
    if (positionals.length > 0) throw new CliError('Give either a project id or --input, not both')
    try {
      data = JSON.parse(readFileSync(values.input, 'utf8')) as ProjectTimelineData
    } catch (error) {
      throw new CliError(`Could not read ${values.input}: ${(error as Error).message}`)
    }
  } else {
    if (positionals.length !== 1) throw new CliError(`Give one project id.\n\n${HELP}`, 2)
    const token = process.env.HUMANCOMPILER_TOKEN?.trim()
    if (!token) {
      throw new CliError('Set HUMANCOMPILER_TOKEN to an agent token (see Settings > Agent tokens).')
    }
    const apiUrl = validateApiUrl(
      values['api-url'] ?? process.env.HUMANCOMPILER_API_URL ?? DEFAULT_API_URL,
    )
    data = await fetchTimeline(apiUrl, token, positionals[0]!)
  }
  if (!data?.project || !Array.isArray(data.goals)) {
    throw new CliError('The timeline data has no project or goals')
  }

  const { schedule, weeklyHoursSource } = planRoadmap(data, { weeklyHours, now })
  const showCompleted = !values['hide-completed']

  const images: ImageFile[] = []
  if (values.image) {
    const pages = await drawPages(data, schedule, {
      zoom,
      width,
      showCompleted,
      showDependencies: values.dependencies,
      expandTasks: values['expand-tasks'],
      goalsPerPage,
      pixelRatio,
    })
    const dir = path.dirname(path.resolve(output))
    mkdirSync(dir, { recursive: true })
    for (const [index, page] of pages.entries()) {
      const file = pagePath(output, index, pages.length)
      if (format === '.svg') {
        writeFileSync(file, page.svg)
        images.push({ path: file, width: page.width, height: page.height, goalIds: page.goalIds })
      } else {
        const png = rasterize(page, pixelRatio)
        writeFileSync(file, png.data)
        images.push({ path: file, width: png.width, height: png.height, goalIds: page.goalIds })
      }
    }
  }

  const input = { data, schedule, weeklyHoursSource, showCompleted, images }
  process.stdout.write(
    values.json ? `${JSON.stringify(summaryJson(input), null, 2)}\n` : summaryMarkdown(input),
  )
  if (weeklyHoursSource === 'fallback') {
    process.stderr.write(
      'Note: the project has no effort ratio in the capacity triage settings, so the plan uses 20h a week. Set one in Settings, or pass --weekly-hours.\n',
    )
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  if (error instanceof CliError) {
    process.stderr.write(`humancompiler-roadmap: ${error.message}\n`)
    process.exitCode = error.exitCode
    return
  }
  if (error instanceof TypeError && 'code' in error && String(error.code).startsWith('ERR_PARSE_ARGS')) {
    process.stderr.write(`humancompiler-roadmap: ${error.message}\nRun with --help for usage.\n`)
    process.exitCode = 2
    return
  }
  process.stderr.write(`humancompiler-roadmap: unexpected error\n${(error as Error)?.stack ?? error}\n`)
  process.exitCode = 1
})
