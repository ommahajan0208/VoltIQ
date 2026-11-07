# Big Data Integration — VoltIQ

Revision 2 · 12 October 2026 · Normative dataset and ETL contract. Read with `backend_spec.md` and `Deeplearning_backend.md`.

## 1. Mandatory scope

PySpark must perform source parsing, numeric conversion, validation, duplicate resolution, chronological selection, interval aggregation and quality counting. The website consumes persisted outputs through the API. It never starts Spark to render a chart. Local mode demonstrates Spark engineering; it is not evidence of multi-node scalability or a guarantee of speed over Pandas.

Use 100,000 rows for development and 250,000 for final evaluation. Optional `full` uses the complete source. Row selection occurs after valid timestamp parsing and deterministic duplicate resolution, before numeric missingness filtering. Missing measurements remain in the timeline. Report pre-selection and post-selection counts.

## 2. UCI source interpretation

The published source describes 2,075,259 minute observations, December 2006–November 2010, for one household in Sceaux, France. It contains missing readings and has no verified anomaly labels. Attribute the dataset and retain its source license, CC BY 4.0, with derived bundles.

| Source field | Meaning/unit | Canonical field | 15-minute treatment |
|---|---|---|---|
| `Date`, `Time` | `dd/MM/yyyy`, `HH:mm:ss` | `timestamp_local` | Parse explicitly, no locale guess |
| `Global_active_power` | kW | `active_power_kw` | Mean of valid minute readings |
| `Global_reactive_power` | kVAR | `reactive_power_kvar` | Mean |
| `Voltage` | V | `voltage_v` | Mean |
| `Global_intensity` | A | `current_a` | Mean |
| `Sub_metering_1` | Wh per minute, kitchen circuit | `sub1_observed_wh` | Sum observed minute energy |
| `Sub_metering_2` | Wh per minute, laundry circuit | `sub2_observed_wh` | Sum observed minute energy |
| `Sub_metering_3` | Wh per minute, water heater/air conditioning circuit | `sub3_observed_wh` | Sum observed minute energy |

Channels cover groups of equipment. Do not describe these as individual appliance identities. Treat `?`, empty strings and nonfinite values as missing, with distinct raw parse-error counts where possible.

### Time convention

UCI timestamps lack an explicit UTC offset. Preserve source wall-clock labels and set manifest `time_basis="source_local_naive"`, `display_zone_label="Source household time"`. Do not append `Z` or convert them to the viewer's Indian timezone. Spark session timezone is fixed to UTC only to make parsing/grouping deterministic; it does not assert that the original observations occurred in UTC. Export offset-free timestamp strings and explicit time-basis metadata.

For uploads, v1 supports minute-resolution naive timestamps using the same convention. Require an explicit timestamp format. Offset-bearing timestamps or DST-ambiguous inputs must be normalized through a future supported adapter or rejected with instructions; do not silently strip offsets. Reject multi-household files unless a single household has been explicitly selected before import.

## 3. Upload profiles

1. **UCI native:** all original columns, semicolon delimiter and original units.
2. **Generic minute power:** timestamp + active-power column, comma/semicolon delimiter, unit chosen as kW or W. Convert W to kW once, retaining the mapping.

Optional channels have explicit unit mappings. Without sub-metering, hide circuit and remainder charts. Without the four original measurement channels, disable the optional multivariate autoencoder, while univariate forecasting remains available. Reject irregular cadence, duplicates with conflicts, or unmapped energy-only columns with actionable diagnostics; do not infer a kWh column is kW.

Allow gaps on a nominal one-minute grid. Validate that seconds are zero and timestamps align to minutes. Timestamp failures are quarantined and counted; if none parse, fail. Show invalid-row totals before the user confirms processing. Limit uploads to 200 MiB uncompressed and 3,000,000 parsed rows in v1; configuration changes require an explicit local setting. These are project limits, not source dataset properties.

## 4. Pipeline stages and artifacts

