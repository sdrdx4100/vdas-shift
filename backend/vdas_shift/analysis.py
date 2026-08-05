from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass
from statistics import median
from typing import Any

import numpy as np

from . import database as db
from .ingest import IngestError, get_dataset


REQUIRED_ROLES = ("engine_speed", "driver_torque", "current_gear", "target_gear")


@dataclass(frozen=True)
class Sample:
    index: int
    time: float
    rpm: float
    torque: float
    current: int
    target: int


def _finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _gear(value: Any) -> int | None:
    number = _finite(value)
    if number is None:
        return None
    gear = int(round(number))
    return gear if -1 <= gear <= 20 else None


def extract_shift_events(rows: list[dict[str, Any]], debounce_seconds: float = 0.25) -> list[dict[str, Any]]:
    """Extract transmission decisions, preferring target-gear edges over actual engagement."""
    samples: list[Sample] = []
    for index, row in enumerate(rows):
        rpm = _finite(row.get("engine_speed"))
        torque = _finite(row.get("driver_torque"))
        current = _gear(row.get("current_gear"))
        target = _gear(row.get("target_gear"))
        time = _finite(row.get("time"))
        if None in (rpm, torque, current, target):
            continue
        samples.append(Sample(index, time if time is not None else float(index), rpm, torque, current, target))

    events: list[dict[str, Any]] = []
    previous_target: int | None = None
    last_event_time = -float("inf")
    for sample in samples:
        target_changed = previous_target is not None and sample.target != previous_target
        if target_changed and sample.target != sample.current and sample.time - last_event_time >= debounce_seconds:
            to_gear = sample.target
            from_gear = sample.current
            if from_gear > 0 and to_gear > 0 and from_gear != to_gear:
                events.append({
                    "index": sample.index,
                    "time": sample.time,
                    "rpm": sample.rpm,
                    "torque": sample.torque,
                    "from_gear": from_gear,
                    "to_gear": to_gear,
                    "direction": "up" if to_gear > from_gear else "down",
                    "transition": f"{from_gear}→{to_gear}",
                })
                last_event_time = sample.time
        previous_target = sample.target
    return events


def _percentile(values: list[float], q: float) -> float:
    return float(np.percentile(np.asarray(values, dtype=float), q))


def build_boundaries(events: list[dict[str, Any]], bins: int = 10) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for event in events:
        grouped[event["transition"]].append(event)

    boundaries: list[dict[str, Any]] = []
    for transition, points in sorted(grouped.items()):
        if len(points) < 2:
            continue
        torques = [float(point["torque"]) for point in points]
        low, high = min(torques), max(torques)
        edges = np.linspace(low, high if high > low else low + 1.0, max(2, bins) + 1)
        for index in range(len(edges) - 1):
            bucket = [
                point for point in points
                if edges[index] <= float(point["torque"]) < edges[index + 1]
                or (index == len(edges) - 2 and float(point["torque"]) == edges[index + 1])
            ]
            if not bucket:
                continue
            rpms = [float(point["rpm"]) for point in bucket]
            boundaries.append({
                "transition": transition,
                "direction": bucket[0]["direction"],
                "torque": round(float(median(float(point["torque"]) for point in bucket)), 3),
                "rpm": round(float(median(rpms)), 3),
                "rpm_p10": round(_percentile(rpms, 10), 3),
                "rpm_p90": round(_percentile(rpms, 90), 3),
                "count": len(bucket),
                "confidence": round(min(1.0, len(bucket) / 8.0), 3),
            })
    return boundaries


def _quote(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def analyze_dataset(dataset_id: str, mapping: dict[str, str], bins: int = 10) -> dict[str, Any]:
    missing = [role for role in REQUIRED_ROLES if not mapping.get(role)]
    if missing:
        raise IngestError("必須信号が未割当です: " + ", ".join(missing))

    dataset = get_dataset(dataset_id)
    schema_rows: list[tuple[Any, ...]]
    with db.duck_read() as con:
        schema_rows = con.execute(f'DESCRIBE {_quote(dataset["table_name"])}').fetchall()
    columns = {str(row[0]) for row in schema_rows}
    unknown = [column for column in mapping.values() if column and column not in columns]
    if unknown:
        raise IngestError("存在しない信号です: " + ", ".join(unknown))

    time_expr = _quote(mapping["time"]) if mapping.get("time") else "row_number() OVER ()"
    select = [
        f"{time_expr} AS time",
        f"{_quote(mapping['engine_speed'])} AS engine_speed",
        f"{_quote(mapping['driver_torque'])} AS driver_torque",
        f"{_quote(mapping['current_gear'])} AS current_gear",
        f"{_quote(mapping['target_gear'])} AS target_gear",
    ]
    with db.duck_read() as con:
        frame = con.execute(
            f"SELECT {', '.join(select)} FROM {_quote(dataset['table_name'])}"
        ).fetchdf()
    events = extract_shift_events(frame.to_dict(orient="records"))
    boundaries = build_boundaries(events, bins=bins)
    transitions: dict[str, int] = defaultdict(int)
    for event in events:
        transitions[event["transition"]] += 1
    return {
        "dataset": dataset,
        "events": events,
        "boundaries": boundaries,
        "summary": {
            "event_count": len(events),
            "upshifts": sum(event["direction"] == "up" for event in events),
            "downshifts": sum(event["direction"] == "down" for event in events),
            "transitions": dict(sorted(transitions.items())),
            "coverage": "high" if len(events) >= 80 else "medium" if len(events) >= 25 else "low",
        },
    }
