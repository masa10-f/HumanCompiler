# humancompiler

[HumanCompiler](https://github.com/masa10-f/HumanCompiler) on the command line, mainly for coding agents such as Claude Code and Codex.

| Command | What it does |
|---|---|
| `humancompiler roadmap <project-id>` | Draws a project's roadmap (PNG or SVG) on your machine and prints its schedule. |
| `humancompiler context <project\|goal> <id>` | Exports a project's or goal's notes, tasks and work history as Markdown. |
| `humancompiler setup <claude-code\|codex>` | Connects a coding agent to the HumanCompiler MCP server and adds a usage guide for it. |
| `humancompiler doctor` | Checks Node.js, the token, the API and the token's scopes, and says how to fix problems. |

`humancompiler --help` lists the commands, and `humancompiler <command> --help` shows a command's options. `humancompiler --version` prints the version.

## Quick start

```bash
export HUMANCOMPILER_TOKEN=hc_agent_...   # an agent token; see "Agent token" below
npx humancompiler doctor                  # check the token and its scopes
npx humancompiler setup claude-code       # or: npx humancompiler setup codex
```

## Agent token

In HumanCompiler, create an agent token under **Settings → Agent tokens**. Put it in the `HUMANCOMPILER_TOKEN` environment variable, for example from your shell profile or a password manager.

- Every command reads the token from `HUMANCOMPILER_TOKEN` only. There is no option for it on the command line (it would stay in your shell history), no `login` command and no file that stores it.
- The same variable is used by the MCP server setup, so one token serves both.
- Scopes are fixed when a token is created. The read presets include every scope the commands need:

| Command | Scopes |
|---|---|
| `roadmap` | `projects:read`, `goals:read`, `tasks:read`, `logs:read` |
| `context` | `context:read` |
| `setup`, `doctor` | none |

`humancompiler doctor` shows which commands the current token can run.

## roadmap

```bash
npx humancompiler roadmap <project-id>
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

The image is the same document as the PNG export on the HumanCompiler timeline page:
- Remaining work is scheduled goal after goal from today, using the project's weekly capacity, in dependency order.
- Past work is drawn from work logs.
- It shows dependency links, deadlines, today and the projected completion.

The summary is in Japanese, like the HumanCompiler interface. A coding agent can read the projected dates from it without opening the image.

| Option | Default | Description |
|---|---|---|
| `-o, --output <file>` | `roadmap.png` | Image file, `.png` or `.svg`. When there are several pages, the files are named `roadmap-1.png`, `roadmap-2.png`, and so on. |
| `--goals-per-page <n>` | `0` (one image) | Puts `n` goals in each image. About 20 keeps each image readable for an AI model. |
| `--json` | | Prints the schedule as JSON instead of Markdown. |
| `--no-image` | | Prints the schedule only. |
| `--weekly-hours <h>` | the project's capacity | Weekly hours to plan with. By default this is the project's share in the capacity triage settings, or 20 when the project has no effort ratio. |
| `--zoom <z>` | `fit` | `fit`, `day`, `week` or `month`. |
| `--width <px>` | `1400` | Image width in CSS pixels, a whole number from 640 to 4000. |
| `--expand-tasks` | | Shows task rows under each goal. |
| `--hide-completed` | | Leaves finished goals out. |
| `--no-dependencies` | | Does not draw dependency links. |
| `--pixel-ratio <r>` | `2` | PNG pixels per CSS pixel, from 1 to 2. |
| `--now <iso>` | now | Plans as of this time. |
| `--input <file>` | | Reads the timeline JSON from a file instead of the API. |
| `--api-url <url>` | `$HUMANCOMPILER_API_URL`, else the hosted API | The API's base URL. It must be https, or http to localhost. |

It calls `GET /api/agent/v1/projects/{id}/timeline`.

## context

```bash
npx humancompiler context project <project-id> -o context.md
npx humancompiler context goal <goal-id>          # prints to stdout
```

Fetches the same Markdown document as the AI context export in the web app: the notes and tasks under the project or goal, and its work history (logs, work sessions, daily plans).

| Option | Default | Description |
|---|---|---|
| `-o, --output <file>` | stdout | Writes the Markdown to a file and prints only its size. |
| `--period-days <n>` | all | Only work history from the last `n` days (1 to 3650). |
| `--no-completed` | | Leaves completed goals and tasks out. |
| `--no-work-sessions` | | Leaves work sessions out. |
| `--no-daily-plans` | | Leaves daily plans out. |
| `--api-url <url>` | `$HUMANCOMPILER_API_URL`, else the hosted API | The API's base URL. |

It calls `GET /api/agent/v1/context-export/{projects|goals}/{id}`.

## setup

```bash
npx humancompiler setup claude-code   # in your project directory
npx humancompiler setup codex
```

| Agent | MCP server | Guide |
|---|---|---|
| `claude-code` | Adds `humancompiler` to the project's `.mcp.json` | `CLAUDE.md` |
| `codex` | Adds `[mcp_servers.humancompiler]` to `~/.codex/config.toml` (or `$CODEX_HOME/config.toml`) | `AGENTS.md` |

The MCP server entries name the environment variable, never the token itself:

```json
{
  "mcpServers": {
    "humancompiler": {
      "type": "http",
      "url": "https://humancompiler-api-masa.fly.dev/mcp",
      "headers": { "Authorization": "Bearer ${HUMANCOMPILER_TOKEN}" }
    }
  }
}
```

```toml
[mcp_servers.humancompiler]
url = "https://humancompiler-api-masa.fly.dev/mcp"
bearer_token_env_var = "HUMANCOMPILER_TOKEN"
```

Claude Code expands `${HUMANCOMPILER_TOKEN}` each time it loads `.mcp.json`, so the file is safe to commit. Claude Code asks you to approve a project server the first time.

The guide tells the agent how to find ids with the MCP tool `find`, when to run `roadmap` and `context`, and to run `doctor` when something fails. It sits between `<!-- humancompiler:begin ... -->` and `<!-- humancompiler:end -->` markers. The begin marker carries a hash of the guide it wrote, so a later version refreshes a guide nobody edited without asking, and asks before replacing one you changed.

- Existing files are merged: other servers, settings, comments and text stay as they are.
- Running setup again changes nothing.
- If a `humancompiler` entry or guide that differs from this version's is already there, setup asks before replacing it (in a terminal) or stops with a message (elsewhere). Pass `--force` to replace it without asking. Nothing is written when setup stops.

| Option | Description |
|---|---|
| `--dir <path>` | Project directory for `.mcp.json` and the guide (default: the current directory). |
| `--guide-file <file>` | Writes the guide to this file instead of `CLAUDE.md` / `AGENTS.md`. |
| `--no-guide` | Does not add the guide. |
| `--api-url <url>` | API base URL; the MCP server is `<url>/mcp`. `HUMANCOMPILER_API_URL` is ignored here, so a development URL does not end up in a committed file. |
| `--force` | Replaces a differing entry or guide without asking. |

## doctor

```bash
npx humancompiler doctor            # check everything
npx humancompiler doctor roadmap    # check only the scopes roadmap needs
```

Checks, and prints how to fix each problem:

- Node.js is 22.4 or later.
- `HUMANCOMPILER_TOKEN` is set.
- The API answers (`GET /health`, without the token).
- The token is valid, and has the scopes each command needs (`GET /api/agent/v1/me`).

It also shows whether `setup` has been run for this directory and for Codex. It exits with 1 if any check fails.

## Use from a coding agent

`npx humancompiler setup` writes this guidance for the agent. In short:

1. Find the project's id with the HumanCompiler MCP tool `find`.
2. Run `npx humancompiler@0 roadmap <project-id> --goals-per-page 20` and read the printed summary first. Open the images only when the picture itself helps.
3. For background, run `npx humancompiler@0 context <project|goal> <id> -o <file>.md` and read the parts you need.

The guidance pins the major version (`@0`), so a future breaking release does not silently change what agents run.

The roadmap data and the context document go straight from the API to the command, so they never pass through the agent's context. Only what the agent chooses to read does.

## Security

- The token is read from `HUMANCOMPILER_TOKEN` only, and never written to a file by this package.
- The API URL must be https, or http to localhost.
- Redirects are not followed, so the token is never sent to another host.

## Requirements

- Node.js 22.4 or later. Earlier 22.x releases lack the `util.parseArgs` feature the `--no-...` options need, and Node 20 is past its end of life.
- The drawing uses [resvg](https://github.com/yisibl/resvg-js), which ships prebuilt binaries for common platforms. Only `roadmap` loads it.
- Noto Sans JP (Regular and Bold) is included.

## Development

This package lives in the HumanCompiler monorepo under `packages/cli`.

```bash
pnpm --filter humancompiler type-check
pnpm --filter humancompiler test      # builds, then runs the CLI tests
node packages/cli/dist/cli.js --help  # run the built CLI
```

`roadmap` bundles the web app's roadmap code from `apps/web/src` (`lib/timeline/*` and the timeline export components). **A change to the timeline page's drawing changes this package's images only when a new version is published, so raise `version` in `package.json` with such a change.**

## Releasing

Merging a PR that raises `version` in `packages/cli/package.json` publishes it. The [Publish CLI workflow](https://github.com/masa10-f/HumanCompiler/blob/main/.github/workflows/cli-publish.yml) runs on a push to `main` that changes that file (or by hand), and:

1. Does nothing if that version is already on npm (`npm view humancompiler@<version>`).
2. Type-checks, builds and tests the package.
3. Runs `npm publish --provenance --access public` with npm [trusted publishing](https://docs.npmjs.com/trusted-publishers): GitHub's OIDC token stands in for an npm token, so the repository stores none.

The workflow needs Node 22.14+ and npm 11.5.1+ (npm 11.0 to 11.5.0 cannot publish with OIDC). It upgrades npm when the runner's is older.

### First release (once)

npm configures a trusted publisher in the settings of an existing package, so the first version is published by hand.

1. **Before** merging the PR that adds this package, publish it from that PR's branch, once CI is green and the reviews are done:

   ```bash
   cd packages/cli
   npm login
   npm publish --access public   # prepublishOnly type-checks, builds and tests first
   ```

   Run it from a checkout where `pnpm install` has been done: `prepublishOnly` runs `pnpm run type-check` and `pnpm run test`.

   Merging deploys the MCP instructions and the settings-page guide, which tell agents to run `npx humancompiler@0 …` with `HUMANCOMPILER_TOKEN` set. Publishing first means nobody else can claim the `humancompiler` name in between and run code in those agent shells.

   npm may stage the first publish instead of making it live: it then publishes a placeholder version `0.0.0-stage` and holds the real version for approval. Approve it under **Staged Packages** on npmjs.com, or with `npm stage list humancompiler` and `npm stage approve <id>`. Check that `npm view humancompiler version` shows the real version before merging.

2. On npmjs.com, open **humancompiler → Settings → Trusted publishing** and add a GitHub Actions publisher:
   - Organization or user: `masa10-f`
   - Repository: `HumanCompiler`
   - Workflow filename: `cli-publish.yml`
   - Environment name: leave empty
   - Allowed actions: tick **`npm publish`**. Publishers created after 2026-09-03 allow only `npm stage publish` unless you do.

   All fields are case-sensitive. npm does not check them when you save, so a mistake shows up only as a failed publish.

3. A new trusted publisher expires unless it publishes within 2 days. So add it when the next version is ready: merge a PR that raises `version` within 2 days of step 2. If it expires, delete it and add it again.

4. Once the workflow has published a version, npm recommends **Settings → Publishing access → Require two-factor authentication and disallow tokens**. Trusted publishing keeps working, since it does not use tokens.

## License

- The code is licensed under AGPL-3.0-or-later.
- The bundled Noto Sans JP fonts are licensed under the SIL Open Font License 1.1 (`fonts/OFL.txt`).
- `dist/cli.js.LEGAL.txt` lists the licences of the bundled libraries.
