# Agent Proposals PR3 (Daily Digest Email) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send each user one email a day, after their chosen hour, with two sections: new agent proposals and tasks due soon.

**Architecture:**
- The existing 「デイリーダイジェスト」 settings (`user_settings.email_daily_digest_enabled` and `email_daily_digest_hour`) are already stored, but no job uses them. This PR adds that job.
- A new module, `daily_digest.py`, decides who gets a mail and collects both sections into a `DailyDigest` value. It also records each send in `email_notification_logs`.
- `EmailService.send_daily_digest` is rewritten to render that value as escaped HTML and send it through Resend.
- A 10-minute APScheduler job, `daily_digest_email`, calls the module.
- The settings `web_base_url` (`WEB_BASE_URL`) supplies links to the web app.
- The settings page copy is updated to describe the new mail.

**Tech Stack:** FastAPI, SQLModel, pytest (SQLite in-memory via the root `conftest.py` `session` fixture), APScheduler, Resend; Next.js + Jest for Task 3.

**Spec:** `docs/design/agent-proposals.md`, sections 「デイリーダイジェスト（1日1通のまとめメール）」, 「設定画面」 (first bullet), 「テスト」 (the デイリーダイジェスト line and the settings-page line) and 「デプロイの前提」.

**Branch:** `feat/g3-daily-digest` from `main` (03e98a9 or later).

## Global Constraints

- No migration. `daily_digest` is already allowed in the `email_notification_logs` CHECK (migration 019) and in `EmailNotificationType.DAILY_DIGEST`. No new Python or npm dependency.
- The digest's day and hour are `Asia/Tokyo`. Reuse `proposal_service.APP_TIMEZONE`; do not create a second `ZoneInfo`.
- Every string that reaches the HTML goes through `html.escape(value, quote=True)`. This includes proposal titles, agent names, project, goal and task titles, kind labels, and the URLs in `href`. The subject is a plain-text header and is not escaped.
- Values read back from SQLite are naive datetimes. Treat a naive value as UTC (`value.replace(tzinfo=UTC)`) before comparing it with an aware value or converting it to JST.
- No `assert` in `apps/api/src`. Use explicit checks.
- Logging must not contain email addresses. This new code logs user ids, not `user.email`. The existing deadline-mail code is out of scope.
- New files start with the SPDX header from `.spdx-header-python.txt`. UI and email copy is Japanese. Code, comments, commits and the PR are English.
- Tests never call the real Resend API: monkeypatch `resend.Emails.send` or use a fake email service. Fake secrets in tests are repeated characters, e.g. `"re_" + "k" * 8`.
- **Checks before each backend commit, run from `apps/api`:** `uv run ruff check . && uv run ruff format --check . && uv run mypy src && uv run pytest <changed test files> -q`.
- **Checks before the web commit, run from `apps/web`:** `pnpm type-check && pnpm lint && pnpm test -- src/app/settings`.
- **Commits:** Conventional Commits in English, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never `--amend`, rebase, reset or force push.

## Exact copy (Japanese)

| Key | Text |
|---|---|
| subject: new proposals and tasks | `【HumanCompiler】新しい提案 {N} 件と期限の近いタスク {M} 件` |
| subject: new proposals only | `【HumanCompiler】新しい提案 {N} 件` |
| subject: tasks only | `【HumanCompiler】{YYYY年MM月DD日} のタスク期限サマリー` |
| header | `📋 {YYYY年MM月DD日} のダイジェスト` |
| proposals heading | `新しい提案（{N} 件）` |
| proposal row agent | `提案元: {agent_name}` |
| proposal without project | `—` |
| pending total (proposal section shown) | `未処理の提案は全部で {P} 件です。` |
| pending total (no new proposals, P > 0) | `新しい提案はありません。未処理の提案は {P} 件です。` |
| inbox link | `インボックスを開く` → `{web_base_url}/inbox` |
| tasks heading | `期限が近いタスク（{M} 件）` |
| quick task context | `クイックタスク` |
| overdue badge | `期限切れ` |
| due column | `MM/DD HH:MM`, in JST |
| dashboard link | `ダッシュボードを開く` → `{web_base_url}/dashboard` |
| truncation (both sections) | `ほか {K} 件` |
| footer | `このメールは HumanCompiler から自動送信されています。` (existing) |
| kind labels | `goal` `Goal`, `task` `タスク`, `quick_task` `クイックタスク`, `note_append` `ノート追記`, `contradiction` `矛盾`, `decision_request` `判断の依頼`, `experiment` `実験`; an unknown kind shows the raw value |
| settings: email switch description | `タスクの期限とデイリーダイジェストのメール通知を受け取ります` |
| settings: digest switch description | `新しい提案と、期限が近いタスクを1日1通にまとめてメールで受け取ります` |
| settings: about-list digest bullet | `• デイリーダイジェストは、設定した時刻以降に1日1通、新しい提案と、3日以内に期限が来るタスク・期限切れのタスクをまとめて送信します（メール通知がオフのときは送られません）` |

