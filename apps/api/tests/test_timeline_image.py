# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""The client for the web app's roadmap image renderer."""

from typing import Any

import httpx
import pytest
from fastapi import HTTPException

from humancompiler_api import timeline_image
from humancompiler_api.config import settings

DATA = {"project": {"title": "P"}, "goals": []}
OPTIONS = {"weekly_hours": 20}
RESULT = {"mime_type": "image/png", "data": "iVBOR", "width": 1, "height": 1}


@pytest.fixture
def configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "web_base_url", "https://web.example.com")
    monkeypatch.setattr(settings, "timeline_render_secret", "s3cret")


def _fake_post(
    monkeypatch: pytest.MonkeyPatch, response: httpx.Response | Exception
) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []

    def post(url: str, **kwargs: Any) -> httpx.Response:
        calls.append({"url": url, **kwargs})
        if isinstance(response, Exception):
            raise response
        return response

    monkeypatch.setattr(timeline_image.httpx, "post", post)
    return calls


@pytest.mark.usefixtures("configured")
def test_posts_data_with_secret_and_returns_result(monkeypatch: pytest.MonkeyPatch):
    calls = _fake_post(monkeypatch, httpx.Response(200, json=RESULT))

    assert timeline_image.render_timeline_image(DATA, OPTIONS) == RESULT
    (call,) = calls
    assert call["url"] == "https://web.example.com/api/internal/timeline-image"
    assert call["json"] == {"data": DATA, "options": OPTIONS}
    assert call["headers"] == {"Authorization": "Bearer s3cret"}


@pytest.mark.parametrize(
    ("base_url", "secret"),
    [(None, "s3cret"), ("https://web.example.com", None), (None, None)],
)
def test_not_configured_is_503(
    monkeypatch: pytest.MonkeyPatch, base_url: str | None, secret: str | None
):
    monkeypatch.setattr(settings, "web_base_url", base_url)
    monkeypatch.setattr(settings, "timeline_render_secret", secret)
    calls = _fake_post(monkeypatch, httpx.Response(200, json=RESULT))

    with pytest.raises(HTTPException) as exc_info:
        timeline_image.render_timeline_image(DATA, OPTIONS)

    assert exc_info.value.status_code == 503
    assert calls == []


@pytest.mark.parametrize(
    "base_url", ["http://web.example.com", "http://192.168.0.10:3000", "ftp://x"]
)
def test_refuses_non_https_remote_url(monkeypatch: pytest.MonkeyPatch, base_url: str):
    monkeypatch.setattr(settings, "web_base_url", base_url)
    monkeypatch.setattr(settings, "timeline_render_secret", "s3cret")
    calls = _fake_post(monkeypatch, httpx.Response(200, json=RESULT))

    with pytest.raises(HTTPException) as exc_info:
        timeline_image.render_timeline_image(DATA, OPTIONS)

    assert exc_info.value.status_code == 503
    assert calls == []


@pytest.mark.parametrize(
    "base_url", ["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"]
)
def test_allows_http_to_local_renderer(monkeypatch: pytest.MonkeyPatch, base_url: str):
    monkeypatch.setattr(settings, "web_base_url", base_url)
    monkeypatch.setattr(settings, "timeline_render_secret", "s3cret")
    calls = _fake_post(monkeypatch, httpx.Response(200, json=RESULT))

    assert timeline_image.render_timeline_image(DATA, OPTIONS) == RESULT
    assert calls[0]["url"] == f"{base_url}/api/internal/timeline-image"


@pytest.mark.usefixtures("configured")
@pytest.mark.parametrize(
    "response",
    [
        httpx.ConnectError("refused"),
        httpx.Response(401, json={"detail": "Unauthorized"}),
        httpx.Response(500, json={"detail": "Failed to render timeline image"}),
        httpx.Response(200, text="not json"),
        httpx.Response(200, json={"mime_type": "image/png"}),
        httpx.Response(200, json={"data": "iVBOR", "width": 1, "height": 1}),
        httpx.Response(200, json={**RESULT, "mime_type": "image/svg+xml"}),
        httpx.Response(200, json=["not", "an", "object"]),
    ],
)
def test_renderer_failure_is_502(
    monkeypatch: pytest.MonkeyPatch, response: httpx.Response | Exception
):
    _fake_post(monkeypatch, response)

    with pytest.raises(HTTPException) as exc_info:
        timeline_image.render_timeline_image(DATA, OPTIONS)

    assert exc_info.value.status_code == 502
    assert exc_info.value.detail == "Timeline image renderer failed"
