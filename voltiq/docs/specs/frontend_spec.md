# Frontend Specification — VoltIQ

Revision 2 · 12 October 2026. Full local web application, using Next.js/React/TypeScript, Tailwind, Motion and Apache ECharts. Read `design.md` for visual composition and `backend_spec.md` for exact API semantics.

## 1. Global behavior

The website supports two equal entry paths: saved UCI analysis and compatible uploaded data. Every analytical page shows dataset identity, run identity where applicable, source-time convention and selected dates. Never combine a chart from one run with metrics from another.

Canonical URL parameters on analysis routes: `dataset`, `run`, `from`, `to`, `scope=all|overnight`. Route-specific parameters include `detector`, `origin`, `horizon`, `model` and event filters. Defaults resolve to explicit URL state after loading. Browser back/forward and refresh reproduce the view. Dates use the API's half-open convention; a user-selected inclusive calendar end date is converted to next-day midnight for the API.

Default Overview/Anomalies range is the selected run's test interval. Consumption can explore the entire dataset. Anomaly overlays show unscored areas explicitly. Forecasting additionally owns an origin; it must not use the global range end as an implicit origin without displaying that choice.

Use a generated OpenAPI client and a query cache with dataset/version/run/filter keys. Local state owns temporary dialogs, hover and unsaved form inputs. URL owns shareable filters. Persist theme/motion preferences locally; do not put raw readings or notes into browser storage.

## 2. Capability-based UI

| Capability | Available actions |
|---|---|
| Ready observations | Consumption and quality exploration |
| At least 192 eligible context bins | Dataset-end forecasting if checkpoint ready |
| Evaluation minima met | Evaluate required models and calibrate detectors |
| Complete sub-meter channels | Circuit/remainder views |
| Complete four-channel windows | Optional autoencoder experiment |
| Completed run | Overview, anomalies, saved metrics and report generation |
| Cached checkpoint | Offline Chronos inference |

Display disabled actions with their reason and a useful next step. Do not hide a required feature simply because its artifacts are missing. A new user should understand how to enable it.

## 3. Landing — `/`

**Purpose:** explain the product and provide entry without forcing an upload or account.

Content: original energy-line hero, concise forecasting/anomaly explanation, two CTAs, interactive historical-night preview, four-step methodology and dataset attribution. Use the composition and motion in `design.md`.

Controls: “Explore saved analysis” opens the run picker and then `/overview`; if there are no saved runs, open `/data` with setup guidance. “Analyze your data” opens the upload wizard. Method anchor scrolls normally. Preview offers pause/play, speed and scrub controls. Illustration or fixture content has a persistent label.

**Output:** the user understands what the project does and can enter either workflow. Do not claim live monitoring or show fabricated accuracy/savings. Acceptance: both CTAs work without login, keyboard controls operate the preview, and offline cached assets load.

## 4. Overview — `/overview`

**Inputs:** selected completed run, date range and all/overnight scope.

**Layout:** title/context line; four metric cards; dominant observed-power timeline; recent-event table; coverage and scored-range strip. The four cards are observed energy (kWh), overnight observed energy (kWh), candidate event count and eligible scored bins/coverage. Cards show the denominator/range where needed. Estimated above-reference energy is a separately labelled supporting measure, not a savings card.

**Actions:** change range/scope; brush timeline and choose “Explore consumption”; click marker or recent event to open Event Detail; open Forecasting with the selected run; select another run. Show the full observed range if requested but shade unscored periods. Marker IDs come from the same event endpoint as the list.

**API:** run metadata, overview, dataset series, scores and events. Fetch independent queries together; render only matching identities. Use full-resolution server aggregates for metrics, not chart display points.

**Output:** a reliable summary of the selected period and specific candidates to inspect. Acceptance: event count equals distinct intersecting primary events under the same filters; partial-event totals are labelled; zero events is distinct from zero scored bins; quality-excluded intervals are not rendered normal.

