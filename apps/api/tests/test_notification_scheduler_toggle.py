# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import pytest

from humancompiler_api.scheduler import notification_scheduler


@pytest.fixture
def stubbed_scheduler(monkeypatch: pytest.MonkeyPatch):
    scheduler = notification_scheduler.get_scheduler()
    job_ids_before = {job.id for job in scheduler.get_jobs()}
    started = []
    # Keep the shared module-level scheduler from actually starting.
    monkeypatch.setattr(scheduler, "start", lambda *args, **kwargs: started.append(1))
    try:
        yield scheduler, started
    finally:
        for job in scheduler.get_jobs():
            if job.id not in job_ids_before:
                scheduler.remove_job(job.id)


def test_scheduler_does_not_start_when_disabled(
    stubbed_scheduler, monkeypatch: pytest.MonkeyPatch
):
    scheduler, started = stubbed_scheduler
    monkeypatch.setattr(
        notification_scheduler.settings, "notification_scheduler_enabled", False
    )

    assert notification_scheduler.start_notification_scheduler() is False
    assert started == []
    assert scheduler.get_job("notification_check") is None


def test_scheduler_starts_when_enabled(
    stubbed_scheduler, monkeypatch: pytest.MonkeyPatch
):
    scheduler, started = stubbed_scheduler
    monkeypatch.setattr(
        notification_scheduler.settings, "notification_scheduler_enabled", True
    )

    assert notification_scheduler.start_notification_scheduler() is True
    assert started == [1]
    assert scheduler.get_job("notification_check") is not None
