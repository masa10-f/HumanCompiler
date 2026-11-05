# Agent MCP Server PR3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve an MCP server at `/mcp` on the HumanCompiler API, so that Claude Code and Codex can read and update the user's goals, tasks and notes with an agent token. Also add the two token presets and the setup guide.

**Architecture:**
- **Server:** an `MCPServer` (Python `mcp` SDK 2.3.0, the renamed FastMCP) mounted on the existing FastAPI app at `/mcp`, using stateless Streamable HTTP with JSON responses.
- **Per tool call:**
  1. Authenticate the bearer token with the same functions as the REST Agent API.
  2. Check the tool's scope.
  3. Apply the per-token rate limit.
  4. Write one audit row (`route = "mcp:<tool>"`).
- **Tool bodies:** they call the PR1 service functions (`agent_write_service`) and the existing read services. They never make HTTP calls back into the app.
- **Notes for agents:** stored HTML is converted to Markdown, keeping TipTap checklists.

**Tech Stack:** FastAPI, SQLModel, the `mcp` Python SDK (pinned `mcp==2.3.0`), pytest; Next.js and Jest for the presets UI and guide.

**Spec:** `docs/design/agent-mcp.md`. This plan implements the spec's PR3:
- the section 「MCP サーバー」;
- the presets in 「スコープとプリセット」;
- the read side of 「ノートの形式」;
- 「使い方の案内」.

**Branch:** `feat/g4-mcp-server` from `main` (79bdece or later).

## Global Constraints

- **SDK:** add the dependency `mcp==2.3.0` with `uv add`, which updates `uv.lock`. In this version FastMCP is named `MCPServer` (`from mcp.server.mcpserver import MCPServer`). Do not write v1-style code, and check every SDK call against the installed package's source.
- **Mounting:** mount at `/mcp` with `streamable_http_app(stateless_http=True, json_response=True, ...)`. Run the SDK's session manager in the FastAPI lifespan, as the SDK's mounting docs say. Existing routes must keep working.
- **Transport security:** the SDK's DNS-rebinding protection defaults to localhost hosts. This is a remote server authenticated by bearer token, so allow the production hosts. Either configure `transport_security` with `settings`-driven allowed hosts (the Fly app host and any custom host) or disable rebinding protection with a comment explaining why. Pick one and justify it in the report.
- **Authentication per tool call:**
  - The bearer token is `Authorization: Bearer hc_agent_...`.
  - Use `agent_token_service.get_active_token_by_secret`, the auth-failure limiter keyed by client IP (`get_client_ip`), and `agent_rate_limiter.hit_token`, with the same semantics as `agent_auth.get_agent_principal`.
  - A missing or invalid token, a missing scope or a rate limit becomes an MCP **tool error result**, not an HTTP 500. Its text is a JSON object `{"status": <int>, "detail": <detail>}`, using the same status and detail the REST API would give (401, 403 `Missing required scope: <scope>`, 429).
  - The token value never appears in logs, errors or tool results.
- **Initialize and list_tools need no token.** They only describe the server. Every tool call needs one.
- **Audit:**
  - One `agent_audit_logs` row per tool call, via `agent_audit.write_audit_log`.
  - `route = "mcp:<tool name>"`, `method = "MCP"`, `required_scope` = the tool's scope.
  - The status is the mapped status: 200 for success, else the error status.
  - Use the same fields as the middleware writes; see `AgentAuditMiddleware._record`.
  - Initialize and list_tools are not audited.
- **Rate limit:** count tool calls, not HTTP requests. Initialize and list_tools do not count.
- **Errors:**
  - An `HTTPException(status, detail)` raised by a service becomes the tool error `{"status", "detail"}`. The detail keeps its structure; for example, the 409 dict body stays a dict.
  - A `pydantic.ValidationError` from building a request model becomes `{"status": 422, "detail": <errors>}`.
  - Any other exception becomes `{"status": 500, "detail": "Internal error"}`. Log it with `logger.exception`, with no token value.
- **Tool inputs:** reuse the PR1 request models (`agent_write_models`) for validation, so the limits and the "explicit null" rules are identical to REST.
- **Tool results:** JSON-serializable dicts.
  - Entities use the same response models as REST (`GoalResponse`, `TaskResponse`), dumped with `mode="json"`.
  - Notes are returned as `{"id", "updated_at", "content_markdown"}`, converted by Task 1's function.
  - Any tool that can be destructive returns `{"applied": true, ...}`. In PR3 a destructive change without `writes:unconfirmed` is still the 403 tool error; PR2 will add `{"applied": false, "proposal": ...}`.