## 5. Consumption Explorer — `/consumption`

**Inputs:** ready dataset, optional run for overlays, dates and channel.

**Layout:** full-width timeline; calendar heatmap of daily observed energy and coverage; median daily slot profile; circuit-energy and remainder panels when supported. Provide units and quality legend close to each chart. Heatmap missing days use a dedicated missing state.

**Actions:** select active/reactive power, voltage or current; zoom/brush/reset; select a calendar day; compare up to three nights aligned by source time-of-day; toggle candidate overlay; inspect sub-metering; export full-resolution filtered observations. Night comparison uses separate lines and explicit dates, never concatenated pseudo-continuous data.

For daily heatmap/profile values, show contributing valid counts/coverage. Comparing days with different coverage must retain the coverage indicator. Do not rank partial observed totals as full-day energy usage without explanation.

**API:** dataset series, profiles, quality and optional scores/events. **Output:** explain when measured consumption changes and which measured circuits contribute. Acceptance: heatmap selection synchronizes the timeline, range reset works, unavailable channels show a reason, and exports match filters with complete-resolution rows.

## 6. Forecasting — `/forecasting`

**Inputs:** selected dataset/run/model, mode, origin and horizon.

Two explicit modes:

- **Historical backtest:** choose an available origin within a saved evaluated split. Display known targets only as comparison, with the origin visibly dividing past/future. Metrics belong to that horizon and model, with the overall held-out metrics separately labelled.
- **After dataset endpoint:** choose latest valid context and horizon; launch inference job. Targets are dated after the historical dataset endpoint. No accuracy metric appears unless observations later become available through a new evaluated dataset/run.

**Layout:** mode/origin/horizon toolbar; observed context + median forecast + q10–q90 band; baseline toggle; prediction table; context quality and provenance; evaluation summary. Horizon options: 15 min, 1 h, 4 h. Show quantile band legend and empirical held-out coverage, if available.

**Actions:** choose compatible model; step previous/next saved origin; switch horizon; generate missing inference; toggle persistence/seasonal naive; download forecast CSV. Baselines missing required history remain unavailable, not zero. A model label always identifies which engine generated the shown values.

**API:** saved forecasts GET or asynchronous forecast POST; run metrics; job status. When only a ready dataset is available, first create an `inference` run through `POST /runs`; this requires context eligibility but not evaluation history. **Output:** dated, origin-specific future estimates and interpretable comparison. Acceptance: no observed future value enters the model context, no fake loading forecast is shown, crossing a date range does not silently change origin, and unavailable targets never produce accuracy figures.

## 7. Anomaly Explorer — `/anomalies`

**Inputs:** completed run, detector and date/scope filters.

**Layout:** summary of scored bins and candidate count; score timeline with saved threshold; filter bar; event table; optional selected-event evidence preview. Default detector is Chronos one-step residual. Statistical detector and optional reconstruction detector have separate labels and units.

**Filters:** date, all/overnight, direction (higher/lower/mixed), review status, minimum peak score; sort newest first by default, with highest score/duration alternatives. Table columns: start, duration, direction, peak score with unit, reference-energy estimate where available and review status. Paginate server-side.

**Actions:** select row for preview, open full detail, reset filters, export event CSV. Threshold editing belongs to Models; the main anomaly list always uses the saved run threshold. Optional reconstruction results use window-support semantics and never inflate primary interval KPIs.

**Output:** reviewable unusual periods, not verified faults. Acceptance: “No candidates” includes eligible count; `not_calibrated` has a distinct explanation; switching detectors changes unit/threshold/help text; loading a new filter page cannot flash old-run events.

## 8. Event Detail — `/anomalies/[id]`

**Inputs:** event ID; derive authoritative run/dataset from the event response. If URL context conflicts, update it or show the correct identity, never fetch mixed evidence.

