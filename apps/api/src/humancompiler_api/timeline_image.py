# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Client for the web app's roadmap image renderer.

The roadmap (schedule, layout and drawing) is computed by the web app's
TypeScript. To give agents the same picture, the API posts the timeline data
to the web app's internal route ``POST /api/internal/timeline-image``, which
returns a PNG. The route reads no user data; the shared secret
``TIMELINE_RENDER_SECRET`` only keeps others from using it to render.
"""

import logging
from typing import Any
from urllib.parse import urlsplit

import httpx
from fastapi import HTTPException, status

from humancompiler_api.config import settings

logger = logging.getLogger(__name__)

RENDER_PATH = "/api/internal/timeline-image"
# A render takes about 0.5 s. The call holds a threadpool worker, so give up
# early on an unreachable renderer.
RENDER_TIMEOUT = httpx.Timeout(20.0, connect=5.0)

NOT_CONFIGURED = "Timeline image rendering is not configured"
# Plain http is allowed only to a renderer on this machine (local development).
LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
RENDERER_FAILED = "Timeline image renderer failed"


def render_timeline_image(
    data: dict[str, Any], options: dict[str, Any]
) -> dict[str, Any]:
    """Render ``data`` (a project timeline response) as a PNG.

    Returns the renderer's JSON: ``mime_type``, base64 ``data``, ``width``,
    ``height`` and the schedule ``summary``. Raises ``HTTPException`` 503 when
    rendering is not configured and 502 when the renderer fails.
    """
    base_url = settings.web_base_url
    secret = settings.timeline_render_secret
    if not base_url or not secret:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, NOT_CONFIGURED)
    parts = urlsplit(base_url)
    if parts.scheme != "https" and parts.hostname not in LOCAL_HOSTS:
        # The secret and the user's timeline data must not travel unencrypted.
        logger.error("Refusing to render over a non-HTTPS WEB_BASE_URL")
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, NOT_CONFIGURED)

    try:
        response = httpx.post(
            f"{base_url}{RENDER_PATH}",
            json={"data": data, "options": options},
            headers={"Authorization": f"Bearer {secret}"},
            timeout=RENDER_TIMEOUT,
        )
    except httpx.HTTPError as exc:
        logger.error("Timeline image renderer unreachable: %s", exc)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, RENDERER_FAILED) from exc

    if response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT:
        # The renderer could not fit the image within its size limit. Its
        # detail tells the agent to ask for a smaller one. (A schema error has
        # a structured detail instead, and is our bug: 502 below.)
        detail = _json_detail(response)
        if isinstance(detail, str):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail)
    if response.status_code != status.HTTP_200_OK:
        # The body is our own renderer's error detail, never user data.
        logger.error(
            "Timeline image renderer returned %s: %s",
            response.status_code,
            response.text[:500],
        )
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, RENDERER_FAILED)
    try:
        result = response.json()
        if (
            not isinstance(result, dict)
            or not isinstance(result.get("data"), str)
            or result.get("mime_type") != "image/png"
        ):
            raise ValueError("missing PNG image data")
    except ValueError as exc:
        logger.error("Timeline image renderer sent an invalid body: %s", exc)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, RENDERER_FAILED) from exc
    return dict(result)


def _json_detail(response: httpx.Response) -> Any:
    try:
        body = response.json()
    except ValueError:
        return None
    return body.get("detail") if isinstance(body, dict) else None