The proposal-section and task-section lines in the email appear only when that section has items. The links appear only when `web_base_url` is set.

## Rulings on the spec's open wording

- **"今日から3日以内".** A task is in the window when `due_date < start of the JST day (today + 4)`. That covers today through the end of the third day after today, plus everything already overdue. Overdue means `due_date < now`.
- **"未完了".** Status `pending` or `in_progress`, the same as the existing deadline mails. Tasks belong to the user through `Project.owner_id`, as in `_process_user_deadline_notifications`. Quick tasks use `QuickTask.owner_id`.
- **"前回の送信".** This is the largest `sent_at` among the user's `daily_digest` logs with `status = sent`, over all days. A pending proposal is "new" when `created_at > last_sent_at`. With no such log, every pending proposal is new.
  - New proposals are ordered newest first (`created_at desc, id`), at most 20.
  - Tasks are ordered by `due_date asc`, then title, at most 20.
  - Both sections carry their full count for `ほか K 件`.
- **Condition 3, "at least one section non-empty".** The test is `new_proposal_count > 0 or task_count > 0`. Pending proposals that are not new do not count, but when a mail goes out anyway they are mentioned in the pending-total line.
- **"今日の送信済み" and the failure cap.** Logs count when their `created_at >= start of today in JST` (converted to UTC for the query).
  - Any `sent` log blocks a second mail that day.
  - Three `failed` logs block further tries that day.
  - When both sections are empty, nothing is sent and nothing is logged.
- **An exception while building or sending for one user.** Call `logger.exception` with the user id, run `session.rollback()`, and continue with the next user. No log row is written. The send function already turns Resend errors into `False`, which is logged as `failed`.
- **The job's `now`.** It is taken once per run and used for the window, the hour check, the log's `sent_at` and `created_at`. A proposal that commits between `now` and the query may appear in two consecutive digests. That is acceptable; missing it is not.

## Review Focus

1. **Agent text containing HTML or quotes** (`<script>`, `"><img onerror=…>`, `&`). It appears in titles, agent names, project names and task context, and must reach the mail as visible escaped text. Test in Task 1.
2. **Due dates that sit across the JST day line.** A UTC instant on day D can be day D+1 in JST, e.g. `2026-11-03T15:30Z` is 11/04 00:30 JST. Both the window and the displayed time must use JST, and a SQLite naive read-back must not crash or shift by 9 hours. Test in Tasks 1 and 2.
3. **A restart or deploy after the user's hour.** The 10:00 run is missed, and the 15:20 run on the same day still sends once; the 15:30 run does not send again. Test in Task 2.
4. **Resend failing repeatedly.** Each failure is logged as `failed`. The next runs retry, and after three failures the same day there are no further tries. The next day tries again. Test in Task 2.
5. **A user with the global flag on but their own email or digest switch off, or another user's data.** No mail; nothing from other users leaks into the digest (proposals, tasks, project names). Test in Task 2.

---

### Task 1: `web_base_url` setting and the digest email template

**Files:**
- Modify: `apps/api/src/humancompiler_api/config.py`
  - add the `web_base_url` field next to the email settings, plus a validator;
  - add `settings.web_base_url = None` next to the other email defaults in the development fallback block (~line 239).
- Modify: `apps/api/.env.example`: add `WEB_BASE_URL="https://your-web-app.example.com"` after `EMAIL_NOTIFICATIONS_ENABLED`.
- Modify: `apps/api/src/humancompiler_api/email_service.py`
  - add the dataclasses and `PROPOSAL_KIND_LABELS`;
  - rewrite `send_daily_digest` and `_render_daily_digest_html`;
  - add the module-level `daily_digest_subject`;
  - update the module docstring line about the daily digest.
