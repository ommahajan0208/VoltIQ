# Deep Learning and Evaluation — VoltIQ

Revision 2 · 12 October 2026. Normative forecasting, anomaly and experimental contract. This specification defines work to implement; it reports no measured accuracy or runtime.

## 1. Required and optional experiments

| ID | Method | Role | Required? |
|---|---|---|---|
| `persistence` | Last observed eligible value | Forecast reference | Yes |
| `seasonal_naive_96` | Same quarter-hour one day earlier | Forecast reference | Yes |
| `chronos_bolt_tiny` | Frozen pretrained checkpoint | Deep-learning forecast and residual detector | Yes |
| `slot_mad` | Training slot median and robust deviation | Statistical detector comparison | Yes |
| `chronos_finetuned` | Adapt approved checkpoint on training split | Research comparison | Optional |
| `dense_autoencoder` | Small network trained on four-channel overnight windows | Reconstruction detector comparison | Optional |

Select the frozen `amazon/chronos-bolt-tiny` checkpoint first. Its model card describes pretrained quantile forecasting and a roughly 9M-parameter model, with CPU inference supported. This makes it a candidate for the user's laptop; actual latency and memory must still be measured. A larger model is not a prerequisite.

No classifier is assumed to output a “phantom load” label. Forecasting predicts active power; anomaly logic is a separately implemented, calibrated comparison between predictions and observed values.

## 2. Input and task definitions

Use `observations/` Parquet from the Spark pipeline. The required target is `active_power_kw`, with 15-minute cadence across all hours. Optional circuits remain exploratory features unless an explicitly versioned multivariate experiment is enabled. Frozen Chronos-Bolt receives a single power sequence; do not feed voltage/current as interchangeable target samples.

| Parameter | Default |
|---|---|
| Context length | 192 bins = 48 hours |
| Forecast horizons | 1, 4, 16 bins |
| Quantiles | 0.1, 0.5, 0.9 |
| Backtest one-step stride | 1 bin |
| Four-/sixteen-step backtest stride | 4 / 16 bins respectively |
| Primary point prediction | Median, `q50` |
| Split | Chronological 70% train, 15% validation, 15% test |
| Alert threshold | Validation 99th percentile of eligible residual scores |
| Overnight filter | 00:00 inclusive to 05:00 exclusive, source wall clock |

Every prediction records an origin `o`, the start of the first predicted interval. Context contains bins ending at or before `o`; target bin starts are `o + j * 15 minutes`, `j=0..H-1`. At origin 02:00, the last available observed bin is 01:45–02:00. A residual for 02:00–02:15 can only be computed after 02:15. This is historical completed-interval analysis, not instantaneous monitoring.

## 3. Chronological split construction

Use the regular selected timeline, not only nonmissing rows. Determine tentative 70/85% cut points, round forward to the next midnight, and ensure strictly increasing train/validation/test boundaries. Save exact half-open ranges in `split_manifest.json`. Minimum evaluation data: 28 calendar days overall, at least 14 train days, 3 validation days and 3 test days after rounding. If boundaries fail these requirements, keep consumption exploration available and reject evaluation with counts.

Choose experiments and hyperparameters using training and validation only. After inspecting held-out test outcomes, any retuning requires a new exploratory run and disclosure; it is not a fresh unbiased test. Save the locked configuration before test scoring.

Forecast contexts may use previously observed bins from an earlier split. They may not include future target values or any targets beyond the origin. All targets for an evaluated horizon must lie in its assigned split. Earlier test observations may be used at later test origins in a walk-forward backtest; weights and thresholds remain frozen.

Fine-tuning weights and learned scalers see training data only. Statistical slot references are fitted on training only. Validation calibrates thresholds. Test never calibrates anything. UCI's public status creates an additional pretraining-overlap risk: record model provenance as verified absent / known overlap / unknown, with a source. Default to unknown until established.

## 4. Quality and causal preparation

Use only complete 15/15-minute bins as forecast evaluation targets and anomaly targets. The model context can forward-fill up to two missing bins using past data, with at most 5% imputed bins per context. Unresolved gaps invalidate the context. Do not use linear interpolation based on future measurements. Save skip reasons per origin: `insufficient_history`, `unresolved_context`, `too_much_imputation`, `missing_target`, `outside_split`.

Require the full 192-bin context for comparable evaluation. For dataset-end inference, require the same context policy; reject an endpoint with missing/unresolved recent context rather than silently moving the origin. The user may explicitly choose an earlier valid origin.

Minimum threshold calibration: 200 eligible one-step validation residuals; otherwise forecast exploration may proceed but anomaly status is `not_calibrated`. Report the finite calibration count and temporal dependence; a 99th percentile does not guarantee a future 1% false-positive rate.

