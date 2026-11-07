// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/**
 * `humancompiler roadmap`: draws a HumanCompiler project's roadmap on this
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
import {
  API_URL_ENV,
  COMMAND_SCOPES,
  CliError,
  DEFAULT_API_URL,
  TOKEN_ENV,
  fetchTimeline,
  requireToken,
  resolveApiUrl,
} from '../api'
import { numberOption, usageError } from '../args'
import { drawPages, MAX_WIDTH, MIN_WIDTH, planRoadmap, rasterize } from '../render'
import { type ImageFile, summaryJson, summaryMarkdown } from '../summary'

export const ROADMAP_HELP = `Usage: humancompiler roadmap <project-id> [options]
       humancompiler roadmap --input <timeline.json> [options]

Draws the roadmap of a HumanCompiler project as the timeline page's export
does, saves it as PNG or SVG, and prints the schedule as Markdown.

Data:
  <project-id>             Fetch the project from the agent API. Needs the
                           ${TOKEN_ENV} environment variable (an agent
                           token with ${COMMAND_SCOPES.roadmap.slice(0, 3).join(', ')}
                           and ${COMMAND_SCOPES.roadmap[3]}).
  --input <file>           Read the timeline JSON from a file instead
                           (the body of GET /api/agent/v1/projects/{id}/timeline).
  --api-url <url>          API base URL (default: $${API_URL_ENV} or
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
`

const ZOOMS: readonly TimeScale[] = ['fit', 'day', 'week', 'month']

function pagePath(output: string, index: number, total: number): string {
  if (total === 1) return output
  const ext = path.extname(output)
  return `${output.slice(0, output.length - ext.length)}-${index + 1}${ext}`
}

export async function roadmap(argv: string[]): Promise<void> {
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
    },
  })
  if (values.help) {
    process.stdout.write(ROADMAP_HELP)
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
  const width = numberOption('width', values.width, MIN_WIDTH, MAX_WIDTH, { integer: true })!
  const goalsPerPage = numberOption('goals-per-page', values['goals-per-page'], 0, 1000, {
    integer: true,
  })!
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
    if (positionals.length !== 1) throw usageError('Give one project id.', ROADMAP_HELP)
    const token = requireToken()
    const apiUrl = resolveApiUrl(values['api-url'])
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