| Stage | Required behavior | Output |
|---|---|---|
| Register | Stream to temporary file; hash; store original filename as metadata | Immutable source and dataset ID |
| Parse | Apply explicit string schema, delimiter, timestamps and numeric casts | Raw/error counts |
| Deduplicate | Collapse exact duplicates; fail on conflicting same-time records | Duplicate/conflict report |
| Select | Filter optional start date, sort ascending, take profile limit | Selected boundaries and count |
| Grid | Build expected minute/15-minute grid over selected coverage | Missing-position counts |
| Aggregate | Compute each field independently and retain counts | Canonical 15-minute observations |
| Quality | Identify complete, partial and missing bins | Quality JSON and gap spans |
| Publish | Validate schemas, write staging files, atomically publish manifest | Readable dataset version |

Do not repair the immutable observed table. Model-input preparation derives a separate causal series as specified below. This separates measured evidence from assumptions and allows alternative models to reuse exactly the same observations.

## 5. Missingness, coverage and energy

Every bin is `[bin_start, bin_start + 15 minutes)`. Count expected positions from the complete 15-minute grid, including source-boundary partial bins. An edge bin with fewer than 15 observed positions is partial, not complete. Save `expected_minutes=15`, `present_minutes`, and valid counts for every channel.

For minute active-power readings `p_m` in kW:

```text
observed_energy_kwh = sum(valid p_m) / 60
active_power_kw = mean(valid p_m), or null when count = 0
active_coverage = valid_active_minutes / 15
estimated_full_bin_energy_kwh = active_power_kw * 0.25
```

The last estimate is only exposed for bins with at least 12 valid active readings and is labelled extrapolated. The main energy KPI is the sum of observed energy plus coverage, never an unlabeled full-duration estimate. For zero valid readings, observed energy is null rather than zero. Aggregate APIs return missing-bin counts and null if no data is available.

A model-quality active-power target requires all 15 minute observations (`valid_active_minutes=15`). Partial means may appear on charts with a quality marker but do not become evaluation targets or candidate alerts. This stricter target rule prevents partially observed averages from appearing as verified model errors.

### Remainder energy

On minutes where active power and all three sub-meterings are simultaneously valid:

`remainder_wh = active_power_kw * 1000 / 60 - sub1_wh - sub2_wh - sub3_wh`

Sum only aligned valid minute remainders and retain `remainder_valid_minutes`. Do not subtract channel totals computed on different missingness masks. Preserve negative values as measurement inconsistency/rounding flags; do not silently clamp them to zero or label them phantom load. Remainder describes unmetered energy, not waste.

## 6. Causal model inputs

The observed data stays unchanged. The ML package creates `model_input_power_kw` from complete bins, with forward-fill permitted only for gaps of at most two consecutive bins, using the last valid past bin. Do not use bidirectional interpolation for forecasts: a future endpoint would leak information into earlier contexts.

Record `imputed`, `imputation_method`, and `gap_length`. Once a gap exceeds two intervals, leave later missing inputs unresolved; the context is ineligible until a new fully eligible context exists. Each context may contain at most 5% imputed bins. Never impute targets for evaluation or alerting. Scale/threshold estimates use observed eligible data, not invented targets.

Chronological splits are assigned before learned preprocessing. At the start of a validation/test context, earlier observed history is permitted for forecasting because it is available at the origin; targets stay wholly inside the selected split. The optional autoencoder uses windows wholly inside one split. Changing these rules creates a new dataset/run configuration hash.

## 7. Canonical Parquet schema

One row per bin, unique `(dataset_id, bin_start)`:

| Field | Type / rule |
|---|---|
| `schema_version` | string, `2.0` |
| `dataset_id` | opaque string |
| `bin_start`, `bin_end` | naive timestamp, half-open interval |
| `active_power_kw`, `reactive_power_kvar`, `voltage_v`, `current_a` | nullable float64 |
| `observed_energy_kwh`, `estimated_full_bin_energy_kwh` | nullable float64 |
| `sub1_observed_wh`, `sub2_observed_wh`, `sub3_observed_wh` | nullable float64 |
| `remainder_observed_wh` | nullable float64, aligned mask only |
| `present_minutes`, `valid_active_minutes`, `valid_reactive_minutes` | integer 0–15 |
| `valid_voltage_minutes`, `valid_current_minutes` | integer 0–15 |
| `valid_sub1_minutes`, `valid_sub2_minutes`, `valid_sub3_minutes` | integer 0–15 |
| `remainder_valid_minutes` | integer 0–15 |
| `quality` | `complete`, `partial`, `missing` for active power |
| `quality_flags` | list of machine-readable strings |

