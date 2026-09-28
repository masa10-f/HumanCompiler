# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Tests for the project/goal Markdown context export."""

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from humancompiler_api.ai.context_export import (
    ContextExportOptions,
    build_export_filename,
    build_goal_context_export,
    build_project_context_export,
    demote_headings,
)
from humancompiler_api.auth import AuthUser, get_current_user
from humancompiler_api.common.error_handlers import ResourceNotFoundError
from humancompiler_api.database import get_session
from humancompiler_api.main import app
from humancompiler_api.models import (
    CheckoutType,
    ContextNote,
    ContinueReason,
    DailyPlanDocument,
    Goal,
    GoalStatus,
    Log,
    Project,
    SessionDecision,
    Task,
    TaskStatus,
    User,
    WorkSession,
    WorkType,
)

# 12:00 JST
NOW = datetime(2026, 9, 28, 3, 0, tzinfo=UTC)


@dataclass
class Workspace:
    owner: User
    other: User
    project: Project
    other_project: Project
    goal: Goal
    done_goal: Goal
    other_goal: Goal
    task: Task


@pytest.fixture
def test_session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    SQLModel.metadata.drop_all(engine)


@pytest.fixture(autouse=True)
def reset_dependency_overrides():
    app.dependency_overrides.clear()
    yield
    app.dependency_overrides.clear()


def _task(goal: Goal, title: str, status: TaskStatus, priority: int = 3) -> Task:
    return Task(
        id=uuid4(),
        goal_id=goal.id,
        title=title,
        status=status,
        priority=priority,
        estimate_hours=Decimal("1"),
    )


def _session(
    user: User, task: Task, started_at: datetime, minutes: int | None, **kwargs
) -> WorkSession:
    return WorkSession(
        id=uuid4(),
        user_id=user.id,
        task_id=task.id,
        started_at=started_at,
        ended_at=started_at + timedelta(minutes=minutes) if minutes else None,
        planned_checkout_at=started_at + timedelta(hours=1),
        **kwargs,
    )


def _timed_line(block_id: str, task: Task, title: str, **kwargs) -> dict:
    return {
        "id": block_id,
        "type": "timed_line",
        "start": "10:00",
        "end": "11:00",
        "title": title,
        "task_ref": {"source": "task", "id": str(task.id)},
        **kwargs,
    }


