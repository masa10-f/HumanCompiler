"""Tests that users.email follows the Supabase account (email sync in auth)."""

import logging
from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import UUID

import pytest
from sqlmodel import Session

from humancompiler_api import auth
from humancompiler_api.models import User

USER_ID = "12345678-1234-1234-1234-123456789012"
OLD_EMAIL = "old-address@example.com"
NEW_EMAIL = "new-address@example.com"
OLD_UPDATED_AT = datetime(2020, 1, 1, 0, 0, 0, tzinfo=UTC)


@pytest.fixture(autouse=True)
def clean_cache():
    with auth._known_users_lock:
        auth._known_users.clear()
    yield
    with auth._known_users_lock:
        auth._known_users.clear()


@pytest.fixture
def engine_calls(session: Session, monkeypatch):
    """Point auth at the test engine and count how often the DB is opened."""
    calls: list[int] = []

    def get_engine():
        calls.append(1)
        return session.get_bind()

    monkeypatch.setattr(auth, "db", SimpleNamespace(get_engine=get_engine))
    return calls


@pytest.fixture
def stored_user(session: Session) -> User:
    user = User(
        id=UUID(USER_ID),
        email=OLD_EMAIL,
        created_at=OLD_UPDATED_AT,
        updated_at=OLD_UPDATED_AT,
    )
    session.add(user)
    session.commit()
    return user


def _reload(session: Session) -> User:
    session.expire_all()
    user = session.get(User, UUID(USER_ID))
    assert user is not None
    return user


def test_stale_email_is_updated(session, stored_user, engine_calls):
    auth._ensure_user_exists_sync(USER_ID, NEW_EMAIL)

    user = _reload(session)
    assert user.email == NEW_EMAIL
    assert user.updated_at is not None
    assert user.updated_at > OLD_UPDATED_AT


def test_stale_email_is_updated_in_direct_model_fallback(
    session, stored_user, engine_calls, monkeypatch
):
    def broken_get_user(*args, **kwargs):
        raise RuntimeError("UserService is down")

    monkeypatch.setattr(auth.UserService, "get_user", broken_get_user)

    auth._ensure_user_exists_sync(USER_ID, NEW_EMAIL)

    assert _reload(session).email == NEW_EMAIL


@pytest.mark.parametrize("bad_email", [auth.FALLBACK_EMAIL, "", None])
def test_non_real_email_never_overwrites(session, stored_user, engine_calls, bad_email):
    auth._ensure_user_exists_sync(USER_ID, bad_email)

    user = _reload(session)
    assert user.email == OLD_EMAIL
    assert user.updated_at == OLD_UPDATED_AT


@pytest.mark.parametrize("bad_email", [auth.FALLBACK_EMAIL, "", None])
def test_non_real_email_never_overwrites_in_direct_model_fallback(
    session, stored_user, engine_calls, monkeypatch, bad_email
):
    def broken_get_user(*args, **kwargs):
        raise RuntimeError("UserService is down")

    monkeypatch.setattr(auth.UserService, "get_user", broken_get_user)

    auth._ensure_user_exists_sync(USER_ID, bad_email)

    user = _reload(session)
    assert user.email == OLD_EMAIL
    assert user.updated_at == OLD_UPDATED_AT


def test_same_email_does_not_touch_updated_at(session, stored_user, engine_calls):
    auth._ensure_user_exists_sync(USER_ID, OLD_EMAIL)

    user = _reload(session)
    assert user.email == OLD_EMAIL
    assert user.updated_at == OLD_UPDATED_AT


def test_missing_user_is_still_created(session, engine_calls):
    auth._ensure_user_exists_sync(USER_ID, NEW_EMAIL)

    assert _reload(session).email == NEW_EMAIL


def test_update_failure_does_not_raise(session, stored_user, engine_calls, monkeypatch):
    other = User(id=UUID("87654321-4321-8765-4321-876543218765"), email=NEW_EMAIL)
    session.add(other)
    session.commit()

    # The email column is unique, so this update fails; auth must carry on.
    auth._ensure_user_exists_sync(USER_ID, NEW_EMAIL)

    assert _reload(session).email == OLD_EMAIL


@pytest.mark.asyncio
async def test_cache_hit_with_same_email_skips_db(session, stored_user, engine_calls):
    await auth.ensure_user_exists(USER_ID, OLD_EMAIL)
    assert len(engine_calls) == 1

    await auth.ensure_user_exists(USER_ID, OLD_EMAIL)
    assert len(engine_calls) == 1


@pytest.mark.asyncio
async def test_cache_hit_with_fallback_email_skips_db(
    session, stored_user, engine_calls
):
    await auth.ensure_user_exists(USER_ID, OLD_EMAIL)
    await auth.ensure_user_exists(USER_ID, auth.FALLBACK_EMAIL)
    await auth.ensure_user_exists(USER_ID, "")

    assert len(engine_calls) == 1
    assert _reload(session).email == OLD_EMAIL


@pytest.mark.asyncio
async def test_cache_miss_with_new_real_email_updates_row(
    session, stored_user, engine_calls
):
    await auth.ensure_user_exists(USER_ID, OLD_EMAIL)
    assert len(engine_calls) == 1

    await auth.ensure_user_exists(USER_ID, NEW_EMAIL)
    assert len(engine_calls) == 2
    assert _reload(session).email == NEW_EMAIL

    # The new address is now cached: no further DB access.
    await auth.ensure_user_exists(USER_ID, NEW_EMAIL)
    assert len(engine_calls) == 2


@pytest.mark.parametrize("use_fallback_branch", [False, True])
def test_logs_never_contain_email_addresses(
    session, stored_user, engine_calls, monkeypatch, caplog, use_fallback_branch
):
    if use_fallback_branch:

        def broken_get_user(*args, **kwargs):
            raise RuntimeError("UserService is down")

        monkeypatch.setattr(auth.UserService, "get_user", broken_get_user)

    created_email = "created-user@example.com"
    with caplog.at_level(logging.DEBUG, logger=auth.logger.name):
        auth._ensure_user_exists_sync(USER_ID, NEW_EMAIL)  # update
        auth._ensure_user_exists_sync(USER_ID, NEW_EMAIL)  # no-op
        session.expire_all()
        session.delete(session.get(User, UUID(USER_ID)))
        session.commit()
        auth._ensure_user_exists_sync(USER_ID, created_email)  # create

    assert "Updated" in caplog.text or "updated" in caplog.text
    assert USER_ID in caplog.text
    for address in (OLD_EMAIL, NEW_EMAIL, created_email):
        assert address not in caplog.text
    assert "@example.com" not in caplog.text