- Test: `apps/api/tests/test_email_daily_digest.py` (new)

**Interfaces:**
- Produces (in `email_service.py`):

```python
@dataclass(frozen=True)
class DigestProposal:
    kind: str                 # ProposalKind value
    title: str
    project_name: str | None
    agent_name: str

@dataclass(frozen=True)
class DigestTask:
    title: str
    due_date: datetime        # aware UTC
    is_overdue: bool
    context: str | None       # "Project > Goal" for a task, None for a quick task

@dataclass(frozen=True)
class DailyDigest:
    digest_date: date         # JST calendar date
    proposals: list[DigestProposal]   # at most 20
    new_proposal_count: int           # all new pending proposals, may exceed len(proposals)
    pending_count: int                # all pending proposals of the user
    tasks: list[DigestTask]           # at most 20
    task_count: int                   # all tasks in the window

def daily_digest_subject(digest: DailyDigest) -> str
EmailService.send_daily_digest(self, to_email: str, digest: DailyDigest) -> bool
EmailService._render_daily_digest_html(self, digest: DailyDigest) -> str
settings.web_base_url: str | None
```

- `send_daily_digest` returns `False` without calling Resend when `is_enabled` is false. It also returns `False` when `resend.Emails.send` raises. Log the exception class and the user-free message only, with no address.
- The old early return `True` for an empty task list goes away: the caller decides whether to send.

- [ ] **Step 1: Write the failing tests** in `tests/test_email_daily_digest.py`. Build `DailyDigest` values directly. Monkeypatch `email_service.settings.web_base_url` and `settings.email_from` as needed.
  - `test_subject_with_proposals_and_tasks`: N=2, M=3 gives `【HumanCompiler】新しい提案 2 件と期限の近いタスク 3 件`.
  - `test_subject_with_proposals_only`: gives `【HumanCompiler】新しい提案 1 件`.
  - `test_subject_with_tasks_only`: `date(2026, 11, 4)` gives `【HumanCompiler】2026年11月04日 のタスク期限サマリー`.
  - `test_html_escapes_agent_and_task_text`: the proposal title `<script>alert(1)</script>`, the agent name `a"><img src=x onerror=y>`, the project name `R&D`, the task title `<b>t</b>` and the context `P > G<i>`.
    - The HTML contains `&lt;script&gt;`, `&quot;&gt;&lt;img`, `R&amp;D`, `&lt;b&gt;t&lt;/b&gt;` and `G&lt;i&gt;`.
    - It does not contain `<script>`, `<img` or `<b>t`.
  - `test_html_shows_kind_label_project_and_agent`:
    - kind `experiment` gives `実験`; `提案元: distiller`; `project_name=None` gives `—`;
    - an unknown kind `"mystery"` shows `mystery`.
  - `test_html_due_date_in_jst`: the due date `datetime(2026, 11, 3, 15, 30, tzinfo=UTC)` shows `11/04 00:30`. An overdue task shows `期限切れ`; a non-overdue task does not.
  - `test_html_truncation_lines`: `new_proposal_count=25` with 20 proposals shows `ほか 5 件`; `task_count=21` with 20 tasks shows `ほか 1 件`.
  - `test_html_links_when_base_url_set`: with `web_base_url="https://hc.example"` the HTML contains `href="https://hc.example/inbox"` and `href="https://hc.example/dashboard"`. With `None` it contains neither `href=` nor `インボックスを開く`.
  - `test_html_hides_empty_sections`:
    - a digest with tasks only contains no `新しい提案（`;
    - with `pending_count=4` it contains `新しい提案はありません。未処理の提案は 4 件です。`;
    - a digest with proposals only contains no `期限が近いタスク（`.
  - `test_send_daily_digest_calls_resend`:
    - set up a service with `_enabled=True`, with `email_service.resend.Emails.send` monkeypatched to record the params;
    - it returns `True`, and the recorded params have `to == ["u@example.com"]`, the subject from `daily_digest_subject`, and an `html` string.
  - `test_send_daily_digest_disabled_or_failing`: with `_enabled=False` it returns `False` and does not call `send`. When `send` raises `RuntimeError`, it returns `False`.
  - `test_web_base_url_normalized`: `Settings.normalize_web_base_url` (the validator classmethod):
    - `"https://hc.example/"` gives `"https://hc.example"`, and `"  "` gives `None`;
    - `"ftp://x"` and `"hc.example"` raise `ValueError`.