@pytest.fixture
def workspace(test_session: Session) -> Workspace:
    owner = User(id=uuid4(), email="owner@example.com")
    other = User(id=uuid4(), email="other@example.com")
    project = Project(
        id=uuid4(),
        owner_id=owner.id,
        title="新規事業  リサーチ",
        description="市場調査を進める",
    )
    other_project = Project(id=uuid4(), owner_id=other.id, title="他人のプロジェクト")
    test_session.add_all([owner, other, project, other_project])
    test_session.commit()

    goal = Goal(
        id=uuid4(),
        project_id=project.id,
        title="MVPを作る",
        status=GoalStatus.IN_PROGRESS,
        estimate_hours=Decimal("10"),
        due_date=datetime(2026, 10, 30, 15, 0, tzinfo=UTC),  # 2026-10-31 JST
        created_at=NOW - timedelta(days=30),
    )
    done_goal = Goal(
        id=uuid4(),
        project_id=project.id,
        title="初期調査",
        status=GoalStatus.COMPLETED,
        estimate_hours=Decimal("2"),
        created_at=NOW - timedelta(days=90),
    )
    other_goal = Goal(
        id=uuid4(), project_id=other_project.id, title="他人のゴール", estimate_hours=1
    )
    test_session.add_all([goal, done_goal, other_goal])
    test_session.commit()

    task = Task(
        id=uuid4(),
        goal_id=goal.id,
        title="API実装",
        status=TaskStatus.IN_PROGRESS,
        work_type=WorkType.FOCUSED_WORK,
        priority=2,
        estimate_hours=Decimal("3"),
        memo="APIキーは別管理",
    )
    pending_task = _task(goal, "ドキュメント整備", TaskStatus.PENDING, priority=1)
    completed_task = _task(goal, "要件定義", TaskStatus.COMPLETED)
    cancelled_task = _task(goal, "旧案検討", TaskStatus.CANCELLED)
    old_task = _task(done_goal, "競合調査", TaskStatus.COMPLETED)
    test_session.add_all([task, pending_task, completed_task, cancelled_task, old_task])
    test_session.commit()

    test_session.add_all(
        [
            ContextNote(
                user_id=owner.id,
                project_id=project.id,
                content_type="html",
                content=(
                    "<h1>背景</h1><p>顧客インタビューを重視</p>"
                    '<ul data-type="taskList"><li data-type="taskItem" '
                    'data-checked="false"><p>競合一覧</p></li></ul>'
                ),
            ),
            ContextNote(
                user_id=owner.id,
                goal_id=goal.id,
                content_type="markdown",
                content="# ゴールメモ\n週2回レビュー",
            ),
            ContextNote(
                user_id=owner.id,
                task_id=task.id,
                content_type="html",
                content="<p>設計方針: 小さく始める</p>",
            ),
            ContextNote(
                user_id=other.id,
                task_id=task.id,
                content_type="markdown",
                content="他人のノート",
            ),
            Log(id=uuid4(), task_id=task.id, actual_minutes=30),
            Log(id=uuid4(), task_id=task.id, actual_minutes=45),
            _session(
                owner,
                task,
                datetime(2026, 9, 18, 1, 0, tzinfo=UTC),  # 10:00 JST
                50,
                total_paused_seconds=600,
                decision=SessionDecision.CONTINUE,
                continue_reason=ContinueReason.GOOD_STOPPING_POINT,
                checkout_type=CheckoutType.SCHEDULED,
                planned_outcome="API設計を固める",
                kpt_keep="早めに相談",
                kpt_problem="見積が甘い",
                kpt_try="タイムボックス",
                remaining_estimate_hours=Decimal("1.5"),
            ),
            _session(
                owner,
                task,
                NOW - timedelta(days=60),
                30,
                decision=SessionDecision.COMPLETE,
                kpt_keep="古いセッション",
            ),
            _session(owner, task, NOW - timedelta(hours=1), None),
            _session(other, task, NOW - timedelta(days=2), 20, kpt_keep="他人のKPT"),
        ]
    )

    recent_day = date(2026, 9, 23)
    test_session.add_all(
        [
            DailyPlanDocument(
                user_id=owner.id,
                date=recent_day,
                document_json={
                    "schema_version": 1,
                    "blocks": [
                        {"id": "t", "type": "text", "text": "今日のメモ"},
                        _timed_line(
                            "a",
                            task,
                            "API設計",
                            completed=True,
                            note="エンドポイント案をまとめた",
                        ),
                        {
                            "id": "b",
                            "type": "checklist_item",
                            "title": "レビュー依頼",
                            "checked": False,
                            "task_ref": {"source": "task", "id": str(task.id)},
                        },
                        {
                            "id": "c",
                            "type": "schedule_directive",
                            "mode": "task",
                            "title": "集中枠",
                            "note": "午前中に",
                            "task_ref": {"source": "task", "id": str(task.id)},
                        },
                        {
                            **_timed_line("d", task, "クイック予定"),
                            "task_ref": {"source": "quick_task", "id": str(task.id)},
                        },
                        _timed_line("e", completed_task, "完了タスクの予定"),
                        "malformed",
                        {"id": "f", "type": "timed_line", "task_ref": "bad"},
                    ],
                },
            ),
            DailyPlanDocument(
                user_id=owner.id,
                date=date(2026, 6, 20),
                document_json={"blocks": [_timed_line("a", task, "古い予定")]},
            ),
            DailyPlanDocument(
                user_id=owner.id,
                date=date(2026, 9, 24),
                document_json={"blocks": "not-a-list"},
            ),
            DailyPlanDocument(
                user_id=other.id,
                date=recent_day,
                document_json={"blocks": [_timed_line("a", task, "他人の予定")]},
            ),
        ]
    )
    test_session.commit()

    return Workspace(
        owner=owner,
        other=other,
        project=project,
        other_project=other_project,
        goal=goal,
        done_goal=done_goal,
        other_goal=other_goal,
        task=task,
    )


def _export_project(
    session: Session, workspace: Workspace, **options
) -> tuple[str, str]:
    result = build_project_context_export(
        session,
        workspace.owner.id,
        workspace.project.id,
        ContextExportOptions(**options),
        now=NOW,
    )
    return result.filename, result.markdown


