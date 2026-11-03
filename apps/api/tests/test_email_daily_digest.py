# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Tests for the two-section daily digest email (no DB, no real Resend)."""

from datetime import UTC, date, datetime
from typing import Any
from uuid import UUID

import pytest

from humancompiler_api import email_service
from humancompiler_api.config import Settings
from humancompiler_api.email_service import (
    DailyDigest,
    DigestProposal,
    DigestTask,
    EmailService,
    daily_digest_subject,
)

DUE = datetime(2026, 11, 3, 15, 30, tzinfo=UTC)
USER_ID = UUID("dddddddd-dddd-4ddd-8ddd-dddddddddddd")


def make_proposal(**overrides: Any) -> DigestProposal:
    values: dict[str, Any] = {
        "kind": "goal",
        "title": "Plan the quarter",
        "project_name": "Project A",
        "agent_name": "distiller",
    }
    values.update(overrides)
    return DigestProposal(**values)


def make_task(**overrides: Any) -> DigestTask:
    values: dict[str, Any] = {
        "title": "Write report",
        "due_date": DUE,
        "is_overdue": False,
        "context": "Project A > Goal B",
    }
    values.update(overrides)
    return DigestTask(**values)


def make_digest(**overrides: Any) -> DailyDigest:
    values: dict[str, Any] = {
        "digest_date": date(2026, 11, 4),
        "proposals": [],
        "new_proposal_count": 0,
        "pending_count": 0,
        "tasks": [],
        "task_count": 0,
    }
    values.update(overrides)
    return DailyDigest(**values)


def digest_with_proposals(n: int = 1, **overrides: Any) -> DailyDigest:
    return make_digest(
        proposals=[make_proposal() for _ in range(n)],
        new_proposal_count=n,
        pending_count=n,
        **overrides,
    )


def digest_with_tasks(m: int = 1, **overrides: Any) -> DailyDigest:
    return make_digest(tasks=[make_task() for _ in range(m)], task_count=m, **overrides)


@pytest.fixture
def service(monkeypatch: pytest.MonkeyPatch) -> EmailService:
    monkeypatch.setattr(email_service.settings, "resend_api_key", None)
    monkeypatch.setattr(email_service.settings, "web_base_url", None)
    monkeypatch.setattr(
        email_service.settings, "email_from", "HumanCompiler <noreply@example.com>"
    )
    return EmailService()


def test_subject_with_proposals_and_tasks() -> None:
    digest = make_digest(new_proposal_count=2, task_count=3)
    assert (
        daily_digest_subject(digest)
        == "【HumanCompiler】新しい提案 2 件と期限の近いタスク 3 件"
    )


def test_subject_with_proposals_only() -> None:
    digest = make_digest(new_proposal_count=1)
    assert daily_digest_subject(digest) == "【HumanCompiler】新しい提案 1 件"


def test_subject_with_tasks_only() -> None:
    digest = make_digest(digest_date=date(2026, 11, 4), task_count=1)
    assert (
        daily_digest_subject(digest)
        == "【HumanCompiler】2026年11月04日 のタスク期限サマリー"
    )


def test_html_escapes_agent_and_task_text(service: EmailService) -> None:
    digest = make_digest(
        proposals=[
            make_proposal(
                title="<script>alert(1)</script>",
                agent_name='a"><img src=x onerror=y>',
                project_name="R&D",
            )
        ],
        new_proposal_count=1,
        pending_count=1,
        tasks=[make_task(title="<b>t</b>", context="P > G<i>")],
        task_count=1,
    )

    html = service._render_daily_digest_html(digest)

    assert "&lt;script&gt;" in html
    assert "&quot;&gt;&lt;img" in html
    assert "R&amp;D" in html
    assert "&lt;b&gt;t&lt;/b&gt;" in html
    assert "G&lt;i&gt;" in html
    assert "<script>" not in html
    assert "<img" not in html
    assert "<b>t" not in html


def test_html_escapes_base_url_in_href(
    service: EmailService, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        email_service.settings, "web_base_url", 'https://hc.example/"><x'
    )
    html = service._render_daily_digest_html(digest_with_proposals())
    assert 'href="https://hc.example/&quot;&gt;&lt;x/inbox"' in html
    assert '"><x' not in html


def test_html_shows_kind_label_project_and_agent(service: EmailService) -> None:
    digest = make_digest(
        proposals=[
            make_proposal(kind="experiment", project_name=None),
            make_proposal(kind="mystery", title="Other"),
        ],
        new_proposal_count=2,
        pending_count=2,
    )

    html = service._render_daily_digest_html(digest)

    assert "実験" in html
    assert "提案元: distiller" in html
    assert "—" in html
    assert "mystery" in html


def test_html_due_date_in_jst(service: EmailService) -> None:
    digest = make_digest(
        tasks=[
            make_task(title="late", is_overdue=True),
            make_task(title="fine", is_overdue=False),
        ],
        task_count=2,
    )

    html = service._render_daily_digest_html(digest)

    assert "11/04 00:30" in html
    assert html.count("期限切れ") == 1

    only_fine = service._render_daily_digest_html(digest_with_tasks())
    assert "11/04 00:30" in only_fine
    assert "期限切れ" not in only_fine


def test_html_due_date_naive_is_treated_as_utc(service: EmailService) -> None:
    digest = make_digest(
        tasks=[make_task(due_date=datetime(2026, 11, 3, 15, 30))],
        task_count=1,
    )
    assert "11/04 00:30" in service._render_daily_digest_html(digest)