**Layout:** breadcrumb and summary (“Consumption was higher than the one-step forecast” or appropriate direction); period/duration/score facts; synchronized observed/predicted/slot-reference chart and score chart; surrounding-data quality strip; evidence table; review form; provenance.

**Actions:** extend context before/after event; switch measured channel; move shared cursor; inspect prediction origin; mark reviewed/needs follow-up; save plain-text note; export evidence through a report job. Preserve an unsaved note when a request fails. On a revision conflict, show the newer note and let the user copy their draft before reapplying it.

For optional autoencoder events, replace forecast explanation with reconstruction/window support and show the complete two-hour windows. Do not infer individual device attribution from per-feature reconstruction error.

**API:** event GET, series/scores/forecast evidence, review PATCH, reports POST. **Output:** evidence and a human annotation attached to a reproducible event. Acceptance: refresh preserves saved note; unreviewed does not imply false alarm; missing event returns a useful 404 view; chart/table/export agree on dates and units.

## 9. Dataset & Pipeline — `/data`

**Layout:** dataset inventory and source badges; upload/UCI entry actions; mapping wizard; ready dataset quality report; measured processing stages; job history. The saved UCI path can select a maintainer-provided bundle or import the downloaded source file; do not silently download data in a page render.

### Upload wizard

| Step | Controls and validation | Result |
|---|---|---|
| Select | CSV/TXT, max size displayed, original filename preview | Temporary registered upload |
| Map | Native UCI or generic; delimiter, timestamp format, power column/unit, optional channels | Explicit mapping |
| Preview | First rows, parsed timestamps, unit conversion, detected errors | User sees interpretation |
| Configure | Development 100k / final 250k / full; optional start date | Reproducible chronological selection |
| Process | Submit job, actual stages, cancel control | Ready dataset or actionable failure |
| Analyze | Quality and capability summary; evaluate or forecast | Analysis job and eventual run |

Quality view shows valid/invalid timestamps, duplicates, selected rows/date span, gaps, per-channel coverage, complete/partial/missing bins, observed versus estimated energy accounting and ETL runtime. A missingness heatmap links to affected periods. Raw samples are bounded, never a million-row browser table.

**API:** upload/mapping/preprocess, dataset quality/profiles, jobs, runs POST. **Output:** traceable processed data and an available analysis path. Acceptance: incompatible units fail before execution; refresh recovers the job; changing dataset clears incompatible run selection; upload errors never trigger fallback demo data.

## 10. Model & Evaluation — `/models`

**Layout:** saved-run list; checkpoint/config/split summary; model comparison by horizon; residual/threshold plots; observed performance/resource table; experiment panel. Frozen pretrained inference shows checkpoint information instead of a fabricated local training curve.

**Required content:** source hashes, checkpoint revision/provenance status, eligible/skipped counts, chronological ranges, quality rules, forecast MAE/RMSE/MASE and quantile metrics, residual threshold method and validation count, test alert frequency, real-data limitations and synthetic results when actually run.

**Actions:** select/compare compatible runs; queue required evaluation; preview threshold quantile; launch allowlisted optional experiment; import Colab bundle; export evaluation report. Comparisons require the same dataset version and matched horizon/target set; otherwise show side-by-side configurations with a comparability warning, not a winner ranking.

Threshold preview is visibly “Exploratory preview.” It uses validation scores to derive the alternate threshold, then shows changed candidate counts as exploratory. Reset returns to saved results. Saving creates a new run/config; no overwrite. If the user has inspected test outputs during tuning, record the new result as exploratory.

**API:** runs, metrics, threshold-previews, experiments, bundles/import and jobs. **Output:** explain how results were generated and assessed. Acceptance: optional experiments are disabled with reasons when unsupported; synthetic precision/recall cannot appear as real anomaly accuracy; all charts have counts and no unrecorded metric is filled with a placeholder number.

## 11. Reports — `/reports`

**Inputs:** completed run, date range, optional selected events and sections.

