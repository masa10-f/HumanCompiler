# Agent Proposals PR2 (Web Inbox) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user read agent proposals in a web inbox (`/inbox`) and accept, edit-then-accept or reject them, and show the pending count on the dashboard and in the header.

**Architecture:** The backend from PR1 (`/api/proposals`) is already in production. This PR adds one response field on the backend (`task_goal_id`, needed to link to a task's note), then a hand-written TypeScript client, TanStack Query hooks, a proposal card component (display, decision actions, edit form), the `/inbox` page, a dashboard card, a header nav item with a badge, and a curl example in the agent token usage guide.

**Tech Stack:** Next.js 15 App Router, React 18, TypeScript strict, TanStack Query v5, shadcn/ui (radix), Jest + Testing Library; FastAPI + pytest for Task 1.

**Spec:** `docs/design/agent-proposals.md` (sections 「Web 用 API」, 「Web の画面」 except 「設定画面」's digest text, which is PR3).

**Branch:** `feat/g3-proposals-web` from `main` (56366d1 or later).

## Global Constraints

- No migration in this PR. No new npm or Python dependency.
- UI strings are Japanese, hard-coded (the app has no i18n). Code, comments, commits and the PR are English.
- Agent-written strings (title, rationale, payload text, sources, decision notes) are rendered only as React text children, with `whitespace-pre-wrap break-words`. Never `dangerouslySetInnerHTML`, never a Markdown renderer.
- Links from `sources[].ref` only for `http:` / `https:` URLs (checked with `new URL()`), opened with `target="_blank" rel="noopener noreferrer"`. Any other ref (e.g. `artifact://…`) is shown as monospace text.
- New files start with the SPDX header from `.spdx-header-typescript.txt` / `.spdx-header-python.txt`.
- Types are hand-written in `src/types/` (snake_case fields, ISO strings for timestamps). API calls go through `ApiClient` in `src/lib/api.ts` plus a `proposalsApi` wrapper object, like `rescheduleApi`.
- Query keys live in `src/lib/query-keys.ts`. Hooks follow `src/hooks/use-reschedule.ts`.
- Timestamps are shown with `safeFormatJapaneseDate(iso, true)` from `src/lib/date-utils.ts` (JST).
- Tests sit in `__tests__/` beside the code. Fake tokens in tests are built from repeated characters (e.g. `"hc_agent_" + "p".repeat(8)`); no JWT-like or mixed-case/digit literals.
- Checks before each commit, from `apps/web`: `pnpm type-check`, `pnpm lint`, `pnpm test -- <changed test files>`. Task 1 (backend), from `apps/api`: `uv run ruff check . && uv run ruff format --check . && uv run mypy src && uv run pytest tests/test_proposals_router.py -q`.
- Conventional Commits in English, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never `--amend`, rebase, reset or force push.

## Exact copy (Japanese UI strings)

| Key | Text |
|---|---|
| kind `goal` / `task` / `quick_task` / `note_append` / `contradiction` / `decision_request` / `experiment` | `Goal` / `タスク` / `クイックタスク` / `ノート追記` / `矛盾` / `判断の依頼` / `実験` |
| status `accepted` / `edited` / `rejected` | `承認済み` / `編集して承認` / `却下` |
| reject `duplicate` / `wrong` / `not_valuable` / `not_now` / `other` | `重複している` / `内容が誤っている` / `価値が低い・細かすぎる` / `今はやらない` / `その他` |
| nav item, page title, dashboard card title | `インボックス` |
| tabs | `未処理` / `処理済み` |
| empty pending (page and dashboard card) | `未処理の提案はありません` |
| empty decided | `処理済みの提案はありません` |
| buttons | `承認` / `編集して承認` / `却下` / `この内容で承認` / `キャンセル` / `却下する` |
| experiment note label | `実行するエージェントへの追加の指示（任意）` |
| decision_request answer label | `答え（選択肢を選ぶか、自由に書く）` |
| contradiction comment label | `コメント（任意）` |
| reject dialog | title `提案を却下`, category label `理由`, note label `補足（任意）` |
| deleted reference | `（削除済み）` |
| rationale toggle | `続きを読む` / `折りたたむ` |
| result links | goal `作成した Goal を開く`, task `作成したタスクを開く`, quick_task `クイックタスクを開く`, context_note `ノートを開く` |
| dashboard card link | `すべて見る` |
| header badge aria-label | `未処理の提案 {n} 件` |

## Review Focus

1. **Agent text that looks like HTML or is one long unbroken string** — shown verbatim as text, wraps inside the card, nothing is interpreted. Test in Task 3.
2. **Double click on 承認 / 却下する** — one request only; buttons are disabled while the mutation is pending. Test in Task 4.
3. **Edit-then-accept with nothing changed** — sends a plain accept (no `payload`), so the server records `accepted`, not `edited`; an untouched `due_date` is never re-sent in a different notation. Test in Task 5.
4. **A proposal whose project / goal / task was deleted** — names come back `null`; the card shows `（削除済み）` and the accept's 409 message appears in the card. Test in Tasks 3 and 4.
5. **422 whose `detail` is a Pydantic error array** — the card shows readable `loc: msg` lines, not the generic fallback, and the form keeps its input. Test in Task 4.

---

### Task 1: Backend — `task_goal_id` on the web response

The web needs the goal of a referenced task to build the task note URL (`/projects/{p}/goals/{g}/tasks/{t}`), and `ProposalResponse` does not carry it.

**Files:**
- Modify: `apps/api/src/humancompiler_api/models.py` (`ProposalResponse`)
- Modify: `apps/api/src/humancompiler_api/proposal_service.py` (`to_web_responses`)
- Test: `apps/api/tests/test_proposals_router.py`

**Interfaces:**
- Produces: `ProposalResponse.task_goal_id: UUID | None = None` — the `goal_id` of the user's task that the proposal points at (only `note_append` with a `target.task_id`); `None` for every other case, including a missing or foreign task. Same batched, ownership-filtered lookup as `task_title` (still one query for tasks per page).

- [ ] **Step 1: Write failing tests** in `test_proposals_router.py`:
  - `test_note_append_on_task_has_task_goal_id`: a `note_append` with `target.task_id` of the user's task → `GET /api/proposals/{id}` has `task_goal_id == str(task.goal_id)` and `task_title == task.title`.
  - `test_task_goal_id_is_none_when_task_deleted`: same proposal, then delete the task → `task_goal_id is None` and `task_title is None`.
  - `test_task_goal_id_is_none_for_other_kinds`: a `task` proposal → `task_goal_id is None`.
- [ ] **Step 2:** Run them; expect FAIL (`task_goal_id` missing).
- [ ] **Step 3:** Add the field and fill it in `to_web_responses` (select `Task.id, Task.title, Task.goal_id` in the task lookup; keep `_names` for projects and goals).
- [ ] **Step 4:** Run the backend checks from Global Constraints; expect PASS.
- [ ] **Step 5:** Commit `feat(api): Add task_goal_id to proposal web responses`.

### Task 2: Types, API client, query keys, hooks, link helpers

**Files:**
- Create: `apps/web/src/types/proposal.ts`
- Modify: `apps/web/src/lib/api.ts` (methods on `ApiClient` + `export const proposalsApi`)
- Modify: `apps/web/src/lib/query-keys.ts`
- Create: `apps/web/src/hooks/use-proposals.ts`
- Create: `apps/web/src/lib/proposal-links.ts`
- Test: `apps/web/src/lib/__tests__/proposals-api.test.ts` (pattern: `agent-tokens-api.test.ts`), `apps/web/src/hooks/__tests__/use-proposals.test.ts`, `apps/web/src/lib/__tests__/proposal-links.test.ts`

**Interfaces (Produces):**
- `types/proposal.ts`:
  - `ProposalKind`, `ProposalStatus`, `ProposalRejectCategory`, `ProposalResultType` — string unions matching the backend enums.
  - `ProposalSource { ref: string; quote?: string | null; label?: string | null }`
  - `Proposal` — every field of the backend `ProposalResponse` (`id, kind, status, title, rationale, payload: Record<string, unknown>, final_payload: Record<string, unknown> | null, sources: ProposalSource[], idempotency_key, agent_name, project_id: string | null, reject_category, decision_note, decision_option: number | null, result: { type: ProposalResultType; id: string } | null, created_at, decided_at: string | null, updated_at, project_name, goal_title, task_title, task_goal_id`, the last four `string | null`).
  - `ProposalListResponse { items: Proposal[]; total: number }`
  - `ProposalSummary { pending_count: number; latest: { id; kind; title; agent_name; created_at }[] }`
  - `ProposalListFilters { status: 'pending' | 'decided'; kind?: ProposalKind; project_id?: string; limit?: number; offset?: number }`
  - `ProposalAcceptRequest { payload?: Record<string, unknown>; decision_note?: string; decision_option?: number }`, `ProposalRejectRequest { reject_category: ProposalRejectCategory; decision_note?: string }`
  - `PROPOSAL_KIND_LABELS`, `PROPOSAL_STATUS_LABELS`, `REJECT_CATEGORY_LABELS` — `Record<…, string>` with the exact copy above.
- `proposalsApi = { list(filters), summary(), get(id), accept(id, body), reject(id, body) }` → `GET /api/proposals?status=…&kind=…&project_id=…&limit=…&offset=…` (omit unset params), `GET /api/proposals/summary`, `GET /api/proposals/{id}`, `POST /api/proposals/{id}/accept`, `POST /api/proposals/{id}/reject`.
- `queryKeys.proposals = { all: ['proposals'], list: (filters) => [...all, 'list', filters], summary: () => [...all, 'summary'] }`.
- `hooks/use-proposals.ts`:
  - `useProposals(filters: ProposalListFilters)` — `staleTime: 30_000`, `placeholderData: keepPreviousData`.
  - `useProposalSummary(options?: { enabled?: boolean })` — `staleTime: 30_000`, `refetchOnWindowFocus: true` (the spec's "refetch on navigation and focus"; the header remounts on every page).
  - `useAcceptProposal()` — `mutationFn: ({ id, body }) => proposalsApi.accept(id, body)`; `useRejectProposal()` likewise.
  - On success both invalidate `queryKeys.proposals.all`, `goals.all`, `tasks.all`, `dashboard.all`, `progress.all`. On error they invalidate nothing (the card keeps the error and the input).
- `lib/proposal-links.ts`:
  - `proposalResultHref(p: Proposal): string | null` — uses `final_payload ?? payload`:
    - `goal` → `/projects/{project_id}/goals/{result.id}`
    - `task` → `/projects/{project_id}/goals/{payload.goal_id}/tasks/{result.id}`
    - `quick_task` → `/tasks`
    - `context_note` with `target.project_id` → `/projects/{target.project_id}/notes`; `target.goal_id` → `/projects/{project_id}/goals/{target.goal_id}/notes`; `target.task_id` → `/projects/{project_id}/goals/{task_goal_id}/tasks/{target.task_id}`
    - `null` when `result` is null or any id in the path is missing.
  - `sourceHref(ref: string): string | null` — the ref itself if `new URL(ref)` succeeds with protocol `http:` or `https:`, else `null`.
  - `proposalErrorMessage(error: unknown): string` — for an `ApiError` whose `context.responseData.detail` is an array, the items joined by newline as `` `${loc.slice(1).join('.')}: ${msg}` `` (drop the leading `body`); otherwise `getErrorMessage(error)` from `lib/errors.ts`.

- [ ] **Step 1: Write failing tests.**
  - API client: each method calls the right URL and method; `list({status:'decided', kind:'experiment', limit: 50, offset: 50})` builds `/api/proposals?status=decided&kind=experiment&limit=50&offset=50`; unset `kind`/`project_id` are omitted; `accept` sends the JSON body.
  - Hooks (`renderHookWithClient` from `hooks/__tests__/helpers/test-utils.tsx`): `useProposals` returns the mocked list; `useAcceptProposal` success invalidates `['proposals']` and `goals.all` (spy on `queryClient.invalidateQueries`); failure invalidates nothing.
  - Links: one test per row of `proposalResultHref` above, plus `null` when `task_goal_id` is null for a task-target note; `sourceHref('https://example.com/a')` → same string, `sourceHref('artifact://distiller/x')`, `sourceHref('javascript:alert(1)')` and `sourceHref('not a url')` → `null`; `proposalErrorMessage` with detail `[{loc:['body','payload','title'], msg:'Field required'}]` → `payload.title: Field required`, with an `ApiError(409, 'Proposal already decided', …)` → that message.
- [ ] **Step 2:** Run; expect FAIL (modules missing).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the web checks; expect PASS.
- [ ] **Step 5:** Commit `feat(web): Add proposals API client, hooks and link helpers`.

### Task 3: `ProposalCard` — display

**Files:**
- Create: `apps/web/src/components/proposals/proposal-card.tsx` (`ProposalCard`)
- Create: `apps/web/src/components/proposals/proposal-payload-view.tsx` (`ProposalPayloadView`)
- Create: `apps/web/src/components/proposals/proposal-sources.tsx` (`ProposalSources`)
- Create: `apps/web/src/components/proposals/index.ts`
- Test: `apps/web/src/components/proposals/__tests__/proposal-card.test.tsx`

**Interfaces:**
- Consumes: `Proposal`, label maps, `sourceHref`, `proposalResultHref` (Task 2).
- Produces: `ProposalCard({ proposal }: { proposal: Proposal })`. Task 4 adds the actions inside it; keep a clear slot (e.g. a footer `div`) for them.

Layout (shadcn `Card`): header with kind `Badge`, title, `agent_name`, `safeFormatJapaneseDate(created_at, true)`, project name (`project_name`, or `（削除済み）` when `project_id` is set but `project_name` is null). Rationale in a `whitespace-pre-wrap break-words` paragraph, collapsed to 5 lines (`line-clamp-5`) with the `続きを読む` / `折りたたむ` toggle when longer than 300 characters or 5 lines. Then `ProposalPayloadView`, then `ProposalSources`. For a decided proposal also show the status label, `decided_at`, the reject reason label, `decision_note`, the chosen option label (`decision_request`), and a `next/link` to `proposalResultHref` with the result link copy.

`ProposalPayloadView({ proposal })` shows `final_payload ?? payload` per kind, as label/value rows; it must not throw when an optional key is missing or a value has an unexpected type (render `String(value)` for scalars, skip objects it does not know):
- `goal` / `task` / `quick_task`: title, description, estimate (h), due date (`safeFormatJapaneseDate`), work type, priority; `task` also the goal (`goal_title` or `（削除済み）`).
- `note_append`: target (project / goal / task name, or `（削除済み）`) and `content_markdown` as plain pre-wrapped text.
- `experiment`: 確かめること (`question`), 方法 (`method`), 肯定の条件 (`supports_if`), 否定の条件 (`refutes_if`), 手間 (`effort`), 見積もり時間 (`estimated_hours`), 前提 (`prerequisites`).
- `decision_request`: question, numbered options with descriptions, recommendation, context.
- `contradiction`: each claim with its `source_ref`, explanation, suggested resolution.

`ProposalSources({ sources })`: a list; `label` (or the ref) as link text when `sourceHref` gives a URL, else monospace `ref`; `quote` in a `blockquote`.

- [ ] **Step 1: Write failing tests** (render with a `QueryClientProvider` wrapper; build fixtures with a local `makeProposal(overrides)` helper):
  - each of the 7 kinds renders its kind label and its main payload text;
  - a title `<script>alert(1)</script>` and a 2000-character unbroken rationale render as text (`getByText` finds the literal string; `container.querySelector('script')` is null);
  - an `https://` source is a link with `rel="noopener noreferrer"`; an `artifact://` ref and a `javascript:` ref are not links;
  - `project_id` set with `project_name: null` shows `（削除済み）`;
  - a `task` payload missing `due_date` and with `priority: "high"` still renders;
  - a decided `rejected` proposal shows `却下` and `重複している`; an accepted `goal` shows a link `作成した Goal を開く` to `/projects/p1/goals/g9`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the web checks; expect PASS.
- [ ] **Step 5:** Commit `feat(web): Add proposal card display`.

### Task 4: Decision actions — accept, reject, errors

**Files:**
- Create: `apps/web/src/components/proposals/proposal-actions.tsx` (`ProposalActions`)
- Create: `apps/web/src/components/proposals/reject-proposal-dialog.tsx` (`RejectProposalDialog`)
- Modify: `apps/web/src/components/proposals/proposal-card.tsx` (render `ProposalActions` for `pending`)
- Test: `apps/web/src/components/proposals/__tests__/proposal-actions.test.tsx`

**Interfaces:**
- Consumes: `useAcceptProposal`, `useRejectProposal`, `proposalErrorMessage`, `proposalResultHref` (Task 2).
- Produces: `ProposalActions({ proposal, onEdit }: { proposal: Proposal; onEdit?: () => void })`. Task 5 passes `onEdit` and shows the edit form; until then `編集して承認` is hidden when `onEdit` is absent.

Behaviour:
- `goal` / `task` / `quick_task` / `note_append`: `承認` sends `accept(id, {})` at once.
- `experiment`: `承認` opens an inline panel with a `Textarea` (`実行するエージェントへの追加の指示（任意）`) and `この内容で承認` / `キャンセル`; sends `{ decision_note }` only when the trimmed note is non-empty.
- `decision_request`: the panel shows a `RadioGroup` of the options (value = index) and a `Textarea` (`答え（選択肢を選ぶか、自由に書く）`); `この内容で承認` is disabled until an option is chosen or the text is non-empty; sends `decision_option` and/or `decision_note`.
- `contradiction`: the panel has the `コメント（任意）` textarea.
- `却下` opens `RejectProposalDialog` (shadcn `Dialog`): a `Select` of the five categories (required; `却下する` disabled until chosen) and `補足（任意）`.
- While a mutation is pending, every action button in the card is disabled.
- On success: a toast (`toast` from `@/hooks/use-toast`) — `提案を承認しました` / `提案を却下しました`; when `proposalResultHref` gives a path, the toast description is a `next/link` with the result link copy. The list refetch then moves the card to 処理済み.
- On error: an `Alert variant="destructive"` inside the card with `proposalErrorMessage(error)` (keep line breaks); the panel / dialog stays open with its input.
- `編集して承認` is shown only for `goal`, `task`, `quick_task`, `note_append`, `experiment`.

- [ ] **Step 1: Write failing tests** (mock `@/lib/api`'s `proposalsApi` and `@/hooks/use-toast`):
  - `goal` → click `承認` → `accept` called once with `(id, {})`; a second click while the promise is pending does nothing (button disabled);
  - `experiment` with note `GPU で回す` → body `{ decision_note: 'GPU で回す' }`; with an empty note → body `{}`;
  - `decision_request` → `この内容で承認` disabled until an option is picked; picking option 1 sends `{ decision_option: 1 }`;
  - reject → `却下する` disabled until a category is chosen; then `reject(id, { reject_category: 'wrong', decision_note: '根拠が古い' })`;
  - accept rejected with `new ApiError(409, 'Proposal target no longer exists; reject it instead', …)` → that text is in an alert; the `experiment` note textarea still holds its text;
  - accept rejected with a 422 whose `responseData.detail` is `[{loc:['body','decision_option'], msg:'Input should be less than or equal to 5'}]` → `decision_option: Input should be less than or equal to 5` is shown;
  - `contradiction` and `decision_request` cards have no `編集して承認` button even with `onEdit` passed.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the web checks; expect PASS.
- [ ] **Step 5:** Commit `feat(web): Add accept and reject actions to proposal cards`.

### Task 5: Edit-then-accept form

**Files:**
- Create: `apps/web/src/lib/proposal-edit.ts` (`EDITABLE_FIELDS`, `buildEditedPayload`)
- Create: `apps/web/src/components/proposals/proposal-edit-form.tsx` (`ProposalEditForm`)
- Modify: `apps/web/src/components/proposals/proposal-card.tsx` (toggle the form via `onEdit`)
- Test: `apps/web/src/lib/__tests__/proposal-edit.test.ts`, `apps/web/src/components/proposals/__tests__/proposal-edit-form.test.tsx`

**Interfaces:**
- Consumes: `useAcceptProposal`, `proposalErrorMessage` (Task 2); `useProjectOptions` (`hooks/use-project-query.ts`), `useGoalsByProject` (`hooks/use-goals-query.ts`); `toJSTDateInputValue` (`lib/date-utils.ts`).
- Produces:
  - `buildEditedPayload(kind, original: Record<string, unknown>, initial: FormValues, current: FormValues): Record<string, unknown> | null` — returns `null` when no field changed. Otherwise a copy of `original` where only the changed fields are replaced: empty string → `null` for an optional field; `estimate_hours` / `estimated_hours` / `priority` → `Number`; `due_date` → the `YYYY-MM-DD` string from the date input (the backend reads it as 00:00 JST). Unchanged fields keep their original value exactly. `FormValues` is `Record<string, string>` (every input is a string in the form).
  - `ProposalEditForm({ proposal, onCancel }: { proposal: Proposal; onCancel: () => void })`.

Fields (`*` = required; submit disabled while a required field is empty):
- `goal`: Project `*` (Select from `useProjectOptions`, value `project_id`), title `*`, description, due date.
- `task`: Project (Select, not part of the payload; starts at `proposal.project_id`; changing it clears the goal), Goal `*` (Select from `useGoalsByProject(selectedProject)`, value `goal_id`), title `*`, description, estimate hours `*`, due date, work type (`light_work` / `study` / `focused_work`; reuse the app's existing work type labels if a label map exists, else `軽作業` / `学習` / `集中作業`), priority (1–5).
- `quick_task`: title `*`, description, estimate hours, due date, work type, priority.
- `note_append`: `content_markdown` `*` (Textarea, 12 rows). The target is shown read-only and is not editable.
- `experiment`: question `*`, method `*`, supports_if `*`, refutes_if `*`, effort `*`, estimated_hours, prerequisites; plus the `実行するエージェントへの追加の指示（任意）` textarea (sent as `decision_note`, not in the payload).

`この内容で承認` sends `accept(id, { payload })` when `buildEditedPayload` returns an object, or `accept(id, {})` when it returns `null` (plus `decision_note` for experiments). Errors and the pending state behave as in Task 4.

- [ ] **Step 1: Write failing tests.**
  - `buildEditedPayload`: nothing changed → `null`; title changed → `{...original, title: 'new'}` with `due_date` still the original `'2026-11-10T15:00:00Z'`; description cleared → `description: null`; estimate `'2.5'` → `2.5`; due date changed to `'2026-11-20'` → `due_date: '2026-11-20'`.
  - Form: open edit on a `task` proposal → change only the title → `accept` body is `{ payload: {...original, title: …} }`; open and submit without changes → body `{}`; clearing the title disables `この内容で承認`; changing the project select clears the goal select; a 422 keeps the edited values in the inputs.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the web checks; expect PASS.
- [ ] **Step 5:** Commit `feat(web): Add edit-then-accept form for proposals`.

### Task 6: `/inbox` page

**Files:**
- Create: `apps/web/src/app/inbox/page.tsx`
- Test: `apps/web/src/app/inbox/__tests__/page.test.tsx`

**Interfaces:**
- Consumes: `useProposals`, `ProposalCard` (Tasks 2–5), `useProjectOptions`, `useAuth`, `AppHeader` (`currentPage="inbox"`, added in Task 7 — add `'inbox'` to the `currentPage` union here if Task 7 has not, so the page type-checks).

Page: the `app/notes/page.tsx` auth pattern (redirect to `/login` when not authenticated, spinner while loading); `min-h-screen bg-gray-50 dark:bg-gray-900`, `<AppHeader currentPage="inbox" />`, `<main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">`, heading `インボックス`. `Tabs` `未処理` / `処理済み` (status `pending` / `decided`); filters: kind `Select` (`すべての種類` + the 7 kinds) and project `Select` (`すべてのプロジェクト` + `useProjectOptions`). Page size 50 with `前へ` / `次へ` buttons from `total` (`{from}–{to} / {total} 件`); changing a tab or a filter resets the offset to 0. Empty states use the exact copy. A failed list load shows an `Alert` with `getErrorMessage(error)`.

- [ ] **Step 1: Write failing tests** (mock `@/hooks/use-proposals`, `@/hooks/use-project-query`, `@/hooks/use-auth`, `@/components/layout/app-header`, `next/navigation`):
  - pending tab calls `useProposals` with `{status:'pending', limit: 50, offset: 0}` and renders one card per item;
  - switching to `処理済み` calls it with `status: 'decided'` and `offset: 0`;
  - choosing kind `実験` passes `kind: 'experiment'`;
  - `total: 120` → `次へ` moves to `offset: 50`, and changing the kind resets to `offset: 0`;
  - no items → `未処理の提案はありません`;
  - unauthenticated → `router.replace('/login')`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the web checks; expect PASS.
- [ ] **Step 5:** Commit `feat(web): Add inbox page`.

### Task 7: Dashboard card, header badge, usage guide

**Files:**
- Create: `apps/web/src/components/dashboard/inbox-card.tsx` (`InboxCard`)
- Modify: `apps/web/src/app/dashboard/page.tsx` (insert `<div className="mb-8"><InboxCard /></div>` right after the Quick Tasks `div`)
- Modify: `apps/web/src/components/layout/app-header.tsx`
- Modify: `apps/web/src/components/settings/agent-token-usage-guide.tsx`
- Test: `apps/web/src/components/dashboard/__tests__/inbox-card.test.tsx`, `apps/web/src/components/layout/__tests__/app-header.test.tsx`, `apps/web/src/components/settings/__tests__/agent-token-usage-guide.test.tsx`

**Interfaces:**
- Consumes: `useProposalSummary`, `PROPOSAL_KIND_LABELS` (Task 2).

`InboxCard`: shadcn `Card`, title `インボックス` with the lucide `Inbox` icon and the pending count; the `latest` items as rows (kind `Badge` + title, each a link to `/inbox`); `すべて見る` link to `/inbox`. `pending_count === 0` → only the line `未処理の提案はありません`. Loading → a skeleton line; error → nothing but the title and the link (the dashboard must not break).

Header: add `{ id: 'inbox', label: 'インボックス', path: '/inbox', icon: Inbox }` to `NAVIGATION_ITEMS` right after `dashboard`, add `'inbox'` to `PRIMARY_NAVIGATION_IDS` and to the `currentPage` union. Call `useProposalSummary({ enabled: !!user })` once in `AppHeader`; when `pending_count > 0`, render a small count badge next to the inbox item in both the desktop and the mobile nav (`99+` above 99), with `aria-label` `未処理の提案 {n} 件`.

Usage guide: a new `<section>` titled `提案（proposals）` after the Agent API section: one sentence saying the token needs `proposals:write` (the 「提案するエージェント」 preset has it) and that the same `idempotency_key` never creates a second proposal; then two `<pre><code>` blocks built by functions taking the base URL:

```ts
const buildProposalExample = (base: string) => `curl -X POST ${base}${AGENT_API_PATH}/proposals \\
  -H "Authorization: Bearer <AGENT_TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "kind": "quick_task",
    "title": "論文の図3を作り直す",
    "rationale": "査読コメントで軸のラベルが読めないと指摘されたため",
    "payload": { "title": "図3の軸ラベルを直す", "estimate_hours": 0.5 },
    "idempotency_key": "example:quick_task:fig3@v1"
  }'`;

const buildAcceptedExperimentsExample = (base: string) =>
  `curl -H "Authorization: Bearer <AGENT_TOKEN>" "${base}${AGENT_API_PATH}/proposals?kind=experiment&status=accepted&status=edited"`;
```

- [ ] **Step 1: Write failing tests.**
  - `InboxCard` (mock `@/hooks/use-proposals`): `pending_count: 0` → `未処理の提案はありません` and no rows; `pending_count: 4` with 3 latest → `4` shown, three titles, each a link to `/inbox`, plus `すべて見る`; error → no crash, title still shown.
  - Header (add `jest.mock('@/hooks/use-proposals', …)` to the existing test): inbox link to `/inbox` exists; `pending_count: 3` → element with `aria-label` `未処理の提案 3 件` and text `3`; `pending_count: 150` → text `99+`; `pending_count: 0` → no badge.
  - Usage guide (existing test, after opening `使用方法`): `getByText(/curl -X POST https:\/\/api\.example\.com\/api\/agent\/v1\/proposals/)` and the accepted-experiments URL text.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the web checks, and the whole web suite once: `pnpm --filter web test`; expect PASS.
- [ ] **Step 5:** Commit `feat(web): Show inbox on dashboard and header, add proposal curl example`.

---

## After the tasks

- Final whole-branch review, then a PR titled `feat(web): Add agent proposal inbox (G3 PR2)` with: what it adds, the one backend field (no migration), screenshots skipped (no browser in this environment — say so), and the manual check for the user: send a `quick_task` proposal with the usage-guide curl, accept it in `/inbox`, see it in the quick task list, and see the badge go to 0.
- Spec sections not in this PR: the settings-screen digest text and everything in 「デイリーダイジェスト」 (PR3).
