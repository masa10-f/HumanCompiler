"""
WebSocket Router for Real-time Notifications (Issue #228)

Provides WebSocket endpoint for real-time checkout notifications:
- Connection management per user
- Heartbeat/ping-pong for connection health
- Real-time notification delivery
"""

import asyncio
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, Query
from sqlmodel import Session

from humancompiler_api.database import db
from humancompiler_api.auth import verify_token_for_websocket
from humancompiler_api.notification_service import connection_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ws", tags=["websocket"])


@router.websocket("/notifications/{user_id}")
async def websocket_notifications(
    websocket: WebSocket,
    user_id: str,
    token: Annotated[str | None, Query()] = None,
):
    """
    WebSocket endpoint for real-time notifications.

    Authentication is done via query parameter token.
    The connection is kept alive with ping-pong heartbeat.

    Messages sent to client:
    - type: "notification" - Checkout reminder notifications
    - type: "pong" - Response to ping

    Messages received from client:
    - "ping" - Heartbeat request, server responds with "pong"
    """
    # Validate token
    if not token:
        logger.warning(
            f"WebSocket connection rejected: no token provided for user {user_id}"
        )
        await websocket.close(code=4001, reason="Authentication required")
        return

    try:
        auth_user = await verify_token_for_websocket(token)
        if str(auth_user.user_id) != user_id:
            logger.warning(
                f"WebSocket connection rejected: user_id mismatch "
                f"(token: {auth_user.user_id}, requested: {user_id})"
            )
            await websocket.close(code=4003, reason="User ID mismatch")
            return
    except Exception as e:
        logger.warning(f"WebSocket authentication failed: {e}")
        await websocket.close(code=4001, reason="Authentication failed")
        return

    # Accept connection
    await connection_manager.connect(websocket, user_id)

    try:
        # Send initial connection confirmation
        await websocket.send_json(
            {
                "type": "connected",
                "user_id": user_id,
                "message": "WebSocket connection established",
            }
        )

        while True:
            try:
                # Wait for messages with timeout for heartbeat
                data = await asyncio.wait_for(
                    websocket.receive_text(),
                    timeout=60.0,  # 60 second timeout
                )

                # Handle ping-pong
                if data == "ping":
                    await websocket.send_text("pong")
                elif data == "status":
                    # Return connection status
                    await websocket.send_json(
                        {
                            "type": "status",
                            "connected": True,
                            "user_id": user_id,
                            "active_connections": connection_manager.get_connection_count(
                                user_id
                            ),
                        }
                    )
                else:
                    # Echo unknown messages back with type info
                    await websocket.send_json(
                        {
                            "type": "echo",
                            "message": data,
                        }
                    )

            except TimeoutError:
                # Send a ping to check if connection is still alive
                try:
                    await websocket.send_json({"type": "ping"})
                except Exception:
                    # Connection is dead
                    break

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for user {user_id}")
    except Exception as e:
        logger.error(f"WebSocket error for user {user_id}: {e}")
    finally:
        connection_manager.disconnect(websocket, user_id)


@router.get("/status")
async def websocket_status():
    """
    Get WebSocket service status (for debugging/monitoring).
    Returns the number of connected users.
    """
    total_connections = sum(
        len(connections)
        for connections in connection_manager.active_connections.values()
    )
    total_users = len(connection_manager.active_connections)

    return {
        "status": "active",
        "connected_users": total_users,
        "total_connections": total_connections,
    }
