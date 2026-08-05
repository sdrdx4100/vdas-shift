from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path
from typing import Any, BinaryIO

import pandas as pd

from . import database as db
from .config import DBC_DIR, UPLOAD_DIR


SUPPORTED_EXTENSIONS = {".csv", ".parquet", ".pq", ".mf4", ".mdf"}


class IngestError(Exception):
    pass


def _clean_tags(tags: list[str] | None) -> list[str]:
    result: list[str] = []
    for value in tags or []:
        tag = str(value).strip()
        if tag and tag not in result:
            result.append(tag)
    return result


def _mf4_dataframe(path: Path, dbc_path: Path | None) -> pd.DataFrame:
    try:
        from asammdf import MDF
    except ImportError as exc:  # pragma: no cover - dependency installation issue
        raise IngestError("MF4読込には asammdf が必要です") from exc

    try:
        with MDF(path) as source:
            if dbc_path:
                decoded = source.extract_bus_logging(
                    database_files={"CAN": [(str(dbc_path), 0)]},
                    ignore_value2text_conversion=True,
                )
                try:
                    frame = decoded.to_dataframe(
                        time_from_zero=True,
                        numeric_1D_only=True,
                        use_interpolation=True,
                    )
                finally:
                    decoded.close()
            else:
                frame = source.to_dataframe(
                    time_from_zero=True,
                    numeric_1D_only=True,
                    use_interpolation=True,
                )
    except Exception as exc:
        hint = "。Raw CANを含む場合は対応するDBCを指定してください" if not dbc_path else ""
        raise IngestError(f"MF4の展開に失敗しました: {exc}{hint}") from exc

    if frame.empty or not len(frame.columns):
        raise IngestError("MF4から数値信号を取得できませんでした")
    frame.index.name = "Timestamp"
    frame = frame.reset_index()
    frame.columns = _unique_columns([str(c) for c in frame.columns])
    return frame


def _unique_columns(columns: list[str]) -> list[str]:
    counts: dict[str, int] = {}
    result: list[str] = []
    for name in columns:
        base = name.strip() or "unnamed"
        count = counts.get(base, 0)
        result.append(base if count == 0 else f"{base}_{count + 1}")
        counts[base] = count + 1
    return result