- **Code rules:**
  - No `assert` in `apps/api/src`; CI runs bandit without `-s B101`.
  - SPDX headers on new files.
  - UI copy is Japanese, exactly as in the copy table. Code and commits are in English.
- **Test rules:**
  - Fake tokens are built from repeated characters.
  - Tests never call external services.
  - MCP tests drive the mounted app in-process, with an httpx ASGI transport or the SDK's client over the ASGI app.
- **Backend checks, from `apps/api`:** `uv run ruff check . && uv run ruff format --check . && uv run mypy src && uv run bandit -r src -q && uv run pytest <changed tests> -q`.
- **Web checks, from `apps/web`:** `pnpm type-check && pnpm lint && pnpm test -- <paths>`.
- **Commits:** Conventional Commits, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never use `--amend`, rebase, reset or force push.

## Exact copy (Japanese)

| Key | Text |
|---|---|
| preset `working_agent_confirmed` label | `作業するエージェント（確認あり）` |
| …description | `Agent API の読み取りすべてと、Goal・Task・ノートの書き込み、提案の送信を許可する。中止・書き換え・移動などの消える操作は、承認が必要（承認の仕組みは今後の更新で追加。それまでは拒否される）` |
| preset `working_agent_unconfirmed` label | `作業するエージェント（確認なし）` |
| …description | `上と同じ権限に加えて、消える操作（中止・書き換え・移動・依存関係の削除）を承認なしで実行する（強い権限）` |
| guide section title | `MCP（Claude Code・Codex から使う）` |
| guide token warning | `トークンは環境変数やファイルに置き、設定ファイルやチャットに直接書かないでください` |

## Review Focus

1. **A tool call with another user's ID in any argument** must return the same 404 tool error as a missing ID, and write nothing. This is tested in Task 3.
2. **A tool call with a revoked token, no token, or a token missing the scope** must return a structured 401 or 403 tool error, not a 500. The rejected call must still be audited, except for a missing token, which matches REST. This is tested in Task 2.
3. **Many tool calls in one HTTP session** must each count against the token's rate limit, and each must write an audit row. This is tested in Task 2.
4. **A note holding TipTap HTML,** including checklists, headings, lists, links, code and an image, must reach the agent as readable Markdown. Checked items stay `- [x]`, and nothing is silently dropped except what Markdown cannot express. This is tested in Task 1.
5. **A destructive tool call from a token without `writes:unconfirmed`** must return the 403 tool error and write nothing, exactly like REST. This is tested in Task 3.

---

### Task 1: Note HTML → Markdown for agents

**Files:**
- Create: `apps/api/src/humancompiler_api/note_markdown_out.py` (or add to `note_markdown.py` if it stays small; say which in the report)
- Test: `apps/api/tests/test_note_markdown_out.py`

**Interfaces:**
- Produces: `note_html_to_markdown(html: str) -> str`.

**Approach:**
- Add a converter. Use the `markdownify` library (`uv add markdownify`) with a subclass that handles TipTap task lists, unless a stdlib `html.parser` converter is clearly simpler; justify the choice in the report.
- **Task lists:** `<ul data-type="taskList"><li data-type="taskItem" data-checked="true|false"><p>…</p></li></ul>` become `- [x] …` / `- [ ] …`. This is the exact markup PR1's `note_markdown.py` writes.
- **Other markup:**
  - Headings, paragraphs, bullet and ordered lists, bold, italic, inline code, code blocks, links, blockquotes and `<hr>` map to their Markdown forms.
  - `<img>` becomes `![alt](src)`.
  - Unknown tags keep their text.
  - Empty or blank HTML gives `""`.
- **Round trip:** feeding the output to `markdown_to_note_html` reproduces the same checklist state.

- [ ] **Step 1: Write the failing tests.**
  - `test_task_list_round_trip`: write `- [ ] a\n- [x] b` with `markdown_to_note_html`, then convert back with `note_html_to_markdown`. The result contains `- [ ] a` and `- [x] b`.
  - `test_common_blocks`: a heading, nested lists, bold, inline code, a fenced code block with a language, a link and a blockquote are each present in Markdown form.
  - `test_image_and_unknown_tags`: an image becomes `![alt](src)`, and the text of an unknown tag is kept.
  - `test_blank`: `""`, `<p></p>` and `<p><br></p>` all give `""`.
  - `test_real_editor_html`: take a sample of TipTap output (headings, `taskList`, a link and a code block, as the web editor saves them). Check the converter on it and assert the exact expected Markdown.