def test_project_export_bundles_notes_tasks_and_work_history(
    test_session: Session, workspace: Workspace
):
    filename, markdown = _export_project(test_session, workspace)

    assert filename == "新規事業_リサーチ_context_20260928.md"
    assert markdown.startswith("# AIコンテキスト: 新規事業 リサーチ\n")
    assert "> - 出力日時: 2026-09-28 12:00 (JST)" in markdown
    assert "> - 作業記録の対象期間: 全期間" in markdown

    # Project summary and note; note headings nest under the note heading.
    assert "- ゴール: 2件 ／ タスク: 完了 2 / 全 5件" in markdown
    assert "- 実績合計: 1.25h" in markdown
    assert "市場調査を進める" in markdown
    assert "### プロジェクトノート\n\n#### 背景\n顧客インタビューを重視" in markdown
    assert "- [ ] 競合一覧" in markdown

    # Goal details and note.
    assert "- 期限: 2026-10-31" in markdown
    assert "- 見積: 10h ／ 実績: 1.25h" in markdown
    assert "- タスク: 完了 1 / 全 4件" in markdown
    assert "### ゴールノート\n\n#### ゴールメモ\n週2回レビュー" in markdown

    # Task details, memo, and note.
    assert "- ステータス: 進行中 ／ 種別: 集中作業 ／ 優先度: 高" in markdown
    assert "- 見積: 3h ／ 実績(累計): 1.25h" in markdown
    assert "#### メモ\n\nAPIキーは別管理" in markdown
    assert "#### ノート\n\n設計方針: 小さく始める" in markdown

    # Work sessions, oldest first, with paused time excluded.
    assert "#### 作業セッション（3件）" in markdown
    assert (
        "- 2026-09-18 10:00〜10:50（実働40分） ／ 判断: 継続（キリが良い）"
        " ／ 終了: 予定通り\n"
        "  - 予定成果: API設計を固める\n"
        "  - Keep: 早めに相談\n"
        "  - Problem: 見積が甘い\n"
        "  - Try: タイムボックス\n"
        "  - 残り見積: 1.5h"
    ) in markdown
    assert markdown.index("古いセッション") < markdown.index("早めに相談")
    assert "〜（進行中）" in markdown

    # Daily plan lines that reference the task.
    assert "#### デイリープランの記録（4件）" in markdown
    assert (
        "- 2026-09-23 10:00〜11:00 [完了] API設計\n  - メモ: エンドポイント案をまとめた"
    ) in markdown
    assert "- 2026-09-23 [ ] レビュー依頼" in markdown
    assert "- 2026-09-23 [スケジュール指示] 集中枠\n  - メモ: 午前中に" in markdown
    assert "- 2026-06-20 10:00〜11:00 古い予定" in markdown
    assert "- 2026-09-23 10:00〜11:00 完了タスクの予定" in markdown

    # Nothing from other users, quick tasks, or unrelated blocks.
    assert "他人" not in markdown
    assert "クイック予定" not in markdown
    assert "今日のメモ" not in markdown

    # Active goals and tasks first.
    positions = [
        markdown.index(f"### タスク: {title}")
        for title in ("API実装", "ドキュメント整備", "要件定義", "旧案検討")
    ]
    assert positions == sorted(positions)
    assert markdown.index("## ゴール: MVPを作る") < markdown.index(
        "## ゴール: 初期調査"
    )
    assert markdown.index("### タスク: 旧案検討") < markdown.index(
        "## ゴール: 初期調査"
    )


def test_project_export_can_omit_completed_and_cancelled_items(
    test_session: Session, workspace: Workspace
):
    _, markdown = _export_project(test_session, workspace, include_completed=False)

    assert "完了・キャンセル済み: 含まない" in markdown
    assert "※ 完了・キャンセル済みのゴール1件は省略しています。" in markdown
    assert "※ 完了・キャンセル済みのタスク2件は省略しています。" in markdown
    for hidden in ("初期調査", "競合調査", "要件定義", "旧案検討", "完了タスクの予定"):
        assert hidden not in markdown
    assert "### タスク: API実装" in markdown
    assert "### タスク: ドキュメント整備" in markdown
    # Totals still describe the whole project.
    assert "- ゴール: 2件 ／ タスク: 完了 2 / 全 5件" in markdown
    assert "- タスク: 完了 1 / 全 4件" in markdown


def test_period_limits_work_history_but_not_notes(
    test_session: Session, workspace: Workspace
):
    _, markdown = _export_project(test_session, workspace, period_days=30)

    assert "> - 作業記録の対象期間: 直近30日（2026-08-29以降）" in markdown
    assert "#### 作業セッション（2件）" in markdown
    assert "早めに相談" in markdown
    assert "古いセッション" not in markdown
    assert "#### デイリープランの記録（3件）" in markdown
    assert "古い予定" not in markdown
    assert "#### 背景" in markdown
    assert "APIキーは別管理" in markdown


def test_work_sessions_and_daily_plans_can_be_turned_off(
    test_session: Session, workspace: Workspace
):
    _, markdown = _export_project(
        test_session,
        workspace,
        include_work_sessions=False,
        include_daily_plans=False,
    )

    assert "作業セッション: 含まない ／ デイリープラン: 含まない" in markdown
    assert "#### 作業セッション" not in markdown
    assert "#### デイリープランの記録" not in markdown
    assert "早めに相談" not in markdown
    assert "API設計" not in markdown
    assert "#### ノート\n\n設計方針: 小さく始める" in markdown