## 5. Forecast adapter contract

```python
# Project interface; implementation wraps a pinned Chronos library release.
from dataclasses import dataclass
import numpy as np

@dataclass
class Forecast:
    quantiles: dict[float, np.ndarray]  # each array has shape [horizon]
    raw_quantiles: dict[float, np.ndarray]
    model_revision: str

def predict(context_kw: np.ndarray, horizon: int) -> Forecast:
    """Validate finite [192] context; return q10/q50/q90 in physical kW."""
    raise NotImplementedError
```

Use CPU float32 initially; reduce batch size on resource pressure. Keep the model loaded in a worker-owned process for a batch, not one load per interval. Use inference mode, deterministic preprocessing and a pinned model revision. Cache weights locally after first download. Failure to find the cached model offline must explain how to prepare it; never silently label a naive forecast as Chronos.

The adapter maps library-specific tensor dimensions into the contract and verifies length, finite values and ordered quantiles. Clip negative forecast quantiles at zero as a declared physical postprocessing rule, preserving raw quantiles and reporting how many changed. Apply the same rule in validation, test, inference and exports. Unexpected crossing quantiles produce an adapter error rather than silently changing quantile identities.

The model card provides direct inference examples. Use its current documented API when implementing, then lock the package version. This file deliberately isolates that API behind a tested adapter rather than promising an untested dependency combination.

## 6. Forecast evaluation

At each eligible origin, produce a fixed-origin prediction for its complete horizon without substituting actual future values into that forecast. Compute one-step predictions separately for anomaly scoring. A four-hour band cannot supply a retrospectively chosen best one-step forecast.

Report metrics per model AND per horizon on the common eligible origin/target set. Also report each model's full eligible count so data quality does not get hidden by intersection filtering.

- MAE in kW: mean absolute target error.
- RMSE in kW: square root of mean squared error.
- MASE: MAE divided by training-only mean absolute lag-96 difference over valid pairs; return null if denominator is zero or unavailable.
- Pinball loss for q10/q50/q90, for models supporting quantiles.
- Empirical q10–q90 coverage and mean band width; nominal coverage is 80%, not verified certainty.
- Horizon energy error: predicted median power sum × 0.25 versus complete observed horizon energy; only complete target horizons qualify.
- Median and p95 batch/origin inference time, device, dtype, context and batch size.

Persistence uses the most recent actually observed context value. Seasonal naive uses values at target time minus 96 bins; with horizons up to 16 all such inputs are available before the origin. If any required seasonal value is missing, mark that prediction unavailable; do not invent a substitute without a separately named method.

Do not rank models by a universal “accuracy percentage.” The UI must distinguish observed backtests from future-of-dataset forecasts with no available targets.

## 7. Residual anomaly scoring

For each eligible one-step target, use the frozen median prediction:

```python
residual_kw = observed_kw - predicted_q50_kw
score_kw = abs(residual_kw)
threshold_kw = float(np.quantile(validation_scores_kw, 0.99, method="linear"))
is_candidate = score_kw > threshold_kw
# Positive = higher than predicted; negative = lower than predicted.
```

Save direction separately. This simple score is interpretable and avoids treating a pretrained uncertainty band as a calibrated anomaly probability. q10–q90 is shown for forecast context, not as the candidate threshold. A zero threshold is valid; do not divide by it. Any score/threshold ratio is null when the threshold is zero.

Default scoring covers held-out test only. Historical train/validation traces remain explorable but explicitly unscored in the main result. A user-requested full-history diagnostic run must carry `evaluation_kind="exploratory"`, show in-sample sections, and never replace held-out metrics.

Detector comparison `slot_mad`: fit median and MAD for each of 96 slots on observed training bins. Require at least seven observations per slot. Score `abs(y - median) / max(1.4826*MAD, 0.01 kW)` and calibrate its own validation percentile. The 0.01 floor is a configurable numerical default. Do not compare its numeric score directly to a residual in kW; compare coverage, candidate rate and examples.

## 8. Persistent overnight elevation

A routinely elevated level may be predicted correctly, so it need not trigger a residual detector. Compute a separate descriptive overnight comparison using training slot medians. For each complete bin, positive energy above reference is `max(y - slot_median, 0) * 0.25` kWh. Missing baseline or incomplete bins yield null.

The overnight panel shows observed energy, coverage, reference-comparable coverage and positive energy above reference. Label it **estimated energy above historical reference**. Do not merge this metric into the residual alert flag or call it measured waste. An optional persistence rule must be an independently versioned detector with its own validation calibration.

