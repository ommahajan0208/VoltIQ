# Validation record — 12 October 2026

## Completed checks

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm test` | 35 tests passed across 6 files |
| `npm run build` | Passed with Next.js 16.4.0 / webpack |
| Route compilation | Landing, all seven workspace pages, dynamic event evidence and API proxy compiled |
| Source package | Includes lockfile, generated provisional client, fixture, tests, handoff docs and unchanged specifications |

Runtime: Node.js 24.19.0 on the provided Linux environment. Dependency versions are recorded in `package-lock.json`.

## Tested behavior

- Inclusive calendar dates become exclusive API ends across month/year/leap-day boundaries.
- Source labels remain offset-free; offset-bearing/invalid timestamps are rejected by the source-label validator.
- Half-open ranges exclude the end boundary.
- CSV output escapes user-entered formula prefixes, quotation marks and newlines while preserving numeric negatives/nulls.
- The synthetic fixture explicitly identifies its source/model as synthetic and has no scientific evaluation metrics.
- Missing observations stay null; quality-excluded bins have null score/candidate rather than a normal flag.
- Every synthetic event consists of adjacent flagged bins; event lists and overview counts agree.
- Clipped intersections preserve whole-event facts.
- Overnight synthetic profiles use the same filtered observations as overview totals.
- Missing-only ranges produce null energy and zero scored coverage.
- Review filters/revision conflicts work in the synthetic adapter.
- Endpoint forecasts have future target dates and no invented observed targets; horizon lengths and quantile ordering are correct.
- Unsaved origins and unavailable detectors do not receive invented results.
- Cache keys separate scientific identities, versions, runs, detectors, origins/horizons and API/demo modes.
- Real analytical response metadata rejects missing or conflicting dataset/run/version identity and unsupported time conventions.
- Uncertain JSON job retries reuse the original idempotency key within the current session.
- The local proxy preserves token/idempotency headers server-side, rejects unrelated origins/traversal and streams registered download metadata.
- Backend unavailability produces an actionable error without leaking internal diagnostics or falling back to demo data.

## Not verified

These checks do not prove model accuracy or complete end-to-end correctness. No functioning backend, persisted real result bundle or model checkpoint was supplied.

Browser automation and screenshot review were not performed in this environment. Responsive CSS and accessible control primitives are implemented, but 390/768/1440 px layouts, dialog focus behavior, linked chart cursors, touch/keyboard interactions, light mode, reduced-motion replay and print pagination still need browser QA.

The following acceptance gates also remain pending:

- Real upload → explicit mapping preview → PySpark → ready dataset → completed run.
- Generated client replacement using authoritative FastAPI OpenAPI.
- Real revision conflicts, job cancellation/restart recovery and inference-only dataset journeys.
- Full-resolution exports and frozen PDF/preview parity, including all paginated events and opt-in notes.
- Offline prepared real analysis and a full 250,000-row run.
- Numerical scientific tests, causal model verification, threshold calibration and actual performance/resource measurement in the backend.

No fabricated forecasting accuracy, savings, runtime or verified-fault claims are used to fill these gaps.
