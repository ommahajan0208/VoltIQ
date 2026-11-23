"""FastAPI validation and capability-boundary tests."""

from datetime import datetime, timedelta

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend.app import store
from backend.app.main import app


@pytest.fixture()
def api(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "ROOT", tmp_path)
    monkeypatch.setattr(store, "DB", tmp_path / "metadata.sqlite3")
    store.init()
    client = TestClient(app, base_url="http://127.0.0.1")
    start = datetime(2007, 1, 1)
    observations = tmp_path / "observations.parquet"
    pd.DataFrame({
        "bin_start": [start],
        "bin_end": [start + timedelta(minutes=15)],
        "active_power_kw": [1.0],
        "observed_energy_kwh": [0.25],
        "valid_active_minutes": [15],
        "expected_minutes": [15],
        "quality": ["complete"],
    }).to_parquet(observations, index=False)
    dataset = {
        "id": "ds_api", "version": "v1", "status": "ready",
        "source_kind": "test", "source_hash": "fixture",
        "from": start.isoformat(),
        "to": (start + timedelta(minutes=15)).isoformat(),
        "manifest": {"observations_path": str(observations)},
        "capabilities": {"observations": True, "forecast": True,
                          "evaluation": True, "circuits": False,
                          "autoencoder": False},
    }
    store.put("dataset", dataset)
    store.put("run", {
        "id": "run_api", "dataset_id": "ds_api", "dataset_version": "v1",
        "model_id": "persistence", "status": "succeeded",
        "evaluation_kind": "held_out", "config": {}, "manifest": {},
        "test_from": start.isoformat(),
        "test_to": (start + timedelta(minutes=15)).isoformat(),
    })
    return client


def test_health_and_unsupported_capabilities_have_stable_errors(api):
    health = api.get("/api/v1/health")
    assert health.status_code == 200
    assert health.json()["data"]["worker"] == "separate_process"

    experiment = api.post("/api/v1/experiments", json={})
    assert experiment.status_code == 422
    assert experiment.json()["error"]["code"] == "unsupported_experiment"

    bundle = api.post("/api/v1/bundles/import", json={})
    assert bundle.status_code == 422
    assert bundle.json()["error"]["code"] == "unsupported_bundle"


def test_run_and_forecast_validation_rejects_wrong_identity_or_parameters(api):
    wrong_version = api.post("/api/v1/runs", json={
        "dataset_id": "ds_api", "dataset_version": "wrong",
        "model_id": "persistence", "evaluation_kind": "held_out",
    }, headers={"Idempotency-Key": "wrong-version"})
    assert wrong_version.status_code == 409
    assert wrong_version.json()["error"]["code"] == "version_conflict"

    invalid_model = api.post("/api/v1/runs", json={
        "dataset_id": "ds_api", "dataset_version": "v1",
        "model_id": "unknown", "evaluation_kind": "held_out",
    }, headers={"Idempotency-Key": "invalid-model"})
    assert invalid_model.status_code == 422

    invalid_horizon = api.post("/api/v1/runs/run_api/forecasts",
                               json={"horizon": 2})
    assert invalid_horizon.status_code == 422
    assert invalid_horizon.json()["error"]["code"] == "invalid_horizon"

    historical_without_origin = api.post(
        "/api/v1/runs/run_api/forecasts",
        json={"origin_mode": "historical", "horizon": 1},
    )
    assert historical_without_origin.status_code == 422
    assert historical_without_origin.json()["error"]["code"] == "invalid_origin"


@pytest.mark.parametrize("quantile", [0.94, 1.0, "0.98"])
def test_threshold_preview_rejects_invalid_quantiles(api, quantile):
    response = api.post("/api/v1/runs/run_api/threshold-previews",
                        json={"validation_quantile": quantile})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_quantile"