## 9. Event construction

Primary residual events group strictly adjacent flagged target bins, gap exactly 15 minutes, within the same run, detector and split. Unflagged or unscored bins break the group. Never bridge a missing-data gap. Event interval is `[first_flagged_bin_start, last_flagged_bin_end)`; duration is `15 * flagged_bin_count` minutes. This avoids the old ambiguous 30-minute bridging rule.

Store direction `higher`, `lower`, or `mixed`, maximum/mean score, maximum observed power, flagged count, evidence bin IDs and positive reference energy summed once per unique eligible bin. No overlap-window double counting. A date filter returns intersecting events with clipped visible portions labelled; event detail preserves the whole event. Event IDs are deterministic within an immutable run; changes in configuration create a new run and new IDs.

## 10. Optional custom autoencoder

Use PyTorch with four standardized channels: active/reactive power, voltage and current. Construct eight-bin windows only inside one night `[00:00,05:00)` and one chronological split. Require all channels complete for all bins; skip incomplete windows. Fit mean/std per channel on training rows; zero standard deviation maps to scale 1 and is recorded.

Architecture: flattened 32 inputs → Linear(32,16), ReLU → Linear(16,8), ReLU → Linear(8,16), ReLU → Linear(16,32). MSE reconstruction loss; Adam; initial learning rate 0.001; batch size 64; max 40 epochs; patience 5 on validation loss; restore best weights. These are starting defaults, not proven optimum settings.

Each score covers a two-hour window. Store window start/end and per-feature errors; do not imply the endpoint alone caused a flag. Display optional window events separately from interval residual events. Overlapping flagged windows form unions of support intervals, and energy is computed once per unique fully observed support bin, labelled “energy over flagged window support.” Never add their totals to primary residual event KPIs.

Require at least 100 training and 50 validation windows for this experiment; otherwise report insufficient data. Save training curves only for models actually trained. A frozen model shows “Pretrained inference — no local training curve.”

## 11. Fine-tuning and Colab workflow

Export the selected processed dataset, split manifest, config and checksums. The notebook verifies hashes, trains on training targets, uses validation for selection, saves checkpoint weights and a run manifest, and exports a result bundle. Import that bundle locally with matching dataset/config/model-schema checks. Never transfer a tuned checkpoint to a different household without a separately labelled evaluation.

Bound initial experiments to one selected configuration plus the frozen checkpoint. Use early stopping where supported and checkpoint between epochs/steps. Colab interruption leaves resumable artifacts where possible; a free GPU must not be a required runtime dependency. Any third-party upload is user-initiated through this explicit notebook workflow; the local website never sends readings to hosted inference.

## 12. Synthetic sensitivity and human inspection

Preserve the real test data. Build a separately hashed synthetic copy, injecting deterministic positive spikes, sustained plateaus and level shifts into originally complete regions. Define amplitude relative to training dispersion and duration before evaluating. Record seed, original/injected intervals and labels. Missingness corruptions are quality tests, not energy anomalies.

Re-run causal forecasts on the perturbed series so earlier injected observations affect later contexts. Compute point sensitivity and event detection/latency against injected labels, plus false alarms on untouched bins. Match a detected event when it overlaps an injected event; count each injected event once for recall. Report unmatched detected events separately. These are synthetic metrics, not real-world precision/recall.

Review a reproducible sample of high scores, near-threshold scores and random unflagged eligible bins. Record reviewer observations without converting review status into ground truth. Report uncertainty and alternative explanations.

## 13. Model artifacts and acceptance

Each immutable run stores `run_manifest.json`, `split_manifest.json`, `metrics.json`, `thresholds.json`, `forecasts.parquet`, `scores.parquet`, `events.parquet`, and optional model weights/curves. Include dataset hash, adapter/checkpoint revision, package lock hash, seed, device, imputation counts and skip reasons.

Acceptance: changing any target after an origin cannot change that origin's forecast; scalers/references use training only; test threshold equals the saved validation threshold; all metrics report denominators; hourly/4-hour evaluation does not teacher-force future targets; interval IDs are unique; optional models cannot contaminate the main KPIs; offline cached inference works; no quality/latency claims appear until measured.

## Sources

Checked 12 October 2026:
- https://huggingface.co/amazon/chronos-bolt-tiny — checkpoint capabilities, size, CPU inference and license.
- https://github.com/amazon-science/chronos-forecasting — official library and model family.
- https://archive.ics.uci.edu/dataset/235/individual+household+electric+power+consumption — source dataset.

All scoring rules, split policies, minimum sample counts and experiment budgets are explicit project decisions. They must be validated empirically.