**Layout:** section controls and identity summary; readable print-layout preview; past generated reports. Sections: consumption/coverage, forecasting, candidate events, review notes (opt-in), data quality, methodology and limitations. Attribution/run identity always appear.

**Actions:** preview; generate PDF; export observations/forecasts/scores/events CSV; reopen completed export. Generating freezes parameters and review snapshot. Later filter changes create a new draft and cannot relabel an existing PDF. Display report date range and run next to Download.

**API:** reports POST/GET, exports POST and artifact download. **Output:** presentation-ready evidence with units, dates, methods and limitations. Acceptance: preview and downloaded file share configuration, no chart is cropped, source-time dates stay unchanged, all values trace to artifacts and full-resolution export row counts are visible.

## 12. Shared components and state handling

| Component | Required behavior |
|---|---|
| `AppShell` | Responsive navigation, context toolbar and jobs indicator |
| `DatasetRunSelector` | Capability-aware choices; invalidates dependent selection |
| `SourceDateRange` | Source-time parsing; explicit inclusive UI/half-open API conversion |
| `MetricCard` | Unit, coverage/denominator and null state |
| `TimeSeriesPanel` | Exact tooltip, zoom/reset, quality gaps and accessible data alternative |
| `ForecastPanel` | Origin rule, quantile legend and eligible actuals |
| `EventTable` | Server sorting/pagination, stable selection, keyboard access |
| `JobStatus` | Actual stage/counts, refresh recovery, cancel/cancelling states |
| `QualityBadge` | Complete/partial/missing text, not only color |
| `ReviewForm` | Plain text, revision conflict and unsaved-state handling |
| `ArtifactDownload` | Only completed registered artifacts; errors retain context |
| `EmptyState` | Reason-specific explanation and useful next action |

Fetch errors show retry in the failed panel without wiping completed data elsewhere. Initial skeletons retain layout dimensions. During filter transitions, mark old data as updating and disable actions that would export or open stale identities. Abort or ignore superseded responses.

Demo fixtures are an explicit mode with a persistent “Synthetic demonstration” banner. Real-data parse/model errors never switch to fixtures automatically. No dataset means setup guidance, not a fake populated dashboard.

## 13. Frontend organization and implementation guidance

Use route groups for landing and application shell. Put chart rendering in client components loaded dynamically; keep initial page shells lean. Organize feature modules for data, forecasting, anomalies, models and reports; shared UI belongs in one component package, not copies per developer.

Do not hard-code paths to backend Parquet/CSV in the browser. Do not compute scientific thresholds, event grouping or report KPIs separately in React. The browser can format values and control views; the API/artifacts own scientific outputs. ECharts uses a shared semantic color/theme adapter from `design.md`.

Use a query library for server state and accessible headless primitives for dialogs/selects. A separate global-state framework is optional; URL + query cache + local component state is sufficient initially. Keep API URLs configurable through local environment settings.

## 14. Frontend acceptance scenarios

1. A fresh visitor enters saved results, brushes a period, inspects an event and exports its report.
2. A user uploads valid generic power data, maps W to kW, processes it and completes forecasting/evaluation when eligible.
3. A short upload supports exploration but explains why evaluation is disabled.
4. A job survives refresh/navigation; cancellation shows truthful terminal state.
5. A range containing only unscored data never says “No anomalies detected.”
6. Forecast mode shows origin and true target dates; dataset-end mode has no invented ground truth.
7. Dataset and run switches cannot retain old chart values or reviews.
8. Keyboard-only use supports navigation, filters, review, upload and export.
9. Reduced motion disables hero/replay autoplay and chart geometry motion while preserving functionality.
10. Layout works at 390, 768 and 1440 px; heavy tables/plots scroll internally when necessary.
11. A previously prepared saved run works with internet disconnected; absent uncached models explain the setup requirement.
12. PDF/CSV exports match the selected identity, dates, units and documented quality rules.

Verify against real persisted fixtures and one full 250k run; screenshots alone do not validate scientific or workflow correctness.
