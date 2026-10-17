# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""
Tests for trusted client IP resolution (Issue #358)
"""

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from humancompiler_api.client_ip import (
    TrustedClientIPMiddleware,
    get_client_ip,
)
from humancompiler_api.rate_limiter import DefaultRateLimitMiddleware
from humancompiler_api.rate_limiter import limiter as app_limiter

EDGE_IP = "203.0.113.7"


@pytest.fixture
def on_fly(monkeypatch):
    monkeypatch.setenv("FLY_APP_NAME", "humancompiler-api-test")


@pytest.fixture
def off_fly(monkeypatch):
    monkeypatch.delenv("FLY_APP_NAME", raising=False)


def _build_app(limit: str = "100 per minute") -> ProxyHeadersMiddleware:
    """Mirror production: uvicorn trusting every forwarder in front of the app."""
    limiter = Limiter(key_func=get_client_ip)
    app = FastAPI()
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.add_middleware(TrustedClientIPMiddleware)

    @app.get("/ip")
    @limiter.limit(limit)
    async def ip(request: Request) -> dict[str, str | None]:
        return {
            "key": get_client_ip(request),
            "client_host": request.client.host if request.client else None,
        }

    return ProxyHeadersMiddleware(app, trusted_hosts="*")


def test_spoofed_x_forwarded_for_does_not_change_key_on_fly(on_fly):
    client = TestClient(_build_app())

    for spoofed in ("198.51.100.1", "198.51.100.2", "10.0.0.1"):
        response = client.get(
            "/ip",
            headers={"X-Forwarded-For": spoofed, "Fly-Client-IP": EDGE_IP},
        )
        assert response.json() == {"key": EDGE_IP, "client_host": EDGE_IP}


def test_spoofed_fly_client_ip_is_ignored_off_fly(off_fly):
    client = TestClient(_build_app())

    response = client.get("/ip", headers={"Fly-Client-IP": EDGE_IP})

    assert response.json()["key"] == "testclient"
    assert response.json()["client_host"] == "testclient"


def test_invalid_fly_client_ip_falls_back_to_peer(on_fly):
    client = TestClient(_build_app())

    response = client.get("/ip", headers={"Fly-Client-IP": "not-an-ip"})

    assert response.json()["key"] == "testclient"


def test_missing_fly_client_ip_falls_back_to_peer(on_fly):
    client = TestClient(_build_app())

    response = client.get("/ip")

    assert response.json()["key"] == "testclient"


def test_rotating_x_forwarded_for_cannot_bypass_rate_limit(on_fly):
    client = TestClient(_build_app("2 per minute"))

    statuses = [
        client.get(
            "/ip",
            headers={"X-Forwarded-For": f"198.51.100.{i}", "Fly-Client-IP": EDGE_IP},
        ).status_code
        for i in range(3)
    ]

    assert statuses == [200, 200, 429]


def test_app_uses_shared_helper_and_middleware_order():
    from humancompiler_api.main import app

    assert app_limiter._key_func is get_client_ip

    # user_middleware[0] is the outermost layer
    names = [
        getattr(m.kwargs.get("dispatch"), "__name__", None) or m.cls.__name__
        for m in app.user_middleware
    ]
    assert names[0] == "TrustedClientIPMiddleware"
    # Limiter sits inside CORS so 429 responses keep CORS headers
    assert names.index("cors_middleware") < names.index("DefaultRateLimitMiddleware")


@pytest.fixture
def enabled_app_limiter(monkeypatch):
    monkeypatch.setattr(app_limiter, "enabled", True)
    app_limiter.reset()
    yield
    app_limiter.reset()


def test_default_limit_applies_to_included_router_routes(
    on_fly, enabled_app_limiter, monkeypatch
):
    """Routes inside included routers must be covered, with CORS on the 429."""
    from humancompiler_api import rate_limiter
    from humancompiler_api.main import app

    monkeypatch.setattr(
        rate_limiter, "_DEFAULT_LIMIT_ITEMS", rate_limiter.parse_many("2 per minute")
    )
    client = TestClient(app)
    origin = "http://localhost:3000"

    def get(ip: str, spoofed: str = "198.51.100.1"):
        return client.get(
            "/api/projects/",
            headers={"Origin": origin, "Fly-Client-IP": ip, "X-Forwarded-For": spoofed},
        )

    assert get(EDGE_IP, "198.51.100.1").status_code != 429
    assert get(EDGE_IP, "198.51.100.2").status_code != 429
    limited = get(EDGE_IP, "198.51.100.3")
    assert limited.status_code == 429
    assert limited.headers["access-control-allow-origin"] == origin
    assert int(limited.headers["retry-after"]) >= 1

    # Another client is unaffected
    assert get("203.0.113.8").status_code != 429


async def test_default_limit_middleware_skips_websocket():
    calls = []

    async def inner(scope, receive, send):
        calls.append(scope["type"])

    await DefaultRateLimitMiddleware(inner)({"type": "websocket"}, None, None)
    assert calls == ["websocket"]
