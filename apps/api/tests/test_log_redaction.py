# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import logging

import pytest
from uvicorn.logging import AccessFormatter

import humancompiler_api.main  # noqa: F401  (installs the uvicorn log filters)

TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ2aWN0aW0ifQ.c2lnbmF0dXJl"


def test_websocket_log_line_masks_token(caplog: pytest.LogCaptureFixture):
    path = f"/ws/notifications/user-1?token={TOKEN}"

    with caplog.at_level(logging.INFO, logger="uvicorn.error"):
        # Same call shape as uvicorn's websockets/wsproto protocol impls
        logging.getLogger("uvicorn.error").info(
            '%s - "WebSocket %s" [accepted]', "203.0.113.5:0", path
        )

    assert TOKEN not in caplog.text
    assert "/ws/notifications/user-1?token=[REDACTED]" in caplog.text


def test_access_log_masks_token_and_keeps_formatter_working():
    logger = logging.getLogger("uvicorn.access")
    record = logger.makeRecord(
        logger.name,
        logging.INFO,
        __file__,
        0,
        '%s - "%s %s HTTP/%s" %d',
        ("203.0.113.5:0", "GET", f"/api/x?a=1&token={TOKEN}&b=2", "1.1", 200),
        None,
    )

    assert logger.filter(record)
    formatted = AccessFormatter(fmt="%(message)s", use_colors=False).format(record)

    assert TOKEN not in formatted
    assert "/api/x?a=1&token=[REDACTED]&b=2" in formatted


def test_messages_without_token_are_unchanged(caplog: pytest.LogCaptureFixture):
    with caplog.at_level(logging.INFO, logger="uvicorn.error"):
        logging.getLogger("uvicorn.error").info(
            '%s - "WebSocket %s" [accepted]', "203.0.113.5:0", "/ws/status?x=1"
        )

    assert '"WebSocket /ws/status?x=1" [accepted]' in caplog.text