- [ ] **Step 2: Run** `uv run pytest tests/test_note_markdown_out.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the backend checks with the new test file and `tests/test_note_markdown.py`.
- [ ] **Step 5: Commit:** `feat(api): Convert note HTML to Markdown for agents`.

---

### Task 2: The `/mcp` server, auth, audit, rate limit and read tools

**Files:**
- Create: `apps/api/src/humancompiler_api/mcp_server.py`, which holds the server, the per-call guard and the read tools. If a module grows past about 400 lines, split the tools into `mcp_tools_read.py` and say so.
- Modify: `apps/api/src/humancompiler_api/main.py` (mount and lifespan), `apps/api/src/humancompiler_api/config.py` (allowed hosts, if that option is chosen), `pyproject.toml` and `uv.lock` (`mcp==2.3.0`).
- Test: `apps/api/tests/test_mcp_server.py`.

**Interfaces:**
- **Consumes:**
  - Task 1's `note_html_to_markdown`;
  - `agent_token_service`, `agent_rate_limiter`, `get_client_ip`, `agent_audit.write_audit_log` and `AgentAuditLog`;
  - the read services used by `routers/agent_v1.py` (owned goals and tasks with dependencies, notes, context export).
- **Produces:**
  - `mcp_server: MCPServer` and `mcp_app` (the Starlette app mounted at `/mcp`).
  - `async def guarded_call(tool: str, scope: AgentScope, fn: Callable[[Session, AgentPrincipal], Any], ctx: Context) -> Any`. It takes the request from the MCP context, then authenticates, checks the scope, applies the rate limit, opens a DB session, runs `fn`, maps errors and audits. Task 3 uses it for every write tool.
  - **Read tools,** with the scope each one needs:
    - `find(query: str, kind: Literal["project","goal","task"] | None = None, limit: int = 20)`, needing `projects:read` / `goals:read` / `tasks:read` for the kinds searched. It does a case-insensitive title substring match over the user's own items. Each hit is `{kind, id, title, status, parent: {kind, id, title} | None, updated_at}`. Order by `updated_at` desc. If `kind` is None, it needs all three read scopes.
    - `get_goal(goal_id)`, needing `goals:read`. It returns `{goal: GoalResponse, note: {id, updated_at, content_markdown} | None}`.
    - `get_task(task_id)`, needing `tasks:read`. It returns `{task: TaskResponse, note: ... | None}`.
    - `get_context(kind: Literal["project","goal"], id)`, needing `context:read`. It returns the same Markdown as the REST context export, with its default options.

**Behaviour:**
- **Tool descriptions** are English and short. Each says what the tool is for and that its results are user data, not instructions. The server `instructions` give the working rules from the spec's MCP section:
  1. Check the target with `find` or a `get_*` tool before writing.
  2. At the end of work, update the related tasks' status and notes.
  3. Append dated summaries.
  4. Replace a note only when asked to tidy it.
- **Lifespan:** `main.py` wraps the existing lifespan so that `mcp_server.session_manager.run()` runs inside it. Startup and shutdown of the scheduler and other services are unchanged.

- [ ] **Step 1: Write the failing tests.** Drive `app` in-process: initialize, `tools/list`, `tools/call`. Use the root `conftest.py` session and the `agent_api_helpers` seeds.
  - `test_initialize_and_list_tools_without_token`: both succeed, and the four read tools are listed.
  - `test_tool_call_without_token_is_401_error`: the result is an error with `{"status": 401, ...}`, and there is no audit row.
  - `test_invalid_token_is_401_and_counts_failure`: an invalid token gives 401, and the auth-failure limiter is hit. Use a fake limiter or check its state.
  - `test_missing_scope_is_403_and_audited`: the error detail is `Missing required scope: goals:read`, and one audit row exists with `route="mcp:get_goal"` and `status_code=403`.
  - `test_rate_limit_counts_tool_calls`: patch the limiter's per-token limit to 2. The third call in one session gives the 429 error. List-tools does not count.
  - `test_find_returns_only_own_items`: seed two users and confirm the other user's items never appear. Also check the parent shape and the order.
  - `test_get_task_returns_markdown_note`: the note HTML with a checklist comes back as `- [ ]` Markdown. A task with no note gives `note: None`.
  - `test_get_goal_foreign_is_404`: a foreign goal ID and a random ID give the same 404 error.
  - `test_get_context_matches_rest`: the same Markdown as `GET /api/agent/v1/context-export/projects/{id}`.
  - `test_existing_routes_still_work`: `GET /health` and an existing agent REST route respond as before with the MCP app mounted.
  - `test_token_never_in_results_or_logs`: use `caplog`, and assert the token string is not in any result or log line.
- [ ] **Step 2: Run** `uv run pytest tests/test_mcp_server.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.** First, write a 10-line spike against the installed SDK to confirm two things:
  - how a tool function gets the HTTP request (headers, client) from its `Context` in 2.3.0;
  - how to mount `streamable_http_app` in FastAPI with the session manager in the lifespan.

  Record both answers in the report.
