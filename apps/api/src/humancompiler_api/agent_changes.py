# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""History of changes made through the Agent Gateway (``agent_changes``)."""

from datetime import UTC, datetime, timedelta

from sqlmodel import Session, col, delete

from humancompiler_api.models import AgentChange

RETENTION_DAYS = 365


def purge_expired_changes(session: Session, now: datetime | None = None) -> int:
    """Delete changes older than ``RETENTION_DAYS`` and return the count."""
    cutoff = (now or datetime.now(UTC)) - timedelta(days=RETENTION_DAYS)
    # synchronize_session=False: the rows are gone for good, and the in-session
    # evaluator cannot compare the naive datetimes SQLite returns with the cutoff.
    result = session.exec(
        delete(AgentChange)
        .where(col(AgentChange.created_at) < cutoff)
        .execution_options(synchronize_session=False)
    )
    session.commit()
    return result.rowcount
