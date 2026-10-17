# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""
Trusted client IP resolution (Issue #358)

uvicorn runs with ``--forwarded-allow-ips "*"`` (see Dockerfile), so
``scope["client"]`` is taken from the left-most X-Forwarded-For entry, which
the client controls. On Fly.io the edge proxy sets ``Fly-Client-IP`` to the
address it accepted the connection from, so that header is preferred there.
Everywhere else (local dev, tests) the header is ignored and the peer address
is used, so a client cannot pick its own IP by sending ``Fly-Client-IP``.
"""

import ipaddress
import os

from starlette.requests import Request
from starlette.types import ASGIApp, Receive, Scope, Send

FLY_CLIENT_IP_HEADER = b"fly-client-ip"

# Same fallback as slowapi's get_remote_address
_FALLBACK_IP = "127.0.0.1"


def _running_on_fly() -> bool:
    """Fly.io sets FLY_APP_NAME on every Machine."""
    return bool(os.environ.get("FLY_APP_NAME"))


def _fly_client_ip(scope: Scope) -> str | None:
    """Return the edge-supplied client IP, or None when it must not be used."""
    if not _running_on_fly():
        return None

    value = None
    for name, raw in scope.get("headers", []):
        if name == FLY_CLIENT_IP_HEADER:
            # Proxies append, so the last occurrence is the edge's own value
            value = raw.decode("latin-1").strip()
    if not value:
        return None

    try:
        return str(ipaddress.ip_address(value))
    except ValueError:
        return None


def resolve_client_ip(scope: Scope) -> str:
    """Resolve the client IP for an ASGI scope."""
    fly_ip = _fly_client_ip(scope)
    if fly_ip:
        return fly_ip

    client = scope.get("client")
    if client and client[0]:
        return str(client[0])
    return _FALLBACK_IP


def get_client_ip(request: Request) -> str:
    """
    Single source of truth for the client IP.

    Use this for rate-limit keys and for any logged or stored client IP.
    """
    return resolve_client_ip(request.scope)


class TrustedClientIPMiddleware:
    """
    Rewrite ``scope["client"]`` with the trusted IP on Fly.io.

    This keeps ``request.client.host`` and uvicorn's access log consistent with
    get_client_ip(). Register it as the outermost middleware.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] in ("http", "websocket"):
            fly_ip = _fly_client_ip(scope)
            if fly_ip:
                client = scope.get("client")
                scope["client"] = (fly_ip, client[1] if client else 0)
        await self.app(scope, receive, send)
