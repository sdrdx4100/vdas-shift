from __future__ import annotations

import sqlite3
import threading
from contextlib import contextmanager
from typing import Any, Iterator

import duckdb

from .config import DUCKDB_PATH, META_DB_PATH, ensure_dirs


_write_lock = threading.RLock()
_meta_lock = threading.RLock()
_duck: duckdb.DuckDBPyConnection | None = None
_meta: sqlite3.Connection | None = None

META_SCHEMA = """
CREATE TABLE IF NOT EXISTS datasets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    stored_path TEXT NOT NULL,
    table_name TEXT NOT NULL UNIQUE,
    file_type TEXT NOT NULL,
    row_count INTEGER NOT NULL,
    column_count INTEGER NOT NULL,
    file_size INTEGER NOT NULL,
    tags TEXT NOT NULL DEFAULT '[]',
    dbc_filename TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS signal_mappings (
    dataset_id TEXT PRIMARY KEY,
    mapping TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(dataset_id) REFERENCES datasets(id) ON DELETE CASCADE
);
"""


def init() -> None:
    global _duck, _meta
    ensure_dirs()
    if _duck is None:
        _duck = duckdb.connect(str(DUCKDB_PATH))
    if _meta is None:
        _meta = sqlite3.connect(str(META_DB_PATH), check_same_thread=False)
        _meta.row_factory = sqlite3.Row
        _meta.execute("PRAGMA foreign_keys=ON")
        _meta.executescript(META_SCHEMA)
        _meta.commit()


@contextmanager
def duck_write() -> Iterator[duckdb.DuckDBPyConnection]:
    if _duck is None:
        init()
    with _write_lock:
        yield _duck  # type: ignore[misc]


@contextmanager
def duck_read() -> Iterator[duckdb.DuckDBPyConnection]:
    if _duck is None:
        init()
    with _write_lock:
        cursor = _duck.cursor()  # type: ignore[union-attr]
        try:
            yield cursor
        finally:
            cursor.close()


def meta_query(sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    if _meta is None:
        init()
    with _meta_lock:
        rows = _meta.execute(sql, params).fetchall()  # type: ignore[union-attr]
        return [dict(row) for row in rows]


def meta_execute(sql: str, params: tuple[Any, ...] = ()) -> None:
    if _meta is None:
        init()
    with _meta_lock:
        _meta.execute(sql, params)  # type: ignore[union-attr]
        _meta.commit()  # type: ignore[union-attr]