- [ ] **Step 4: Run** the backend checks with `tests/test_mcp_server.py`, then the full `uv run pytest -q`. Mounting must not break any other test.
- [ ] **Step 5: Commit:** `feat(api): Serve an MCP server at /mcp with read tools`.

---

### Task 3: Write tools and `list_my_changes`

**Files:**
- Modify: `apps/api/src/humancompiler_api/mcp_server.py`, or create `mcp_tools_write.py` if Task 2 split the tools.
- Test: `apps/api/tests/test_mcp_server.py` (add tests).

**Interfaces:**
- **Consumes:**
  - `guarded_call` from Task 2;
  - `agent_write_service.create_goal / update_goal / create_task / update_task / add_task_dependency / remove_task_dependency / append_note / replace_note` and the request models in `agent_write_models.py` (PR1);
  - `note_html_to_markdown` from Task 1.
- **Produces these tools.** Each argument mirrors the REST body; the REST route is named alongside.

  | Tool | Scope | Arguments | Result |
  |---|---|---|---|
  | `create_goal` | `goals:write` | `project_id, title, description?, due_date?` | `{goal}` |
  | `update_goal` | `goals:write` | `goal_id, expected_updated_at, title?, description?, due_date?, status?` | `{applied: true, goal}` |
  | `create_task` | `tasks:write` | `goal_id, title, estimate_hours, description?, due_date?, priority?, work_type?, depends_on?` | `{task}` |
  | `update_task` | `tasks:write` | `task_id, expected_updated_at`, plus the optional fields of `AgentTaskUpdate` | `{applied: true, task}` |
  | `add_dependency` | `tasks:write` | `task_id, depends_on_task_id` | `{task, created: bool}` |
  | `remove_dependency` | `tasks:write` | `task_id, depends_on_task_id` | `{applied: true, task}` |
  | `append_note` | `notes:write` | `kind: "project"\|"goal"\|"task", id, content_markdown` | `{note: {id, updated_at, content_markdown}}` |
  | `replace_note` | `notes:write` | `kind, id, expected_updated_at \| None, content_markdown` | `{applied: true, note}` |
  | `list_my_changes` | none (any valid token; `proposals` only with `proposals:read`) | `limit: int = 20` (max 100) | see below |

  `list_my_changes` returns `{changes: [...], proposals: [...]}`:
  - `changes` are this token's `agent_changes` rows, newest first: `{id, created_at, entity_type, entity_id, action, destructive, reverted_at}`.
  - `proposals` are this token's proposals, newest first, up to `limit`: `{id, kind, title, status, created_at, decided_at}`.

**Behaviour:**
- **Inputs:** build the PR1 request model from the arguments, so validation is identical to REST.
  - For `update_*`, pass through only the arguments the caller actually provided. A provided `null` must stay distinguishable from "not sent", for example by declaring optionals with a sentinel default or by accepting a `changes: dict` argument.
  - Choose one approach and document it in the tool description. It must allow explicit `null` for `description`, `memo` and `due_date`.
- **Kinds:** map `kind` `"project"|"goal"|"task"` to PR1's `"projects"|"goals"|"tasks"`.
- **Descriptions:**
  - `replace_note` restates PR1's loss sentence (`NOTE_REPLACE_LOSES`).
  - `update_task` lists which changes need `writes:unconfirmed`.

