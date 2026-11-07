from datetime import datetime
import json

import numpy as np
import pandas as pd
import pytest

from backend.app.models import (
    EvaluationError, ModelUnavailable, _context, chronological_split, evaluate,
    validate_forecast,
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
