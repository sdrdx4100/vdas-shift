from backend.vdas_shift.analysis import build_boundaries, extract_shift_events


def row(time: float, rpm: float, torque: float, current: int, target: int):
    return {
        "time": time,
        "engine_speed": rpm,
        "driver_torque": torque,
        "current_gear": current,
        "target_gear": target,
    }


def test_target_gear_edge_is_decision_point():
    rows = [
        row(0.0, 1800, 80, 2, 2),
        row(0.1, 1910, 86, 2, 2),
        row(0.2, 2020, 91, 2, 3),
        row(0.3, 1700, 70, 3, 3),
    ]
    events = extract_shift_events(rows)
    assert len(events) == 1
    assert events[0]["transition"] == "2→3"
    assert events[0]["rpm"] == 2020
    assert events[0]["torque"] == 91


def test_debounce_rejects_target_chatter():
    rows = [
        row(0.00, 1800, 80, 3, 3),
        row(0.10, 1900, 90, 3, 4),
        row(0.15, 1910, 91, 3, 3),
        row(0.19, 1920, 92, 3, 4),
    ]
    events = extract_shift_events(rows, debounce_seconds=0.25)
    assert len(events) == 1


def test_up_and_down_are_separated():
    rows = [
        row(0.0, 1800, 80, 3, 3),
        row(0.5, 2100, 95, 3, 4),
        row(1.0, 1500, 30, 4, 4),
        row(1.5, 1200, 10, 4, 3),
    ]
    events = extract_shift_events(rows)
    assert [event["direction"] for event in events] == ["up", "down"]


def test_boundary_contains_spread_and_confidence():
    events = [
        {"transition": "2→3", "direction": "up", "torque": torque, "rpm": 1500 + torque * 3}
        for torque in range(20, 121, 10)
    ]
    boundaries = build_boundaries(events, bins=4)
    assert len(boundaries) == 4
    assert all(item["rpm_p10"] <= item["rpm"] <= item["rpm_p90"] for item in boundaries)
    assert all(0 < item["confidence"] <= 1 for item in boundaries)
