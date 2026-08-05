from backend.vdas_shift.ingest import suggest_mapping


def test_signal_mapping_suggestions_cover_j1939_style_names():
    columns = [
        "timestamps",
        "EEC1.EngSpeed",
        "TC1.DriverRequestTorque",
        "Transmission.CurrentGear",
        "Transmission.TargetGear",
        "CCVS1.VehicleSpeed",
    ]
    mapping = suggest_mapping(columns)
    assert mapping["time"] == "timestamps"
    assert mapping["engine_speed"] == "EEC1.EngSpeed"
    assert mapping["driver_torque"] == "TC1.DriverRequestTorque"
    assert mapping["current_gear"] == "Transmission.CurrentGear"
    assert mapping["target_gear"] == "Transmission.TargetGear"
