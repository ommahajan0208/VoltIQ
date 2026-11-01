export type Mode = "api" | "demo";
export type Quality = "complete" | "partial" | "missing";
export type ReviewStatus = "unreviewed" | "reviewed" | "needs_followup";
export interface Envelope<T> {
  data: T;
  meta: {
    schema_version: string;
    dataset_id?: string;
    dataset_version?: string;
    run_id?: string;
    time_basis: string;
    from?: string;
    to?: string;
    next_cursor?: string | null;
  };
}
export interface Dataset {
  id: string;
  version: string;
  label: string;
  source_kind: string;
  status: string;
  from: string;
  to: string;
  capabilities: {
    observations: boolean;
    forecast: boolean;
    evaluation: boolean;
    circuits: boolean;
    autoencoder: boolean;
  };
}
export interface Run {
  id: string;
  dataset_id: string;
  dataset_version: string;
  model_id: string;
  model_revision: string;
  status: string;
  evaluation_kind: string;
  test_from: string;
  test_to: string;
  threshold: number | null;
  config_hash: string;
  source_hash: string;
}
export interface Bin {
  bin_start: string;
  bin_end: string;
  active_power_kw: number | null;
  reactive_power_kvar: number | null;
  voltage_v: number | null;
  current_a: number | null;
  observed_energy_kwh: number | null;
  quality: Quality;
  valid_active_minutes: number;
  expected_minutes: number;
}
export interface Score {
  bin_start: string;
  actual_kw?: number | null;
  score: number | null;
  score_unit: string;
  predicted_kw: number | null;
  baseline_kw: number | null;
  threshold: number | null;
  status: "scored" | "not_scored" | "quality_excluded" | "not_calibrated";
  candidate: boolean | null;
}
export interface Review {
  status: ReviewStatus;
  note: string;
  revision: number;
}
export interface CandidateEvent {
  id: string;
  run_id: string;
  dataset_id: string;
  detector: string;
  start: string;
  end: string;
  visible_start?: string;
  visible_end?: string;
  duration_minutes: number;
  peak_score: number;
  score_unit: string;
  direction: "higher" | "lower" | "mixed";
  estimated_above_reference_kwh: number | null;
  review: Review;
}
export interface PeakEvidence {
  start: string;
  end: string;
  peak_at: string | null;
  peak_kw: number | null;
}
export interface PeakEvent {
  id: string;
  start: string;
  end: string;
  duration_minutes: number;
  peak_kw: number;
  peak_at: string;
  average_kw: number;
  energy_kwh: number;
  excess_over_median_kwh: number;
  baseline_kw: number;
  threshold_kw: number | null;
  bin_count: number;
}
export interface PeakSeriesPoint {
  time: string;
  observed_kw: number | null;
  observed_energy_kwh: number | null;
  baseline_kw: number | null;
  threshold_kw: number | null;
  valid: boolean;
  is_peak: boolean;
}
export interface PeakAnalysis {
  threshold_kw: number | null;
  percentile: number;
  coverage: number;
  observed_bins: number;
  valid_bins: number;
  peak_count: number;
  peak_kw: number | null;
  peak_energy_kwh: number;
  excess_over_median_kwh: number;
  events: PeakEvent[];
  series: PeakSeriesPoint[];
}
export interface Recommendation {
  id: string;
  rule_id: string;
  category: string;
  severity: "high" | "medium" | "low";
  title: string;
  rationale: string;
  action: string;
  confidence: "high" | "medium" | "low";
  evidence: Record<string, number | string | null | PeakEvidence[]>;
  limitation: string;
}
export interface RecommendationResult {
  recommendations: Recommendation[];
  peak_summary: Pick<PeakAnalysis, "threshold_kw" | "coverage" | "peak_count" | "peak_kw" | "excess_over_median_kwh">;
}export interface Overview {
  observed_energy_kwh: number | null;
  overnight_observed_energy_kwh: number | null;
  candidate_count: number;
  eligible_scored_bins: number;
  expected_bins: number;
  coverage: number;
  estimated_above_reference_kwh: number | null;
}
export interface ForecastPoint {
  origin: string;
  target_start: string;
  target_end: string;
  step: number;
  horizon: number;
  q10_kw: number | null;
  q50_kw: number | null;
  q90_kw: number | null;
  actual_kw?: number | null;
  persistence_kw: number | null;
  seasonal_naive_kw: number | null;
  target_eligible: boolean;
}
export interface Metrics {
  horizon: number;
  model_id: string;
  split?: string;
  mae_kw: number | null;
  rmse_kw: number | null;
  mase: number | null;
  coverage_q10_q90: number | null;
  count: number;
  skipped: number;
}
export interface Profiles {
  daily: {
    date: string;
    observed_energy_kwh: number | null;
    coverage: number;
    valid_bins: number;
  }[];
  slots: { slot: string; median_kw: number | null; count: number }[];
  circuits: { label: string; energy_kwh: number; coverage: number }[];
}
export interface QualityReport {
  selected_rows: number | null;
  invalid_timestamps: number | null;
  duplicate_rows: number | null;
  complete_bins: number | null;
  partial_bins: number | null;
  missing_bins: number | null;
  coverage: number | null;
  etl_seconds: number | null;
  gaps: { from: string; to: string; reason: string }[];
}
export interface Job {
  id: string;
  kind: string;
  status: string;
  stage: string;
  completed: number | null;
  total: number | null;
  error?: string;
  run_id?: string;
  report_id?: string;
  artifact_id?: string;
  row_count?: number;
  created_at?: string;
}
export interface Upload {
  id: string;
  detected_columns: string[];
  preview: Record<string, string>[];
}
export interface Report {
  id: string;
  status: string;
  run_id: string;
  from: string;
  to: string;
  artifact_ids: string[];
}
export interface Filters {
  version?: string;
  dataset: string;
  run: string;
  from: string;
  to: string;
  scope: string;
  channel: string;
  detector: string;
  direction: string;
  review: string;
  sort: string;
  min_score: string;
  cursor: string;
  origin: string;
  horizon: number;
  model: string;
  forecast_mode: string;
}
