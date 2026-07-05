import time
from unittest.mock import patch

import pytest

from humancompiler_api.database import Database


@pytest.mark.asyncio
async def test_health_check_uses_direct_database_connection():
    database = Database()

    with patch.object(
        database,
        "get_client",
        side_effect=AssertionError("Supabase Data API should not be used"),
    ):
        with patch.object(database, "_try_connect") as try_connect:
            assert await database.health_check() is True

    try_connect.assert_called_once()


@pytest.mark.asyncio
async def test_health_check_returns_false_on_direct_connection_failure():
    database = Database()

    with patch.object(database, "_try_connect", side_effect=RuntimeError("boom")):
        assert await database.health_check() is False


@pytest.mark.asyncio
async def test_health_check_disposes_engine_on_timeout():
    database = Database()

    with patch.object(database, "get_engine") as get_engine:
        engine = get_engine.return_value
        with patch("humancompiler_api.database.DB_HEALTH_CHECK_TIMEOUT_SECONDS", 0.01):
            with patch.object(
                database,
                "_try_connect",
                side_effect=lambda: time.sleep(0.1),
            ):
                assert await database.health_check() is False

    engine.dispose.assert_called_once()
