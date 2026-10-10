# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import pytest
from sqlalchemy import create_engine

from humancompiler_api.database_config import sqlalchemy_database_url


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        (
            "postgresql://user:pass@db.example.com:5432/app",
            "postgresql+psycopg2://user:pass@db.example.com:5432/app",
        ),
        (
            "postgres://user:pass@db.example.com:5432/app",
            "postgresql+psycopg2://user:pass@db.example.com:5432/app",
        ),
        (
            "postgresql+psycopg2://user:pass@db.example.com/app",
            "postgresql+psycopg2://user:pass@db.example.com/app",
        ),
        ("sqlite:///:memory:", "sqlite:///:memory:"),
    ],
)
def test_sqlalchemy_database_url_pins_psycopg2(url: str, expected: str):
    assert sqlalchemy_database_url(url) == expected


def test_postgresql_url_creates_engine_with_installed_driver():
    """A bare postgresql:// URL must not resolve to the uninstalled psycopg v3."""
    engine = create_engine(sqlalchemy_database_url("postgresql://u:p@localhost/db"))
    try:
        assert engine.dialect.driver == "psycopg2"
    finally:
        engine.dispose()
