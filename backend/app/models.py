"""Causal, reproducible forecasts and residual analysis for 15-minute power bins.

The observed Parquet table is immutable. This module writes a new run directory and
never treats an unavailable pretrained model as a successful baseline forecast.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from hashlib import sha256
import json
import math
import os
from pathlib import Path
from time import perf_counter
from typing import Any

import numpy as np
import pandas as pd

from . import store


STEP = timedelta(minutes=15)
QUANTILES = (0.1, 0.5, 0.9)
MODEL_IDS = {"persistence", "seasonal_naive_96", "chronos_bolt_tiny"}
CHECKPOINT = "amazon/chronos-bolt-tiny"
CHECKPOINT_REVISION = "a0e552de83495b5c28c14c71c374f3e33280b340"
CHECKPOINT_WEIGHT_SHA256 = "75068728d376d2bec670379eeef4bfb4d24c0cfe24d957451f8d19b447030a32"


def checkpoint_dir() -> Path:
    return Path(os.environ.get("VOLTIQ_CHRONOS_DIR", str(store.ROOT / "models" / "chronos-bolt-tiny")))


class EvaluationError(ValueError):
    """The selected data or configuration cannot support evaluation."""


class ModelUnavailable(EvaluationError):
    """A requested checkpoint or runtime is not prepared locally."""


@dataclass(frozen=True)
class Forecast:
    quantiles: dict[float, np.ndarray]
    raw_quantiles: dict[float, np.ndarray]
    model_revision: str
    clipped_count: int = 0


def validate_forecast(raw: dict[float, Any], horizon: int, revision: str) -> Forecast:
    """Validate adapter output before declared nonnegative-power clipping."""
    if set(raw) != set(QUANTILES):
        raise EvaluationError("Forecast must provide q10, q50 and q90")
    arrays = {q: np.asarray(raw[q], dtype=np.float64).reshape(-1) for q in QUANTILES}
    if any(len(x) != horizon or not np.isfinite(x).all() for x in arrays.values()):
        raise EvaluationError("Forecast quantiles have invalid length or nonfinite values")
    if np.any(arrays[0.1] > arrays[0.5]) or np.any(arrays[0.5] > arrays[0.9]):
        raise EvaluationError("Forecast quantiles cross")
    clipped = {q: np.maximum(x, 0.0) for q, x in arrays.items()}
    count = sum(int(np.count_nonzero(arrays[q] < 0)) for q in QUANTILES)
    return Forecast(clipped, arrays, revision, count)


def _context(values: np.ndarray, origin: int, context_bins: int) -> tuple[np.ndarray | None, str | None, int]:
    if origin < context_bins:
        return None, "insufficient_history", 0
    raw = values[origin - context_bins : origin]
    output = raw.copy()
    imputed = 0
    gap = 0
    for i, value in enumerate(raw):
        if np.isfinite(value):
            gap = 0
        else:
            gap += 1
            if gap > 2 or i == 0 or not np.isfinite(output[i - 1]):
                return None, "unresolved_context", imputed
            output[i] = output[i - 1]
            imputed += 1
    if imputed / context_bins > 0.05:
        return None, "too_much_imputation", imputed
    return output.astype(np.float32), None, imputed


def _round_midnight(ts: pd.Timestamp) -> pd.Timestamp:
    midnight = ts.normalize()
    return midnight if ts == midnight else midnight + pd.Timedelta(days=1)


def chronological_split(times: pd.Series | pd.DatetimeIndex) -> dict[str, Any]:
    """Round 70/85 percent boundaries forward and enforce minimum calendar days."""
    t = pd.DatetimeIndex(times)
    if len(t) < 2 or not t.is_monotonic_increasing or t.has_duplicates:
        raise EvaluationError("Timeline must be unique and chronologically ordered")
    expected = pd.date_range(t[0], t[-1], freq="15min")
    if len(expected) != len(t) or not expected.equals(t):
        raise EvaluationError("Evaluation requires the complete regular 15-minute timeline")
    end = t[-1] + pd.Timedelta(minutes=15)
    train_end = _round_midnight(t[int(len(t) * 0.70)])
    val_end = _round_midnight(t[int(len(t) * 0.85)])
    days = [(train_end - t[0]).total_seconds() / 86400,
            (val_end - train_end).total_seconds() / 86400,
            (end - val_end).total_seconds() / 86400]
    if not (t[0] < train_end < val_end < end) or sum(days) < 28 or any(
        d < minimum for d, minimum in zip(days, (14, 3, 3))
    ):
        raise EvaluationError(f"Insufficient evaluation history: train/validation/test days={days}")
    return {
        "train": {"start": t[0].isoformat(), "end": train_end.isoformat(), "calendar_days": days[0]},
        "validation": {"start": train_end.isoformat(), "end": val_end.isoformat(), "calendar_days": days[1]},
        "test": {"start": val_end.isoformat(), "end": end.isoformat(), "calendar_days": days[2]},
        "time_basis": "source_local_naive",
    }


class ChronosBoltAdapter:
    """Offline CPU adapter. One instance keeps weights resident for all origins."""

    def __init__(self, checkpoint_dir: str | Path, revision: str):
        path = Path(checkpoint_dir)
        if not path.is_dir() or not (path / "config.json").is_file() or not (path / "model.safetensors").is_file():
            raise ModelUnavailable(
                "Chronos-Bolt checkpoint is not cached. Prepare amazon/chronos-bolt-tiny "
                "once with backend/prepare_model.py."
            )
        digest = sha256()
        with (path / "model.safetensors").open("rb") as file:
            for chunk in iter(lambda: file.read(1024 * 1024), b""):
                digest.update(chunk)
        if digest.hexdigest() != CHECKPOINT_WEIGHT_SHA256:
            raise ModelUnavailable("Pinned Chronos-Bolt safetensors checksum mismatch")
        try:
            import torch
            from chronos import BaseChronosPipeline
        except ImportError as exc:
            raise ModelUnavailable("Install the pinned Chronos, Torch and Transformers dependencies") from exc
        self.torch = torch
        self.revision = revision
        try:
            self.pipeline = BaseChronosPipeline.from_pretrained(
                str(path), device_map="cpu", torch_dtype=torch.float32,
                local_files_only=True, use_safetensors=True,
            )
        except Exception as exc:
            raise ModelUnavailable(f"Cannot load local Chronos-Bolt checkpoint: {exc}") from exc

    def predict(self, context_kw: np.ndarray, horizon: int) -> Forecast:
        context = np.asarray(context_kw, dtype=np.float32)
        if context.shape != (192,) or not np.isfinite(context).all():
            raise EvaluationError("Chronos context must be finite and exactly 192 bins")
        with self.torch.inference_mode():
            quantiles, _ = self.pipeline.predict_quantiles(
                self.torch.tensor(context), prediction_length=horizon,
                quantile_levels=list(QUANTILES),
            )
        q = np.asarray(quantiles.detach().cpu(), dtype=np.float64)
        if q.shape == (1, horizon, 3):
            q = q[0]
        if q.shape != (horizon, 3):
            raise EvaluationError(f"Unexpected Chronos quantile tensor shape {q.shape}")
        return validate_forecast({level: q[:, i] for i, level in enumerate(QUANTILES)},
                                 horizon, self.revision)


def _observations_path(manifest: dict[str, Any]) -> Path:
    value = manifest.get("observations_path") or manifest.get("observations")
    if not value and manifest.get("artifacts"):
        value = manifest["artifacts"].get("observations")
    if not value:
        raise EvaluationError("Dataset manifest has no observations Parquet path")
    path = Path(value)
    if not path.exists():
        raise EvaluationError(f"Observations Parquet is missing: {path}")
    return path


def _load(manifest: dict[str, Any]) -> pd.DataFrame:
    df = pd.read_parquet(_observations_path(manifest))
    needed = {"bin_start", "active_power_kw", "valid_active_minutes"}
    if not needed <= set(df):
        raise EvaluationError(f"Observations are missing columns {sorted(needed - set(df))}")
    df = df.sort_values("bin_start").reset_index(drop=True)
    df["bin_start"] = pd.to_datetime(df["bin_start"])
    if df["bin_start"].dt.tz is not None:
        raise EvaluationError("Source timestamps must remain offset-free")
    df["bin_end"] = df["bin_start"] + pd.Timedelta(minutes=15)
    return df


def _reference(values: np.ndarray, train_stop: int) -> tuple[np.ndarray, np.ndarray, int, float | None]:
    slots = np.arange(len(values)) % 96
    medians = np.full(96, np.nan)
    mad = np.full(96, np.nan)
    for slot in range(96):
        sample = values[:train_stop][(slots[:train_stop] == slot) & np.isfinite(values[:train_stop])]
        if len(sample) >= 7:
            medians[slot] = np.median(sample)
            mad[slot] = np.median(np.abs(sample - medians[slot]))
    pairs = values[96:train_stop] - values[: train_stop - 96]
    pairs = np.abs(pairs[np.isfinite(pairs)])
    denominator = float(np.mean(pairs)) if len(pairs) and np.mean(pairs) > 0 else None
    return medians, mad, len(pairs), denominator


def _metrics(rows: list[dict[str, Any]], mase_denominator: float | None) -> dict[str, Any]:
    if not rows:
        return {"eligible_origins": 0, "target_bins": 0, "mae_kw": None, "rmse_kw": None,
                "mase": None, "energy_error_kwh": None, "pinball": None,
                "q10_q90_coverage": None, "mean_band_width_kw": None}
    frame = pd.DataFrame(rows)
    err = frame["predicted_kw"].to_numpy() - frame["actual_kw"].to_numpy()
    result = {"eligible_origins": int(frame["origin"].nunique()), "target_bins": len(frame),
              "mae_kw": float(np.mean(np.abs(err))), "rmse_kw": float(np.sqrt(np.mean(err**2))),
              "mase": float(np.mean(np.abs(err)) / mase_denominator) if mase_denominator else None,
              "energy_error_kwh": float(np.sum(err) * 0.25)}
    if frame["q10_kw"].notna().all():
        actual = frame["actual_kw"].to_numpy()
        result["pinball"] = {}
        for q in QUANTILES:
            delta = actual - frame[f"q{int(q*100)}_kw"].to_numpy()
            result["pinball"][f"q{int(q*100)}"] = float(np.mean(np.maximum(q * delta, (q-1) * delta)))
        result["q10_q90_coverage"] = float(np.mean((actual >= frame["q10_kw"]) & (actual <= frame["q90_kw"])))
        result["mean_band_width_kw"] = float(np.mean(frame["q90_kw"] - frame["q10_kw"]))
    else:
        result.update(pinball=None, q10_q90_coverage=None, mean_band_width_kw=None)
    return result


def _events(scores: list[dict[str, Any]], run_id: str, detector: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    group: list[dict[str, Any]] = []

    def flush() -> None:
        if not group:
            return
        directions = {r["direction"] for r in group}
        start, end = group[0]["bin_start"], group[-1]["bin_end"]
        key = f"{run_id}|{detector}|{start}|{end}".encode()
        energies = [r["estimated_above_reference_kwh"] for r in group
                    if r["estimated_above_reference_kwh"] is not None]
        events.append({"id": "evt_" + sha256(key).hexdigest()[:24], "run_id": run_id,
                       "detector": detector, "split": group[0]["split"], "start": start,
                       "end": end, "duration_minutes": len(group)*15,
                       "flagged_bin_count": len(group), "peak_score": max(r["score"] for r in group),
                       "mean_score": float(np.mean([r["score"] for r in group])),
                       "score_unit": group[0]["score_unit"],
                       "direction": next(iter(directions)) if len(directions) == 1 else "mixed",
                       "maximum_observed_kw": max(r["actual_kw"] for r in group),
                       "estimated_above_reference_kwh": float(sum(energies)) if energies else None,
                       "reference_covered_bins": len(energies),
                       "evidence_bin_ids": [r["bin_start"] for r in group]})
        group.clear()

    for row in scores:
        adjacent = group and row["bin_start"] == group[-1]["bin_end"] and row["split"] == group[-1]["split"]
        if row["candidate"] is True:
            if group and not adjacent:
                flush()
            group.append(row)
        else:
            flush()
    flush()
    return events


def infer_one(dataset_manifest: dict[str, Any], model_id: str, run_id: str,
              origin_mode: str, origin: str | None, horizon: int) -> tuple[list[dict[str, Any]], str]:
    """Create one causal forecast from a saved dataset, including endpoint mode."""
    if model_id not in MODEL_IDS or horizon not in (1, 4, 16):
        raise EvaluationError("Unsupported model or forecast horizon")
    frame = _load(dataset_manifest)
    times = frame["bin_start"]
    observed = pd.to_numeric(frame["active_power_kw"], errors="coerce").to_numpy(dtype=float)
    observed[frame["valid_active_minutes"].to_numpy() != 15] = np.nan
    if origin_mode == "dataset_endpoint":
        index = len(frame)
        origin_time = times.iloc[-1] + pd.Timedelta(minutes=15)
    elif origin_mode == "historical" and origin:
        wanted = pd.Timestamp(origin)
        if wanted.tzinfo is not None:
            raise EvaluationError("Origin must be offset-free source time")
        matches = np.flatnonzero(times.to_numpy() == np.datetime64(wanted))
        if len(matches) != 1:
            raise EvaluationError("Historical origin is outside the dataset")
        index = int(matches[0]); origin_time = times.iloc[index]
    else:
        raise EvaluationError("origin_mode must be dataset_endpoint or historical with origin")
    context, reason, imputed = _context(observed, index, 192)
    if reason:
        raise EvaluationError(f"Forecast context unavailable: {reason}")
    persistence = float(observed[index - 1]) if np.isfinite(observed[index - 1]) else None
    seasonal = [float(observed[index - 96 + step]) if index - 96 + step >= 0 and
                index - 96 + step < len(observed) and np.isfinite(observed[index - 96 + step])
                else None for step in range(horizon)]
    if model_id == "chronos_bolt_tiny":
        forecast = ChronosBoltAdapter(checkpoint_dir(),
                                      CHECKPOINT_REVISION).predict(context, horizon)
        points = forecast.quantiles[0.5]
    elif model_id == "persistence":
        if persistence is None:
            raise EvaluationError("Last observed bin is missing")
        points = np.repeat(persistence, horizon)
        forecast = Forecast({}, {}, "observed-last-v1")
    else:
        if any(value is None for value in seasonal):
            raise EvaluationError("Observed daily seasonal lags are unavailable")
        points = np.asarray(seasonal)
        forecast = Forecast({}, {}, "seasonal-naive-96-v1")
    rows = []
    for step in range(horizon):
        target_start = origin_time + pd.Timedelta(minutes=15 * step)
        target_end = target_start + pd.Timedelta(minutes=15)
        target_index = index + step
        actual = (float(observed[target_index]) if target_index < len(observed) and
                  np.isfinite(observed[target_index]) else None)
        rows.append({"run_id": run_id, "model_id": model_id,
                     "origin": origin_time.isoformat(), "horizon": horizon,
                     "step": step + 1, "target_start": target_start.isoformat(),
                     "target_end": target_end.isoformat(), "actual_kw": actual,
                     "q10_kw": float(forecast.quantiles[.1][step]) if model_id == "chronos_bolt_tiny" else None,
                     "q50_kw": float(points[step]),
                     "q90_kw": float(forecast.quantiles[.9][step]) if model_id == "chronos_bolt_tiny" else None,
                     "persistence_kw": persistence, "seasonal_naive_kw": seasonal[step],
                     "target_eligible": actual is not None,
                     "split": "future" if origin_mode == "dataset_endpoint" else "historical",
                     "evaluation_kind": "inference", "model_revision": forecast.model_revision,
                     "context_imputed_bins": imputed, "context_bins": 192})
    return rows, forecast.model_revision


def evaluate(dataset_manifest: dict[str, Any], model_id: str, config: dict[str, Any],
             output_dir: str | Path) -> dict[str, Any]:
    """Create immutable held-out model artifacts from canonical observations.

    All candidate alerts use a validation-frozen threshold and only score test bins.
    A run with fewer than 200 validation residuals remains ``not_calibrated``.
    """
    if model_id not in MODEL_IDS:
        raise EvaluationError(f"Unsupported model_id {model_id}")
    context_bins = int(config.get("context_bins", 192))
    horizons = tuple(int(h) for h in config.get("horizons", (1, 4, 16)))
    threshold_q = float(config.get("threshold_quantile", 0.99))
    if context_bins != 192 or not horizons or any(h not in (1, 4, 16) for h in horizons):
        raise EvaluationError("Expected 192 context bins and horizons from 1, 4, 16")
    if not 0.95 <= threshold_q <= 0.999:
        raise EvaluationError("threshold_quantile must be between 0.95 and 0.999")
    if config.get("evaluation_kind", "held_out") != "held_out":
        raise EvaluationError("This evaluator supports held_out runs only")
    frame = _load(dataset_manifest)
    split = chronological_split(frame["bin_start"])
    times = frame["bin_start"]
    train_stop = int(times.searchsorted(pd.Timestamp(split["train"]["end"])))
    val_stop = int(times.searchsorted(pd.Timestamp(split["validation"]["end"])))
    observed = pd.to_numeric(frame["active_power_kw"], errors="coerce").to_numpy(dtype=float)
    complete = frame["valid_active_minutes"].to_numpy() == 15
    observed[~complete] = np.nan
    medians, mad, mase_pairs, mase_den = _reference(observed, train_stop)
    adapter = None
    if model_id == "chronos_bolt_tiny":
        adapter = ChronosBoltAdapter(checkpoint_dir(),
                                    CHECKPOINT_REVISION)
    signature = json.dumps({"source": dataset_manifest.get("source_sha256"),
                            "model": model_id, "config": config}, sort_keys=True, default=str)
    run_id = str(config.get("run_id") or sha256(signature.encode()).hexdigest()[:24])
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    forecasts: list[dict[str, Any]] = []
    predictions: dict[int, float] = {}
    skip: dict[str, int] = {}
    timings: list[float] = []
    invalid_origins: list[dict[str, Any]] = []
    imputation_total = 0
    for h in horizons:
        stride = h
        for origin in range(train_stop, len(frame)-h+1):
            if origin % stride:
                continue
            label = "validation" if origin < val_stop else "test"
            boundary = val_stop if label == "validation" else len(frame)
            if origin+h > boundary:
                skip["outside_split"] = skip.get("outside_split", 0)+1
                continue
            context, reason, imputed = _context(observed, origin, context_bins)
            if reason:
                skip[reason] = skip.get(reason, 0)+1
                continue
            if not np.isfinite(observed[origin:origin+h]).all():
                skip["missing_target"] = skip.get("missing_target", 0)+1
                continue
            imputation_total += imputed
            started = perf_counter()
            if adapter:
                try:
                    forecast = adapter.predict(context, h)
                except EvaluationError as exc:
                    skip["invalid_model_output"] = skip.get("invalid_model_output", 0) + 1
                    invalid_origins.append({"origin": times.iloc[origin].isoformat(),
                                            "horizon": h, "reason": str(exc)[:160]})
                    continue
            elif model_id == "persistence":
                finite = observed[:origin][np.isfinite(observed[:origin])]
                if not len(finite):
                    skip["insufficient_history"] = skip.get("insufficient_history", 0)+1
                    continue
                prediction = np.repeat(finite[-1], h)
                forecast = Forecast({}, {}, "observed-last-v1")
            else:
                prediction = observed[origin-96:origin-96+h]
                if not np.isfinite(prediction).all():
                    skip["unresolved_context"] = skip.get("unresolved_context", 0)+1
                    continue
                forecast = Forecast({}, {}, "seasonal-naive-96-v1")
            timings.append((perf_counter()-started)*1000)
            point = forecast.quantiles[0.5] if adapter else prediction
            for step in range(h):
                idx = origin+step
                row = {"run_id": run_id, "model_id": model_id, "origin": times.iloc[origin].isoformat(),
                       "horizon": h, "step": step + 1, "bin_start": times.iloc[idx].isoformat(),
                       "bin_end": frame["bin_end"].iloc[idx].isoformat(),
                       "target_start": times.iloc[idx].isoformat(),
                       "target_end": frame["bin_end"].iloc[idx].isoformat(),
                       "actual_kw": float(observed[idx]), "predicted_kw": float(point[step]),
                       "q10_kw": float(forecast.quantiles[0.1][step]) if adapter else None,
                       "q50_kw": float(point[step]),
                       "q90_kw": float(forecast.quantiles[0.9][step]) if adapter else None,
                       "persistence_kw": float(observed[origin - 1]) if np.isfinite(observed[origin - 1]) else None,
                       "seasonal_naive_kw": float(observed[idx - 96]) if idx >= 96 and np.isfinite(observed[idx - 96]) else None,
                       "target_eligible": True,
                       "split": label, "evaluation_kind": "held_out",
                       "model_revision": forecast.model_revision, "context_imputed_bins": imputed,
                       "context_bins": context_bins,
                       "clipped_quantiles": forecast.clipped_count}
                forecasts.append(row)
            if h == 1:
                predictions[origin] = float(point[0])
    validation_scores = [abs(observed[i]-p) for i, p in predictions.items() if i < val_stop]
    threshold = float(np.quantile(validation_scores, threshold_q, method="linear")) if len(validation_scores) >= 200 else None
    slot_scores = []
    for i in range(train_stop, val_stop):
        slot = i % 96
        if np.isfinite(observed[i]) and np.isfinite(medians[slot]):
            slot_scores.append(abs(observed[i]-medians[slot])/max(1.4826*mad[slot], 0.01))
    slot_threshold = float(np.quantile(slot_scores, threshold_q, method="linear")) if len(slot_scores) >= 200 else None
    scores: list[dict[str, Any]] = []
    slot_rows: list[dict[str, Any]] = []
    for i in range(train_stop, len(frame)):
        label = "validation" if i < val_stop else "test"
        actual = float(observed[i]) if np.isfinite(observed[i]) else None
        reference = float(medians[i % 96]) if np.isfinite(medians[i % 96]) else None
        above = max(actual-reference, 0)*0.25 if actual is not None and reference is not None else None
        common = {"run_id": run_id, "bin_start": times.iloc[i].isoformat(),
                  "bin_end": frame["bin_end"].iloc[i].isoformat(), "actual_kw": actual,
                  "split": label, "baseline_kw": reference,
                  "estimated_above_reference_kwh": above}
        prediction = predictions.get(i)
        residual = actual-prediction if actual is not None and prediction is not None else None
        status = ("quality_excluded" if actual is None or prediction is None else
                  "not_scored" if label != "test" else
                  "not_calibrated" if threshold is None else "scored")
        score = abs(residual) if residual is not None else None
        scores.append({**common, "detector": "residual", "predicted_kw": prediction,
                       "score": score, "score_unit": "kW", "threshold": threshold,
                       "candidate": score > threshold if status == "scored" else None,
                       "direction": "higher" if residual is not None and residual > 0 else
                       "lower" if residual is not None and residual < 0 else None,
                       "status": status,
                       "skip_reason": "missing_target" if actual is None else
                       "no_eligible_forecast" if prediction is None else None})
        slot_score = abs(actual-reference)/max(1.4826*mad[i % 96], 0.01) if above is not None else None
        slot_status = ("quality_excluded" if slot_score is None else "not_scored" if label != "test" else
                       "not_calibrated" if slot_threshold is None else "scored")
        slot_rows.append({**common, "detector": "slot_mad", "predicted_kw": reference,
                          "score": slot_score, "score_unit": "robust_sigma",
                          "threshold": slot_threshold,
                          "candidate": slot_score > slot_threshold if slot_status == "scored" else None,
                          "direction": "higher" if actual is not None and reference is not None and actual > reference else
                          "lower" if actual is not None and reference is not None and actual < reference else None,
                          "status": slot_status, "skip_reason": None if slot_score is not None else "missing_reference_or_target"})
    all_scores = scores + slot_rows
    events = _events(scores, run_id, "residual") + _events(slot_rows, run_id, "slot_mad")
    metrics = {f"{label}_h{h}": _metrics([r for r in forecasts if r["split"] == label and r["horizon"] == h], mase_den)
               for label in ("validation", "test") for h in horizons}
    metrics["timing"] = {"device": "cpu", "dtype": "float32", "context_bins": context_bins,
                         "batch_size": 1, "median_ms": float(np.median(timings)) if timings else None,
                         "p95_ms": float(np.quantile(timings, .95)) if timings else None}
    metrics["mase_training_pairs"] = mase_pairs
    metrics["invalid_model_outputs"] = invalid_origins
    thresholds = {"residual": {"value": threshold, "unit": "kW", "validation_count": len(validation_scores),
                               "quantile": threshold_q},
                  "slot_mad": {"value": slot_threshold, "unit": "robust_sigma",
                               "validation_count": len(slot_scores), "quantile": threshold_q}}
    pd.DataFrame(forecasts).to_parquet(output / "forecasts.parquet", index=False)
    pd.DataFrame(all_scores).to_parquet(output / "scores.parquet", index=False)
    event_columns = ["id", "run_id", "detector", "split", "start", "end",
                     "duration_minutes", "flagged_bin_count", "peak_score", "mean_score",
                     "score_unit", "direction", "maximum_observed_kw",
                     "estimated_above_reference_kwh", "reference_covered_bins", "evidence_bin_ids"]
    pd.DataFrame(events, columns=event_columns).to_parquet(output / "events.parquet", index=False)
    for filename, data in (("split_manifest.json", split), ("metrics.json", metrics),
                           ("thresholds.json", thresholds)):
        (output / filename).write_text(json.dumps(data, indent=2, allow_nan=False), encoding="utf-8")
    manifest = {"run_id": run_id, "model_id": model_id, "evaluation_kind": "held_out",
                "dataset_id": dataset_manifest.get("dataset_id"),
                "dataset_hash": dataset_manifest.get("source_sha256"),
                "model_revision": adapter.revision if adapter else ("observed-last-v1" if model_id == "persistence" else "seasonal-naive-96-v1"),
                "pretraining_overlap": "unknown" if adapter else "not_applicable",
                "device": "cpu", "dtype": "float32", "imputed_context_bins": imputation_total,
                "skip_reasons": skip, "forecast_rows": len(forecasts), "score_rows": len(all_scores),
                "invalid_model_output_count": len(invalid_origins),
                "event_rows": len(events), "anomaly_status": "calibrated" if threshold is not None else "not_calibrated",
                "split_manifest": str(output / "split_manifest.json"),
                "metrics_path": str(output / "metrics.json"), "thresholds_path": str(output / "thresholds.json"),
                "forecasts_path": str(output / "forecasts.parquet"), "scores_path": str(output / "scores.parquet"),
                "events_path": str(output / "events.parquet")}
    (output / "run_manifest.json").write_text(json.dumps(manifest, indent=2, allow_nan=False), encoding="utf-8")
    return manifest
