from io import BytesIO

from fastapi.testclient import TestClient

from backend.vdas_shift import database, ingest
from backend.vdas_shift.main import create_app


def test_csv_upload_schema_and_shift_map(tmp_path, monkeypatch):
    uploads = tmp_path / "uploads"
    dbc = tmp_path / "dbc"
    uploads.mkdir()
    dbc.mkdir()
    monkeypatch.setattr(ingest, "UPLOAD_DIR", uploads)
    monkeypatch.setattr(ingest, "DBC_DIR", dbc)
    monkeypatch.setattr(database, "DUCKDB_PATH", tmp_path / "test.duckdb")
    monkeypatch.setattr(database, "META_DB_PATH", tmp_path / "meta.sqlite")
    database._duck = None
    database._meta = None

    app = create_app()
    csv = b"Timestamp,EngSpeed,DriverRequestTorque,CurrentGear,TargetGear\n"
    csv += b"0.0,1800,80,2,2\n0.1,1900,90,2,2\n0.2,2050,95,2,3\n0.5,1700,70,3,3\n"
    with TestClient(app) as client:
        response = client.post(
            "/api/datasets/upload",
            files={"file": ("drive.csv", BytesIO(csv), "text/csv")},
            data={"tags": '["Vehicle A", "Normal"]'},
        )
        assert response.status_code == 200, response.text
        dataset = response.json()
        assert dataset["tags"] == ["Vehicle A", "Normal"]

        schema = client.get(f"/api/datasets/{dataset['id']}/schema").json()
        suggested = schema["suggested_mapping"]
        assert suggested["engine_speed"] == "EngSpeed"

        response = client.post(
            f"/api/datasets/{dataset['id']}/shift-map",
            json={
                "mapping": {
                    "time": "Timestamp",
                    "engine_speed": "EngSpeed",
                    "driver_torque": "DriverRequestTorque",
                    "current_gear": "CurrentGear",
                    "target_gear": "TargetGear",
                },
                "bins": 8,
            },
        )
        assert response.status_code == 200, response.text
        result = response.json()
        assert result["summary"]["event_count"] == 1
        assert result["events"][0]["transition"] == "2→3"