Keep unavailable optional features null and counts zero. Schema validation must not require their presence to run univariate analysis.

## 8. Storage and reproducibility

`var/datasets/{dataset_id}/` contains `source/input.txt`, `manifest.json`, `quality.json`, and `observations/` Parquet parts. The filename of the raw upload is not used as a filesystem path. A manifest records source SHA-256, mapping, time basis, row profile, selected dates, selected rows, software versions, ETL config, run times and output checksums.

Keep the aggregated dataset small enough for local queries. Avoid partitioning by minute/day for 16k rows; a few reasonably sized Parquet files are enough. Never collect raw millions of rows to the driver. Aggregated tables can be collected for bounded modeling only after an explicit row/memory check. Use DuckDB for filtered API reads with parameterized queries against registered artifact paths.

## 9. Configuration example

```yaml
schema_version: '2.0'
profile: development
row_limits: {development: 100000, final: 250000, full: null}
interval_minutes: 15
source_time_basis: source_local_naive
spark:
  master: 'local[2]'
  shuffle_partitions: 4
quality:
  target_required_minutes: 15
  display_estimate_min_minutes: 12
model_input:
  max_forward_fill_bins: 2
  max_imputed_fraction: 0.05
```

Start Spark with two local threads and one background job at a time. Tune driver memory after measuring RAM; do not allocate all machine resources. Record configuration and cold startup separately. Use `try/finally` to stop Spark and clean only job-owned staging files.

## 10. EDA deliverables

Produce reproducible analysis covering timestamp continuity, missingness per channel, daily/weekly power distributions, overnight profiles, power/current association, sub-metering coverage, and seasonality visible in the selected time span. Save charts and a concise interpretation alongside the dataset version. Mark findings restricted by the short sample or missing coverage. The website's Data and Consumption pages expose these outputs; notebook-only analysis is insufficient.

No invented correlation values or seasonal conclusions belong in the implementation spec. Compute them from the selected dataset. Use identical units and quality masks across notebook and website calculations.

## 11. Benchmark protocol

Measure 100k, 250k and optionally full-source runs. For each, save hardware/RAM/OS, software, source hash, selected rows, aggregate rows, end-to-end elapsed time, Spark startup, transformation/write timings and peak memory if measured. Run equivalent Pandas ETL only as a comparison, with identical parsing, missingness and selection rules. Verify result equality before interpreting runtime differences.

Record at least three timed repetitions when practical, identifying cold versus warm cache and reporting median plus range. Reading a full raw file before applying a row limit still counts as full-file I/O; do not call that time a pure 100k input read. Optional replicated-data tests must be labelled synthetic scalability exercises.

## 12. Acceptance checks

- Sorting and selection preserve chronological sequences; missing minutes survive as explicit gaps.
- A complete 1 kW bin yields 0.25 kWh; a bin with 12 valid 1 kW readings yields 0.20 observed kWh, 80% coverage and 0.25 extrapolated kWh.
- A 15-minute channel with 10 Wh per minute totals 150 Wh, not 10 Wh or 2,250 Wh.
- Complete-null bins and optional missing channels remain null in charts and API responses.
- Aligned remainder calculation uses the same minute mask across all four inputs.
- Same input/configuration produces equivalent sorted data and manifest provenance.
- Conflicting duplicates, unsupported timestamp conventions and invalid units fail clearly.
- A failed job cannot publish a partial dataset as ready.

## Sources

Checked 12 October 2026. Dataset facts/units/license: https://archive.ics.uci.edu/dataset/235/individual+household+electric+power+consumption . Runtime compatibility: https://spark.apache.org/docs/3.5.7/api/python/getting_started/install.html . Pipeline thresholds and resource defaults above are project choices, not UCI requirements.