- [ ] **Step 1: Write the failing tests.**
  - `test_write_tools_listed_with_scopes`.
  - `test_create_and_update_task_via_mcp`:
    - create, then complete it with `memo_append`;
    - the results match REST's shape, and one `agent_changes` row exists per write;
    - the audit rows read `mcp:create_task` and `mcp:update_task`.
  - `test_update_task_explicit_null_and_unset`:
    - clearing `due_date` with an explicit null works;
    - leaving out `title` keeps it;
    - `priority: null` gives a 422 error.
  - `test_stale_update_is_409_error_with_dict_detail`: the detail is `{message, current_updated_at}`.
  - `test_destructive_without_unconfirmed_is_403_error`: test cancel, `remove_dependency` and `replace_note` on a non-empty note. Each gives a 403 error, and nothing is written.
  - `test_destructive_with_unconfirmed_applies`.
  - `test_foreign_ids_are_404_errors`: test `goal_id` on create, `task_id` on update, `depends_on` and the note target. Each gives the same 404 as a missing ID, with nothing written.
  - `test_append_note_returns_markdown`: append a checklist; the result's `content_markdown` contains `- [ ]`.
  - `test_add_dependency_existing_reports_created_false`.
  - `test_list_my_changes_only_this_token`: two tokens of the same user, plus another user. Only the calling token's changes and proposals are returned, newest first, and the limit is capped at 100.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the backend checks with `tests/test_mcp_server.py` and `tests/test_agent_writes_api.py`.
- [ ] **Step 5: Commit:** `feat(api): Add MCP tools for goal, task and note writes`.

---

### Task 4: Presets and the setup guide

**Files:**
- Modify: `apps/api/src/humancompiler_api/models.py` (`AGENT_TOKEN_PRESETS`), and its test in `apps/api/tests/test_agent_tokens_api.py`.
- Modify: `apps/web/src/components/settings/agent-token-usage-guide.tsx`, and its tests (find them under `__tests__`).
- Modify: `docs/design/agent-mcp.md`, only if a detail changed during implementation (for example, the transport security choice).

**Interfaces:**
- **Consumes:** the scopes from PR1.
- **Produces two presets,** appended after `proposing_agent` in this order:
  - `working_agent_confirmed`: all `:read` scopes, `goals:write`, `tasks:write`, `notes:write`, `proposals:write`.
  - `working_agent_unconfirmed`: the same, plus `writes:unconfirmed`.
  - Labels and descriptions are exactly as in the copy table.
- **Guide section** (exact title from the copy table):
  - **Server URL:** `${API base URL}/mcp`, using the same base URL the existing guide examples use.
  - **Claude Code** example: `claude mcp add --transport http humancompiler <URL>/mcp --header "Authorization: Bearer ${HUMANCOMPILER_TOKEN}"`, plus a line on putting the token in `HUMANCOMPILER_TOKEN`.
  - **Codex** example, a `~/.codex/config.toml` snippet:
    ```toml
    [mcp_servers.humancompiler]
    url = "<URL>/mcp"
    bearer_token_env_var = "HUMANCOMPILER_TOKEN"
    ```
  - The token warning from the copy table.
  - **Verify both client syntaxes** against the clients' current official docs before writing. Fetch the Claude Code MCP docs and the Codex config docs. If either differs from the above, use the documented form and note the source URL in the report.

- [ ] **Step 1: Write the failing tests.**
  - **API:** `/api/user/agent-tokens/scopes` lists the two new presets with the exact labels, descriptions and scopes, in order after `proposing_agent`.
  - **Web:** the guide renders the section title, both examples containing `/mcp`, `HUMANCOMPILER_TOKEN` and the warning text.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the backend and web checks.
- [ ] **Step 5: Commit:** `feat: Add working-agent presets and the MCP setup guide`.

---

## After the tasks (controller, not a task)

- **Full suites:** run them for api and web.
- **Deployment Notes in the PR:**
  - no migration;
  - a new Python dependency (`mcp==2.3.0`, plus `markdownify` if it was chosen);
  - the transport security choice;
  - after the deploy, the user creates a token with a working-agent preset.
- **Manual check after deploy:**
  1. Add the server to Claude Code and to Codex as the guide says.
  2. In each client, ask the agent to `find` the test goal, create a task, complete it, and append to its note.
  3. Check the inbox, the task and the note in the web app.
  4. Check that the token's audit log shows `mcp:*` rows.
