# humancompiler-roadmap

Draws the roadmap of a [HumanCompiler](https://github.com/masa10-f/HumanCompiler) project on your machine and prints its schedule.

The image is the same document as the PNG export on the HumanCompiler timeline page:
- Remaining work is scheduled goal after goal from today, using the project's weekly capacity, in dependency order.
- Past work is drawn from work logs.
- It shows dependency links, deadlines, today and the projected completion.

The command also prints the schedule as Markdown or JSON, so a coding agent can read the projected dates without looking at the image.

## Usage

```bash
export HUMANCOMPILER_TOKEN=hc_agent_...   # an agent token; see below
npx humancompiler-roadmap <project-id>
```

This writes `roadmap.png` and prints a summary like this:

```markdown
# Website renewal ロードマップ（2026/11/6 時点）

- 進捗 35%（完了 33h / 見積 95h、実績 33h）
- 残り 62h、完了見込み 2026/12/7
- 週 14h で計画（容量設定から）
- 期限に遅れる見込みのゴール: 0 件

| ゴール | 状態 | 開始 | 完了 | 期限 | 遅れ | 残り | 前提待ち |
|---|---|---|---|---|---|---|---|
| API 実装 | 進行中 | 2026/10/25 | 2026/11/15（見込み） | 2026/11/17 | — | 18h | — |
...
```

The summary is in Japanese, like the HumanCompiler interface.

### Options

| Option | Default | Description |
|---|---|---|
| `-o, --output <file>` | `roadmap.png` | Image file, `.png` or `.svg`. When there are several pages, the files are named `roadmap-1.png`, `roadmap-2.png`, and so on. |
| `--goals-per-page <n>` | `0` (one image) | Puts `n` goals in each image. About 20 keeps each image readable for an AI model. |
| `--json` | | Prints the schedule as JSON instead of Markdown. |
| `--no-image` | | Prints the schedule only. |
| `--weekly-hours <h>` | the project's capacity | Weekly hours to plan with. By default this is the project's share in the capacity triage settings, or 20 when the project has no effort ratio. |
| `--zoom <z>` | `fit` | `fit`, `day`, `week` or `month`. |
| `--width <px>` | `1400` | Image width in CSS pixels, from 640 to 4000. |
| `--expand-tasks` | | Shows task rows under each goal. |
| `--hide-completed` | | Leaves finished goals out. |
| `--no-dependencies` | | Does not draw dependency links. |
| `--pixel-ratio <r>` | `2` | PNG pixels per CSS pixel, from 1 to 2. |
| `--now <iso>` | now | Plans as of this time. |
| `--input <file>` | | Reads the timeline JSON from a file instead of the API. |
| `--api-url <url>` | `$HUMANCOMPILER_API_URL`, else the hosted API | The API's base URL. It must be https, or http to localhost. |

### Agent token

In HumanCompiler, create an agent token under **Settings → Agent tokens**. It needs the `projects:read`, `goals:read`, `tasks:read` and `logs:read` scopes, which the read presets include.

Put the token in the `HUMANCOMPILER_TOKEN` environment variable. Do not pass it on the command line. The same variable is used by the HumanCompiler MCP server setup.

The command only reads data. It calls `GET /api/agent/v1/projects/{id}/timeline`, and the agent API logs the call like any other agent request.

### Use from a coding agent

To find a project's id, use the HumanCompiler MCP tool `find`. Then run the command and read what it prints. Open the image only when the picture itself helps:

```bash
npx humancompiler-roadmap <project-id> --goals-per-page 20
```

The roadmap data goes straight from the API to the command, so it never passes through the agent's context. Only the printed summary does.

## Requirements

- Node.js 20.16 or later.
- The drawing uses [resvg](https://github.com/yisibl/resvg-js), which ships prebuilt binaries for common platforms.
- Noto Sans JP (Regular and Bold) is included.

## Development

This package lives in the HumanCompiler monorepo under `packages/roadmap`. It bundles the web app's roadmap code from `apps/web/src`, so a change to the timeline page's drawing also changes this command's image.

```bash
pnpm --filter humancompiler-roadmap type-check
pnpm --filter humancompiler-roadmap test      # builds, then runs the CLI tests
```

To publish, run `npm publish` in `packages/roadmap`. `prepublishOnly` runs the type check and the tests first.

## License

- The code is licensed under AGPL-3.0-or-later.
- The bundled Noto Sans JP fonts are licensed under the SIL Open Font License 1.1 (`fonts/OFL.txt`).
- `dist/cli.js.LEGAL.txt` lists the licences of the bundled libraries.
