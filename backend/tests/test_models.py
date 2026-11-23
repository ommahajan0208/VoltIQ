from datetime import datetime
import json

import numpy as np
import pandas as pd
import pytest

from backend.app.models import (
    EvaluationError, ModelUnavailable, _context, _events, _load, _metrics,
    chronological_split, evaluate, validate_forecast,
)


def test_quantiles_reject_crossing_and_preserve_raw_clipped():
    with pytest.raises(EvaluationError, match="cross"):
        validate_forecast({.1: [-1], .5: [-2], .9: [1]}, 1, "rev")
    result = validate_forecast({.1: [-2], .5: [-1], .9: [1]}, 1, "rev")
    assert result.clipped_count == 2
    assert result.raw_quantiles[.1][0] == -2
    assert result.quantiles[.1][0] == 0


def test_context_uses_only_past_and_limited_forward_fill():
    values = np.arange(200, dtype=float)
    values[10:12] = np.nan
    before, reason, imputed = _context(values, 192, 192)
    assert reason is None and imputed == 2
    assert before[10] == 9 and before[11] == 9
    values[192:] = 9999
    after, _, _ = _context(values, 192, 192)
    np.testing.assert_equal(before, after)
    values[10:13] = np.nan
    assert _context(values, 192, 192)[1] == "unresolved_context"


def test_split_rejects_short_series():
    times = pd.date_range("2020-01-01", periods=96*10, freq="15min")
    with pytest.raises(EvaluationError, match="Insufficient"):
        chronological_split(times)


def test_split_requires_regular_unique_chronological_source_time():
    ordered = pd.date_range("2020-01-01", periods=96 * 35, freq="15min")
    with pytest.raises(EvaluationError, match="chronologically ordered"):
        chronological_split(ordered[::-1])
    with pytest.raises(EvaluationError, match="complete regular"):
        chronological_split(ordered.delete(10))
    with pytest.raises(EvaluationError, match="chronologically ordered"):
        chronological_split(ordered.insert(10, ordered[10]))


def test_metrics_reports_point_and_quantile_quality():
    rows = [
        {"origin": "o1", "predicted_kw": 1.0, "actual_kw": 2.0,
         "q10_kw": 0.0, "q50_kw": 1.0, "q90_kw": 3.0},
        {"origin": "o1", "predicted_kw": 3.0, "actual_kw": 2.0,
         "q10_kw": 1.0, "q50_kw": 3.0, "q90_kw": 4.0},
    ]
    metrics = _metrics(rows, 2.0)
    assert metrics["eligible_origins"] == 1
    assert metrics["target_bins"] == 2
    assert metrics["mae_kw"] == 1.0
    assert metrics["rmse_kw"] == 1.0
    assert metrics["mase"] == 0.5
    assert metrics["energy_error_kwh"] == 0.0
    assert metrics["q10_q90_coverage"] == 1.0
    assert metrics["mean_band_width_kw"] == 3.0
    assert set(metrics["pinball"]) == {"q10", "q50", "q90"}


def test_events_group_only_adjacent_candidate_bins_and_preserve_direction():
    start = datetime(2020, 1, 1)
    def row(offset, candidate, direction="higher", split="test"):
        a = start + pd.Timedelta(15 * offset, unit="min")
        return {"bin_start": a, "bin_end": a + pd.Timedelta(15, unit="min"),
                "candidate": candidate, "direction": direction,
                "split": split, "score": float(offset + 1),
                "score_unit": "kW", "actual_kw": 2.0,
                "estimated_above_reference_kwh": 0.25 if candidate else None}

    events = _events([row(0, True), row(1, True), row(2, False),
                      row(3, True, "lower"), row(5, True, "lower")], "run", "residual")
    assert len(events) == 3
    assert events[0]["duration_minutes"] == 30
    assert events[0]["direction"] == "higher"
    assert events[0]["estimated_above_reference_kwh"] == 0.5
    assert events[1]["direction"] == "lower"
    assert events[2]["start"] == start + pd.Timedelta(75, unit="min")


def test_load_rejects_timezone_aware_observations(tmp_path):
    path = tmp_path / "aware.parquet"
    pd.DataFrame({"bin_start": pd.date_range("2020-01-01", periods=1, tz="UTC"),
                  "active_power_kw": [1.0], "valid_active_minutes": [15]}).to_parquet(path)
    with pytest.raises(EvaluationError, match="offset-free"):
        _load({"observations_path": str(path)})


def _dataset(tmp_path):
    times = pd.date_range("2020-01-01", periods=96*35, freq="15min")
    values = 1 + .1 * np.sin(np.arange(len(times)) / 96 * 2 * np.pi)
    df = pd.DataFrame({"bin_start": times, "active_power_kw": values,
                       "valid_active_minutes": 15})
    path = tmp_path / "observations.parquet"
    df.to_parquet(path)
    return {"observations_path": str(path), "dataset_id": "test", "source_sha256": "abc"}


def test_offline_baseline_artifacts_and_frozen_threshold(tmp_path):
    manifest = evaluate(_dataset(tmp_path), "persistence", {}, tmp_path / "run")
    assert manifest["forecast_rows"] > 0
    assert manifest["anomaly_status"] == "calibrated"
    forecasts = pd.read_parquet(manifest["forecasts_path"])
    scores = pd.read_parquet(manifest["scores_path"])
    assert set(forecasts.horizon) == {1, 4, 16}
    assert forecasts.q10_kw.isna().all()
    assert scores[(scores.detector == "residual") & (scores.split == "validation")].candidate.isna().all()
    thresholds = json.loads((tmp_path / "run" / "thresholds.json").read_text())
    assert thresholds["residual"]["validation_count"] >= 200
    assert set(scores.detector) == {"residual", "slot_mad"}


def test_chronos_missing_checkpoint_is_explicit(tmp_path, monkeypatch):
    monkeypatch.setenv("VOLTIQ_CHRONOS_DIR", str(tmp_path / "missing-checkpoint"))
    with pytest.raises(ModelUnavailable, match="checkpoint"):
        evaluate(_dataset(tmp_path), "chronos_bolt_tiny", {}, tmp_path / "run")