- [ ] **Step 2: Run** `uv run pytest tests/test_email_daily_digest.py -q`. Expected: FAIL. The import of `DailyDigest` and the validator fail.

- [ ] **Step 3: Implement.**
  - **`config.py`:** `web_base_url: str | None = Field(default=None, description="Public URL of the web app, used for links in emails")`. Add `@field_validator("web_base_url") @classmethod normalize_web_base_url`:
    - strip the value; empty or None gives `None`;
    - if it does not start with `http://` or `https://`, raise `ValueError("WEB_BASE_URL must start with http:// or https://")`;
    - otherwise return it with `rstrip("/")`.
  - **`email_service.py`:** add the dataclasses, `PROPOSAL_KIND_LABELS`, `daily_digest_subject` and the two methods.
    - Keep the existing visual style: inline styles, gradient header, white card, footer.
    - Render the proposal section as a table with the columns kind / title / project, and put the agent line under the title.
    - Render the task section as a table with the columns title + context / due date.
    - Format dates with a small helper `_jst(value: datetime) -> datetime` that treats naive values as UTC and converts with `proposal_service.APP_TIMEZONE`. If importing `proposal_service` from `email_service` creates an import cycle, define the zone as `APP_TIMEZONE` in a place both can import, and note it in the report.

- [ ] **Step 4: Run** the backend checks from Global Constraints with `tests/test_email_daily_digest.py`. Expected: all pass.

- [ ] **Step 5: Commit** `feat(api): Render the two-section daily digest email`.

---

### Task 2: Collect the digest, decide who gets it, and schedule the job

**Files:**
- Create: `apps/api/src/humancompiler_api/daily_digest.py`
- Modify: `apps/api/src/humancompiler_api/proposal_service.py`: rename `_pending_count` to `pending_count`, keeping the same signature, and update its caller in `create_proposal`.
- Modify: `apps/api/src/humancompiler_api/scheduler/notification_scheduler.py`
  - add the `send_daily_digest_emails` job function and register it;
  - update the module docstring line `Daily digest emails: ...` to say it polls every 10 minutes and sends each user's digest once a day after their hour;
  - add `daily digest: 10min` to the startup log message.
- Test: `apps/api/tests/test_daily_digest.py` (new); `apps/api/tests/test_notification_scheduler_toggle.py` (add one assertion).

**Interfaces:**
- Consumes: `DailyDigest`, `DigestProposal`, `DigestTask`, `EmailService.send_daily_digest` from Task 1; `proposal_service.to_web_responses(session, user_id, rows)` for `project_name`; `proposal_service.APP_TIMEZONE`.
- Produces (in `daily_digest.py`):

```python
MAX_ITEMS = 20
UPCOMING_DAYS = 3
MAX_FAILURES_PER_DAY = 3

def build_digest(session: Session, user_id: UUID, now: datetime) -> DailyDigest
def run_daily_digest(session: Session, now: datetime, email_service: EmailService) -> int
    # returns the number of mails sent successfully
```

- `run_daily_digest` behaves as follows:
  1. Return `0` at once when `settings.email_notifications_enabled` is false or `email_service.is_enabled` is false.
  2. Select `(User, UserSettings)` rows with `UserSettings.email_notifications_enabled` and `UserSettings.email_daily_digest_enabled` both true.
  3. For each user, skip when `now` in JST has `hour < email_daily_digest_hour`.
  4. Skip when today's `daily_digest` logs (the rulings above) include a `sent` row, or `MAX_FAILURES_PER_DAY` `failed` rows.
  5. Otherwise `build_digest`. Skip when both counts are zero.
  6. Call `send_daily_digest(user.email, digest)` and add one `EmailNotificationLog`:
     - `notification_type=DAILY_DIGEST`;
     - `status` is `sent` or `failed`;
     - `sent_at=now` on success, otherwise `None`;
     - `error_message=None` or `"Failed to send email"`;
     - `created_at=now`.
     Commit it.
  7. Per-user exception: the rulings above.
