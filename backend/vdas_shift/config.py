from __future__ import annotations

import os
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.environ.get("VDAS_SHIFT_DATA_DIR", ROOT / "data")).resolve()
UPLOAD_DIR = DATA_DIR / "uploads"
DBC_DIR = DATA_DIR / "dbc"
DUCKDB_PATH = DATA_DIR / "vdas_shift.duckdb"
META_DB_PATH = DATA_DIR / "meta.sqlite"


def ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    DBC_DIR.mkdir(parents=True, exist_ok=True)
