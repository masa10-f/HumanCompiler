# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import pytest
from fastapi.testclient import TestClient

from humancompiler_api.config import settings
from humancompiler_api.main import app

client = TestClient(app)


@pytest.mark.parametrize(
    "origin",
    [
        "https://human-compiler-git-claude-vig-b5549c-masato-fukushimas-projects.vercel.app",
        "https://human-compiler-9qbeqspf7-masato-fukushimas-projects.vercel.app",
        "https://humancompiler-git-feature-x-masato-fukushimas-projects.vercel.app",
    ],
)
def test_project_preview_origins_are_allowed(origin: str):
    assert settings.is_vercel_domain_allowed(origin)


@pytest.mark.parametrize(
    "origin",
    [
        # Anyone can register these Vercel project names
        "https://humancompiler-evil.vercel.app",
        "https://humancompilerevil.vercel.app",
        "https://human-compiler-phish.vercel.app",
        "https://humancompiler-git-attack.vercel.app",
        "https://evil-masato-fukushimas-projects.vercel.app",
        "https://human-compiler-x-masato-fukushimas-projects-evil.vercel.app",
        # Wrong scheme / host tricks
        "http://human-compiler-abc-masato-fukushimas-projects.vercel.app",
        "https://human-compiler-abc-masato-fukushimas-projects.vercel.app.evil.com",
        "https://evil.vercel.app",
    ],
)
def test_lookalike_vercel_origins_are_rejected(origin: str):
    assert not settings.is_vercel_domain_allowed(origin)


def test_preflight_echoes_only_allowed_origins():
    allowed = "https://human-compiler-abc123-masato-fukushimas-projects.vercel.app"
    blocked = "https://humancompiler-evil.vercel.app"
    headers = {"Access-Control-Request-Method": "GET"}

    allowed_response = client.options(
        "/api/tasks/", headers={"Origin": allowed, **headers}
    )
    blocked_response = client.options(
        "/api/tasks/", headers={"Origin": blocked, **headers}
    )

    assert allowed_response.headers.get("access-control-allow-origin") == allowed
    assert "access-control-allow-origin" not in blocked_response.headers