- `send_daily_digest_emails()` in the scheduler is an `async def`:
  - open `Session(db.get_engine())`;
  - call `run_daily_digest(session, datetime.now(UTC), get_email_service())`;
  - log the count at info level when it is above 0;
  - catch any exception with `logger.exception`.
  - Register it with `scheduler.add_job(send_daily_digest_emails, "interval", minutes=10, id="daily_digest_email", name="Send daily digest emails", replace_existing=True)`.

- [ ] **Step 1: Write the failing tests** in `tests/test_daily_digest.py`.
  - **Setup:** use the root `session` fixture and the helpers from `tests.agent_api_helpers` (`seed_user`, `seed_project`, `seed_goal`, `seed_task`, `seed_quick_task`).
    - Add a `UserSettings` row per user with `email_notifications_enabled=True`, `email_daily_digest_enabled=True` and `email_daily_digest_hour=9`.
    - Set `due_date` on the seeded tasks directly and commit.
    - Create `AgentProposal` rows directly, with explicit `created_at`, `status`, `agent_name` and `project_id`. See `make_proposal` in `tests/test_proposals_router.py` for the required fields.
  - **The fake:** `FakeEmailService` has `is_enabled = True`, `results: list[bool]` (popped per call, default `True`) and `calls: list[tuple[str, DailyDigest]]`.
  - **Settings and clock:** monkeypatch `daily_digest.settings.email_notifications_enabled = True`. Use `JST = proposal_service.APP_TIMEZONE`. Write each `now` as `datetime(2026, 11, 3, 9, 0, tzinfo=JST).astimezone(UTC)`, varying the time.
  - `test_not_sent_before_hour`: at 08:59 JST with one new proposal, `run_daily_digest` returns 0, no calls are made and there are no log rows.
  - `test_sent_once_after_hour`: the 09:00 run returns 1 and writes one `sent` log with `sent_at` equal to `now`. The 09:10 run returns 0.
  - `test_sent_late_after_missed_hour`: with no earlier log, the 15:20 JST run returns 1. The 15:30 run returns 0.
  - `test_sends_again_next_day`: after a 09:00 send on 11/03, the 11/04 09:00 run returns 1.
  - `test_jst_day_boundary_for_sent_log`: a `sent` log created at 2026-11-04 01:00 JST (`2026-11-03T16:00Z`, the previous UTC day) blocks the 2026-11-04 09:00 JST run. A UTC-day implementation would send twice. A `sent` log at 2026-11-03 23:50 JST does not block it.
  - `test_skips_when_both_sections_empty`: no proposals and no tasks in the window give 0 calls and no log rows. Pending proposals all older than the last `sent_at` also give 0 calls.
  - `test_sends_with_only_tasks_and_with_only_proposals`: two users, one with only a due task and one with only a new proposal. Both get a mail, and each digest has the other section empty.
  - `test_new_proposals_only_after_last_sent`:
    - the setup is a `sent` log the day before with `sent_at = T`, plus pending proposals with `created_at` T-1min, T+1min and T+2h, and one `accepted` proposal at T+3h;
    - the result has `new_proposal_count == 2`, the titles of the two after T, newest first, and `pending_count == 3`.
  - `test_digest_names_project_and_agent`: the proposal's `project_id` points at the user's project titled `Project`, so its `project_name` is `"Project"` and its `agent_name` is kept. A `project_id` that belongs to another user gives `None`.
  - `test_task_window`: with `now` = 2026-11-03 09:00 JST:
    - included: due 11/06 23:59 JST; overdue 11/01 (`is_overdue` True); a quick task due 11/04;
    - excluded: due 11/07 00:00 JST; status `completed`; status `cancelled`; no due date; another user's task;
    - `task_count == 3`, ordered by due date, and the task's `context == "Project > Goal"` while the quick task's `context is None`.
  - `test_caps_sections_at_twenty`: 25 new proposals and 22 tasks give `len(proposals) == 20`, `new_proposal_count == 25`, `len(tasks) == 20` and `task_count == 22`.
  - `test_user_switches_and_global_flag`:
    - a user with `email_daily_digest_enabled=False` gets 0 calls, and a user with `email_notifications_enabled=False` gets 0 calls;
    - with `daily_digest.settings.email_notifications_enabled = False`, the user with both switches on also gets 0 calls;
    - with `FakeEmailService.is_enabled = False` the run returns 0.
  - `test_failure_logged_retried_and_capped`:
    - with `results = [False, False, False]`, the runs at 09:00, 09:10 and 09:20 each log `failed` with `sent_at None`;
    - the 09:30 run makes no call;
    - the next day at 09:00, a call is made again.
  - `test_naive_datetimes_from_sqlite_do_not_crash`: after `session.expire_all()`, so the values are reloaded naive, `build_digest` still returns correct `is_overdue` and window membership. This may be folded into `test_task_window`; say which in the report.