def ingest_file(
    fileobj: BinaryIO,
    original_filename: str,
    dataset_name: str | None = None,
    tags: list[str] | None = None,
    dbc_fileobj: BinaryIO | None = None,
    dbc_filename: str | None = None,
) -> dict[str, Any]:
    ext = Path(original_filename).suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise IngestError("未対応形式です（MF4 / MDF / CSV / Parquet に対応）")

    dataset_id = uuid.uuid4().hex[:12]
    table_name = f"ds_{dataset_id}"
    stored_path = UPLOAD_DIR / f"{dataset_id}{ext}"
    dbc_path: Path | None = None

    with stored_path.open("wb") as output:
        shutil.copyfileobj(fileobj, output)
    if dbc_fileobj and dbc_filename:
        dbc_path = DBC_DIR / f"{dataset_id}{Path(dbc_filename).suffix.lower() or '.dbc'}"
        with dbc_path.open("wb") as output:
            shutil.copyfileobj(dbc_fileobj, output)

    try:
        with db.duck_write() as con:
            if ext == ".csv":
                con.execute(
                    f'CREATE TABLE "{table_name}" AS SELECT * FROM read_csv_auto(?, sample_size=-1)',
                    [str(stored_path)],
                )
            elif ext in {".parquet", ".pq"}:
                con.execute(
                    f'CREATE TABLE "{table_name}" AS SELECT * FROM read_parquet(?)',
                    [str(stored_path)],
                )
            else:
                frame = _mf4_dataframe(stored_path, dbc_path)
                con.register("_mf4_import", frame)
                try:
                    con.execute(f'CREATE TABLE "{table_name}" AS SELECT * FROM _mf4_import')
                finally:
                    con.unregister("_mf4_import")
            row_count = con.execute(f'SELECT count(*) FROM "{table_name}"').fetchone()[0]
            columns = con.execute(f'DESCRIBE "{table_name}"').fetchall()
    except Exception as exc:
        stored_path.unlink(missing_ok=True)
        if dbc_path:
            dbc_path.unlink(missing_ok=True)
        if isinstance(exc, IngestError):
            raise
        raise IngestError(f"ファイルの読み込みに失敗しました: {exc}") from exc

    name = (dataset_name or Path(original_filename).stem).strip()
    db.meta_execute(
        """INSERT INTO datasets
        (id, name, original_filename, stored_path, table_name, file_type,
         row_count, column_count, file_size, tags, dbc_filename)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            dataset_id,
            name,
            original_filename,
            str(stored_path),
            table_name,
            ext.lstrip("."),
            row_count,
            len(columns),
            stored_path.stat().st_size,
            json.dumps(_clean_tags(tags), ensure_ascii=False),
            dbc_filename,
        ),
    )
    return get_dataset(dataset_id)


def _decode(row: dict[str, Any]) -> dict[str, Any]:
    row["tags"] = json.loads(row.get("tags") or "[]")
    return row


def get_dataset(dataset_id: str) -> dict[str, Any]:
    rows = db.meta_query("SELECT * FROM datasets WHERE id = ?", (dataset_id,))
    if not rows:
        raise IngestError(f"データセットが見つかりません: {dataset_id}")
    return _decode(rows[0])


def list_datasets() -> list[dict[str, Any]]:
    return [_decode(row) for row in db.meta_query("SELECT * FROM datasets ORDER BY created_at DESC")]


def update_tags(dataset_id: str, tags: list[str]) -> dict[str, Any]:
    get_dataset(dataset_id)
    db.meta_execute(
        "UPDATE datasets SET tags = ? WHERE id = ?",
        (json.dumps(_clean_tags(tags), ensure_ascii=False), dataset_id),
    )
    return get_dataset(dataset_id)


def all_tags() -> list[str]:
    return sorted({tag for dataset in list_datasets() for tag in dataset["tags"]})


def dataset_schema(dataset_id: str) -> dict[str, Any]:
    dataset = get_dataset(dataset_id)
    with db.duck_read() as con:
        described = con.execute(f'DESCRIBE "{dataset["table_name"]}"').fetchall()
    numeric = (
        "TINYINT", "SMALLINT", "INTEGER", "BIGINT", "HUGEINT", "UTINYINT",
        "USMALLINT", "UINTEGER", "UBIGINT", "FLOAT", "DOUBLE", "DECIMAL",
    )
    columns = [
        {"name": row[0], "type": row[1], "kind": "numeric" if row[1].upper().startswith(numeric) else "other"}
        for row in described
    ]
    return {"dataset": dataset, "columns": columns, "suggested_mapping": suggest_mapping([c["name"] for c in columns])}


SIGNAL_ALIASES = {
    "time": ("timestamp", "time", "elapsed", "zeit", "時刻", "時間"),
    "engine_speed": ("enginespeed", "engine_speed", "engspeed", "n_engine", "rpm", "エンジン回転"),
    "driver_torque": ("drivertorquerequest", "driverrequesttorque", "driver_torque", "drreqtorque", "dr_tq", "requestedtorque", "要求トルク"),
    "current_gear": ("currentgear", "current_gear", "actualgear", "gearactual", "現在ギア", "ギア位置"),
    "target_gear": ("targetgear", "target_gear", "requestedgear", "geartarget", "目標ギア"),
    "vehicle_speed": ("vehiclespeed", "vehicle_speed", "vehspd", "v_vehicle", "車速"),
    "accelerator": ("accelerator", "accpedal", "pedal", "aps", "アクセル"),
    "brake": ("brake", "brakepedal", "brksw", "ブレーキ"),
    "mode": ("drivemode", "drive_mode", "shiftmode", "mode", "走行モード"),
}


def _normalize(name: str) -> str:
    return "".join(ch.lower() for ch in name if ch.isalnum() or ord(ch) > 127)


def suggest_mapping(columns: list[str]) -> dict[str, str | None]:
    normalized = {column: _normalize(column) for column in columns}
    result: dict[str, str | None] = {}
    for role, aliases in SIGNAL_ALIASES.items():
        choices = [
            (0 if value == _normalize(alias) else 1, len(value), column)
            for column, value in normalized.items()
            for alias in aliases
            if _normalize(alias) in value
        ]
        result[role] = min(choices)[2] if choices else None
    return result


def delete_dataset(dataset_id: str) -> None:
    dataset = get_dataset(dataset_id)
    with db.duck_write() as con:
        con.execute(f'DROP TABLE IF EXISTS "{dataset["table_name"]}"')
    Path(dataset["stored_path"]).unlink(missing_ok=True)
    db.meta_execute("DELETE FROM datasets WHERE id = ?", (dataset_id,))
