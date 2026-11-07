"""Saved-run smoke test across SQLite queue, evaluator and analytical HTTP routes."""

from datetime import datetime, timedelta

import numpy as np
import pandas as pd
from fastapi.testclient import TestClient

from backend.app import store, worker
from backend.app.main import app


def test_baseline_saved_run_round_trip(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "ROOT", tmp_path)
    monkeypatch.setattr(store, "DB", tmp_path / "metadata.sqlite3")
    store.init()
    start = datetime(2007, 1, 1)
    times = [start + timedelta(minutes=15 * i) for i in range(31 * 96)]
    values = 1.0 + 0.3 * np.sin(np.arange(len(times)) * 2 * np.pi / 96)
    values[29 * 96 + 2] += 3.0
    rows = pd.DataFrame({
        "bin_start": times, "bin_end": [t + timedelta(minutes=15) for t in times],
        "active_power_kw": values, "observed_energy_kwh": values * 0.25,
        "valid_active_minutes": 15, "expected_minutes": 15,
        "quality": "complete", "sub1_observed_wh": 0.0, "sub2_observed_wh": 0.0,
        "sub3_observed_wh": 0.0, "remainder_observed_wh": values * 250,
    })
    observations = tmp_path / "observations.parquet"
    rows.to_parquet(observations, index=False)
    dataset = {
        "id": "ds_smoke", "version": "v_smoke", "label": "Smoke readings",
        "source_kind": "test", "source_hash": "fixture", "status": "ready",
        "from": start.isoformat(), "to": (times[-1] + timedelta(minutes=15)).isoformat(),
        "manifest": {"dataset_id": "ds_smoke", "source_sha256": "fixture",
                     "observations_path": str(observations)},
        "capabilities": {"observations": True, "forecast": True,
                         "evaluation": True, "circuits": False, "autoencoder": False},
    }
    store.put("dataset", dataset)
    client = TestClient(app, base_url="http://127.0.0.1")
    quality = client.get("/api/v1/datasets/ds_smoke/quality")
    assert quality.status_code == 200, quality.text
    assert quality.json()["data"]["selected_rows"] is None
    assert quality.json()["data"]["complete_bins"] is None
    assert quality.json()["data"]["coverage"] == 1.0
    request = {
        "dataset_id": dataset["id"], "dataset_version": dataset["version"],
        "model_id": "persistence", "evaluation_kind": "held_out",
        "config": {"context_bins": 192, "horizons": [1, 4, 16],
                   "threshold_quantile": 0.99},
    }
    response = client.post("/api/v1/runs", json=request, headers={"Idempotency-Key": "smoke-run"})
    assert response.status_code == 202, response.text
    replay = client.post("/api/v1/runs", json=request, headers={"Idempotency-Key": "smoke-run"})
    assert replay.json()["data"]["job_id"] == response.json()["data"]["job_id"]
    changed = {**request, "config": {**request["config"], "threshold_quantile": 0.98}}
    assert client.post("/api/v1/runs", json=changed,
                       headers={"Idempotency-Key": "smoke-run"}).status_code == 409
    run_id = response.json()["data"]["run_id"]
    job_id = response.json()["data"]["job_id"]
    assert worker.run_once()
    assert client.get(f"/api/v1/jobs/{job_id}").json()["data"]["status"] == "succeeded"
    assert client.get(f"/api/v1/runs/{run_id}").json()["data"]["status"] == "succeeded"
    metrics = client.get(f"/api/v1/runs/{run_id}/metrics")
    assert metrics.status_code == 200, metrics.text
    assert any(row["horizon"] == 1 and row["count"] > 0 for row in metrics.json()["data"])
    forecast = client.get(f"/api/v1/runs/{run_id}/forecasts?horizon=1")
    assert forecast.status_code == 200, forecast.text
    assert forecast.json()["data"][0]["step"] == 1
    scores = client.get(f"/api/v1/runs/{run_id}/scores?detector=residual")
    assert scores.status_code == 200, scores.text
    event_response = client.get(f"/api/v1/runs/{run_id}/events")
    assert event_response.status_code == 200
    events = event_response.json()["data"]
    assert events
    event_id = events[0]["id"]
    assert client.get(f"/api/v1/events/{event_id}").status_code == 200
    saved_review = client.patch(f"/api/v1/events/{event_id}/review",
                                json={"status": "reviewed", "note": "Checked interval",
                                      "expected_revision": 0})
    assert saved_review.status_code == 200
    stale = client.patch(f"/api/v1/events/{event_id}/review",
                         json={"status": "needs_followup", "note": "Stale note",
                               "expected_revision": 0})
    assert stale.status_code == 409
    assert stale.json()["error"]["details"]["current_review"]["revision"] == 1
    overview = client.get(f"/api/v1/runs/{run_id}/overview")
    assert overview.status_code == 200, overview.text
    assert overview.json()["data"]["observed_energy_kwh"] > 0
    export = client.post("/api/v1/exports", json={"kind": "scores", "run_id": run_id},
                         headers={"Idempotency-Key": "smoke-export"})
    assert export.status_code == 202, export.text
    assert worker.run_once()
    export_job = client.get(f"/api/v1/jobs/{export.json()['data']['job_id']}").json()["data"]
    assert export_job["status"] == "succeeded", export_job
    csv_file = client.get(f"/api/v1/artifacts/{export_job['artifact_id']}/download")
    assert csv_file.status_code == 200 and b"candidate" in csv_file.content
    for kind in ("observations", "forecasts", "events"):
        queued = client.post("/api/v1/exports", json={"kind": kind,
                             "dataset_id": dataset["id"], "run_id": run_id,
                             "filters": {"from": start.isoformat(),
                                         "to": dataset["to"]}},
                             headers={"Idempotency-Key": f"smoke-{kind}"})
        assert queued.status_code == 202, queued.text
        assert worker.run_once()
        completed = client.get(f"/api/v1/jobs/{queued.json()['data']['job_id']}").json()["data"]
        assert completed["status"] == "succeeded", completed
        assert client.get(f"/api/v1/artifacts/{completed['artifact_id']}/download").status_code == 200
    report = client.post("/api/v1/reports", json={"run_id": run_id,
                         "sections": ["consumption", "events", "quality", "methodology", "notes"],
                         "format": "pdf"},
                         headers={"Idempotency-Key": "smoke-report"})
    assert report.status_code == 202, report.text
    frozen = store.get("report", report.json()["data"]["report_id"])
    assert frozen["notes_snapshot"][0]["note"] == "Checked interval"
    assert client.patch(f"/api/v1/events/{event_id}/review",
                        json={"status": "reviewed", "note": "Later edit",
                              "expected_revision": 1}).status_code == 200
    assert worker.run_once()
    report_job = client.get(f"/api/v1/jobs/{report.json()['data']['job_id']}").json()["data"]
    assert report_job["status"] == "succeeded", report_job
    pdf = client.get(f"/api/v1/artifacts/{report_job['artifact_id']}/download")
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    inline = client.get(f"/api/v1/artifacts/{report_job['artifact_id']}/preview")
    assert inline.status_code == 200 and inline.content == pdf.content
    assert inline.headers["content-disposition"].startswith("inline")
    preview = client.post(f"/api/v1/runs/{run_id}/threshold-previews",
                          json={"validation_quantile": 0.98, "exploratory": True},
                          headers={"Idempotency-Key": "smoke-threshold"})
    assert preview.status_code == 202, preview.text
    assert worker.run_once()
    preview_job = client.get(f"/api/v1/jobs/{preview.json()['data']['job_id']}").json()["data"]
    assert preview_job["status"] == "succeeded", preview_job
    assert client.get(f"/api/v1/artifacts/{preview_job['artifact_id']}/download").json()["evaluation_kind"] == "exploratory_preview"
    inference = client.post("/api/v1/runs", json={
        "dataset_id": dataset["id"], "dataset_version": dataset["version"],
        "model_id": "persistence", "evaluation_kind": "inference",
        "config": {"context_bins": 192},
    }, headers={"Idempotency-Key": "smoke-inference"})
    assert inference.status_code == 202, inference.text
    assert worker.run_once()
    inference_id = inference.json()["data"]["run_id"]
    created = client.post(f"/api/v1/runs/{inference_id}/forecasts", json={
        "origin_mode": "dataset_endpoint", "horizon": 4, "model_id": "persistence",
    }, headers={"Idempotency-Key": "smoke-future"})
    assert created.status_code == 202, created.text
    assert worker.run_once()
    generated = client.get(f"/api/v1/runs/{inference_id}/forecasts?horizon=4")
    assert generated.status_code == 200, generated.text
    future = generated.json()["data"]
    assert len(future) == 4 and all(row["actual_kw"] is None for row in future)