- **In `test_notification_scheduler_toggle.py`:** assert `scheduler.get_job("daily_digest_email") is not None` in `test_scheduler_starts_when_enabled`.

- [ ] **Step 2: Run** `uv run pytest tests/test_daily_digest.py tests/test_notification_scheduler_toggle.py -q`. Expected: FAIL, because `daily_digest` is missing.

- [ ] **Step 3: Implement** `daily_digest.py` per the Interfaces block and the rulings. Rename `pending_count` and register the scheduler job.
  - Load all window tasks and quick tasks for the user, merge, sort, then slice. Per-user data is small, and this keeps the counts exact.
  - Use `selectinload(Task.goal).selectinload(Goal.project)` for the context, as `_process_user_deadline_notifications` does.

- [ ] **Step 4: Run** the backend checks with `tests/test_daily_digest.py tests/test_notification_scheduler_toggle.py tests/test_email_daily_digest.py tests/test_agent_proposals_api.py tests/test_proposals_router.py`. Expected: all pass, and the rename breaks nothing.

- [ ] **Step 5: Commit** `feat(api): Send the daily digest once a day after the user's hour`.

---

### Task 3: Settings page copy

**Files:**
- Modify: `apps/web/src/app/settings/page.tsx`: change three strings: the email switch description, the digest switch description, and the 「メール通知について」 digest bullet. The exact copy is in the table.
- Test: `apps/web/src/app/settings/__tests__/page.test.tsx`

**Interfaces:** none.

- [ ] **Step 1: Write the failing test** `it('describes the daily digest with proposals and due tasks', …)`.
  - Override the `/api/user/settings` response with `{ ...defaultSettings, email_notifications_enabled: true, email_daily_digest_enabled: true }`.
  - `await screen.findByText('新しい提案と、期限が近いタスクを1日1通にまとめてメールで受け取ります')`.
  - Expect `screen.getByText('• デイリーダイジェストは、設定した時刻以降に1日1通、新しい提案と、3日以内に期限が来るタスク・期限切れのタスクをまとめて送信します（メール通知がオフのときは送られません）')` and `screen.getByText('タスクの期限とデイリーダイジェストのメール通知を受け取ります')`.
  - Expect `screen.queryByText('• デイリーダイジェストは当日期限のタスク一覧を送信します')` to be null.

- [ ] **Step 2: Run** `pnpm test -- src/app/settings` from `apps/web`. Expected: FAIL.

- [ ] **Step 3: Replace the three strings** in `page.tsx`.

- [ ] **Step 4: Run** the web checks from Global Constraints. Expected: all pass.

- [ ] **Step 5: Commit** `feat(web): Describe the two-section daily digest in settings`.

---

## After the tasks (controller, not a task)

- **Full suites:** run `uv run pytest -q` in `apps/api` and `pnpm test` in `apps/web`.
- **PR body: Deployment Notes:**
  - no migration;
  - the needed secrets: `WEB_BASE_URL` is already set on `humancompiler-api-masa`, as are `RESEND_API_KEY`, `EMAIL_FROM` and `EMAIL_NOTIFICATIONS_ENABLED`;
  - the job runs only where `NOTIFICATION_SCHEDULER_ENABLED` is not false (the preview app has it off);
  - the user turns on メール通知 and デイリーダイジェスト in settings.
- **Manual check after deploy:**
  - set the digest hour to the current JST hour;
  - send one test proposal with the proposal test token;
  - within 10 minutes one mail arrives, with the inbox link to `https://human-compiler.rityo-lab.com/inbox`;
  - no second mail arrives.
- **After merge:** update the G3 section of `ResearchDistillator/docs/roadmap.md`, changing Web Push to "daily email plus dashboard".