def test_html_truncation_lines(service: EmailService) -> None:
    digest = make_digest(
        proposals=[make_proposal() for _ in range(20)],
        new_proposal_count=25,
        pending_count=25,
        tasks=[make_task() for _ in range(20)],
        task_count=21,
    )

    html = service._render_daily_digest_html(digest)

    assert "ほか 5 件" in html
    assert "ほか 1 件" in html

    full = service._render_daily_digest_html(
        make_digest(
            proposals=[make_proposal()],
            new_proposal_count=1,
            pending_count=1,
            tasks=[make_task()],
            task_count=1,
        )
    )
    assert "ほか" not in full


def test_html_links_when_base_url_set(
    service: EmailService, monkeypatch: pytest.MonkeyPatch
) -> None:
    digest = make_digest(
        proposals=[make_proposal()],
        new_proposal_count=1,
        pending_count=1,
        tasks=[make_task()],
        task_count=1,
    )

    monkeypatch.setattr(email_service.settings, "web_base_url", "https://hc.example")
    html = service._render_daily_digest_html(digest)
    assert 'href="https://hc.example/inbox"' in html
    assert 'href="https://hc.example/dashboard"' in html
    assert "インボックスを開く" in html
    assert "ダッシュボードを開く" in html

    monkeypatch.setattr(email_service.settings, "web_base_url", None)
    html = service._render_daily_digest_html(digest)
    assert "href=" not in html
    assert "インボックスを開く" not in html
    assert "ダッシュボードを開く" not in html


def test_html_hides_empty_sections(service: EmailService) -> None:
    tasks_only = service._render_daily_digest_html(digest_with_tasks())
    assert "新しい提案（" not in tasks_only
    assert "新しい提案はありません" not in tasks_only
    assert "期限が近いタスク（1 件）" in tasks_only

    with_pending = service._render_daily_digest_html(digest_with_tasks(pending_count=4))
    assert "新しい提案はありません。未処理の提案は 4 件です。" in with_pending
    assert "新しい提案（" not in with_pending

    proposals_only = service._render_daily_digest_html(digest_with_proposals(2))
    assert "期限が近いタスク（" not in proposals_only
    assert "新しい提案（2 件）" in proposals_only
    assert "未処理の提案は全部で 2 件です。" in proposals_only


def test_html_header_uses_digest_date(service: EmailService) -> None:
    html = service._render_daily_digest_html(digest_with_tasks())
    assert "📋 2026年11月04日 のダイジェスト" in html
    assert "このメールは HumanCompiler から自動送信されています。" in html


def test_html_quick_task_context(service: EmailService) -> None:
    digest = make_digest(tasks=[make_task(context=None)], task_count=1)
    assert "クイックタスク" in service._render_daily_digest_html(digest)


def test_send_daily_digest_calls_resend(
    service: EmailService, monkeypatch: pytest.MonkeyPatch
) -> None:
    sent: list[dict[str, Any]] = []
    sent_options: list[dict[str, Any] | None] = []

    def fake_send(
        params: dict[str, Any], options: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        sent.append(params)
        sent_options.append(options)
        return {}

    monkeypatch.setattr(email_service.resend.Emails, "send", fake_send)
    service._enabled = True
    digest = digest_with_proposals(1, task_count=0)

    assert service.send_daily_digest("u@example.com", digest, USER_ID) is True

    assert len(sent) == 1
    key = f"daily-digest/{USER_ID}/{digest.digest_date.isoformat()}"
    assert sent_options == [{"idempotency_key": key}]
    assert sent[0]["to"] == ["u@example.com"]
    assert sent[0]["subject"] == daily_digest_subject(digest)
    assert sent[0]["from"] == "HumanCompiler <noreply@example.com>"
    assert isinstance(sent[0]["html"], str)


def test_send_daily_digest_disabled_or_failing(
    service: EmailService,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    calls: list[dict[str, Any]] = []

    def fake_send(
        params: dict[str, Any], options: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        calls.append(params)
        return {}

    monkeypatch.setattr(email_service.resend.Emails, "send", fake_send)
    digest = digest_with_tasks()

    service._enabled = False
    assert service.send_daily_digest("u@example.com", digest, USER_ID) is False
    assert calls == []

    def failing_send(
        params: dict[str, Any], options: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        raise RuntimeError("boom for u@example.com")

    monkeypatch.setattr(email_service.resend.Emails, "send", failing_send)
    service._enabled = True
    with caplog.at_level("ERROR"):
        assert service.send_daily_digest("u@example.com", digest, USER_ID) is False
    assert "RuntimeError" in caplog.text
    assert "u@example.com" not in caplog.text


def test_web_base_url_normalized() -> None:
    normalize = Settings.normalize_web_base_url
    assert normalize("https://hc.example/") == "https://hc.example"
    assert normalize("http://localhost:3000") == "http://localhost:3000"
    assert normalize("  ") is None
    assert normalize(None) is None
    # A bad value is ignored, never raised: raising would make Settings() fail.
    assert normalize("ftp://x") is None
    assert normalize("hc.example") is None
    assert normalize("https://") is None
    # urlsplit raises ValueError on mismatched brackets; still ignored.
    assert normalize("http://[abc") is None
    assert normalize("http://a]b") is None
    assert Settings(web_base_url="ftp://x").web_base_url is None