def test_goal_export_includes_project_background_and_only_that_goal(
    test_session: Session, workspace: Workspace
):
    result = build_goal_context_export(
        test_session,
        workspace.owner.id,
        workspace.goal.id,
        ContextExportOptions(),
        now=NOW,
    )
    markdown = result.markdown

    assert result.filename == "MVPを作る_context_20260928.md"
    assert markdown.startswith("# AIコンテキスト: MVPを作る\n")
    assert "HumanCompilerから書き出したゴール「MVPを作る」" in markdown
    assert "## プロジェクト: 新規事業 リサーチ" in markdown
    assert "#### 背景" in markdown
    assert "## ゴール: MVPを作る" in markdown
    assert "### タスク: API実装" in markdown
    assert "初期調査" not in markdown
    assert "競合調査" not in markdown
    # Project-wide totals are only shown for project exports.
    assert "- ゴール: 2件" not in markdown


def test_goal_export_always_shows_the_exported_goal(
    test_session: Session, workspace: Workspace
):
    result = build_goal_context_export(
        test_session,
        workspace.owner.id,
        workspace.done_goal.id,
        ContextExportOptions(include_completed=False),
        now=NOW,
    )

    assert "## ゴール: 初期調査" in result.markdown
    assert "※ 完了・キャンセル済みのタスク1件は省略しています。" in result.markdown
    assert "競合調査" not in result.markdown


def test_exports_are_scoped_to_the_owner(test_session: Session, workspace: Workspace):
    with pytest.raises(ResourceNotFoundError):
        build_project_context_export(
            test_session,
            workspace.owner.id,
            workspace.other_project.id,
            ContextExportOptions(),
        )
    with pytest.raises(ResourceNotFoundError):
        build_goal_context_export(
            test_session,
            workspace.owner.id,
            workspace.other_goal.id,
            ContextExportOptions(),
        )


@pytest.mark.parametrize(
    ("text", "levels", "expected"),
    [
        ("# A\ntext\n## B", 2, "### A\ntext\n#### B"),
        ("##### deep", 3, "###### deep"),
        ("```\n# comment\n```\n# Title", 1, "```\n# comment\n```\n## Title"),
        ("~~~\n# a\n```\n# b\n~~~\n# c", 1, "~~~\n# a\n```\n# b\n~~~\n## c"),
        ("#hashtag and # not heading", 2, "#hashtag and # not heading"),
        ("# unchanged", 0, "# unchanged"),
    ],
)
def test_demote_headings(text: str, levels: int, expected: str):
    assert demote_headings(text, levels) == expected


@pytest.mark.parametrize(
    ("title", "expected"),
    [
        ('A/B: "C"  D?', "A_B_C_D_context_20260928.md"),
        ("  週次 レビュー  ", "週次_レビュー_context_20260928.md"),
        ("...", "export_context_20260928.md"),
        ("x" * 200, "x" * 80 + "_context_20260928.md"),
    ],
)
def test_build_export_filename(title: str, expected: str):
    assert build_export_filename(title, date(2026, 9, 28)) == expected


def _client_for(session: Session, user: User) -> TestClient:
    app.dependency_overrides[get_current_user] = lambda: AuthUser(
        user_id=str(user.id), email=user.email
    )
    app.dependency_overrides[get_session] = lambda: session
    return TestClient(app)


def test_project_endpoint_returns_markdown_with_options(
    test_session: Session, workspace: Workspace
):
    client = _client_for(test_session, workspace.owner)

    response = client.get(
        f"/api/context-export/projects/{workspace.project.id}",
        params={"include_completed": "false", "period_days": 30},
    )

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"filename", "markdown", "generated_at"}
    assert body["filename"].startswith("新規事業_リサーチ_context_")
    assert body["filename"].endswith(".md")
    assert "直近30日" in body["markdown"]
    assert "要件定義" not in body["markdown"]
    assert body["generated_at"].endswith("+00:00")


def test_goal_endpoint_returns_markdown(test_session: Session, workspace: Workspace):
    client = _client_for(test_session, workspace.owner)

    response = client.get(
        f"/api/context-export/goals/{workspace.goal.id}",
        params={"include_work_sessions": "false"},
    )

    assert response.status_code == 200
    markdown = response.json()["markdown"]
    assert "## ゴール: MVPを作る" in markdown
    assert "#### 作業セッション" not in markdown
    assert "#### デイリープランの記録" in markdown


@pytest.mark.parametrize("kind", ["projects", "goals"])
def test_endpoints_return_404_for_other_users_entities(
    test_session: Session, workspace: Workspace, kind: str
):
    client = _client_for(test_session, workspace.owner)
    entity_id = (
        workspace.other_project.id if kind == "projects" else workspace.other_goal.id
    )

    response = client.get(f"/api/context-export/{kind}/{entity_id}")

    assert response.status_code == 404


def test_endpoint_rejects_invalid_period(test_session: Session, workspace: Workspace):
    client = _client_for(test_session, workspace.owner)

    response = client.get(
        f"/api/context-export/projects/{workspace.project.id}",
        params={"period_days": 0},
    )

    assert response.status_code == 422
