from datetime import datetime, timedelta

from backend.app.peak_load import analyze_peak_rows
from backend.app.recommendations import build_recommendations


def rows(values):
    start = datetime(2007, 1, 1)
    output = []
    for index, value in enumerate(values):
        a = start + timedelta(minutes=index * 15)
        b = a + timedelta(minutes=15)
        output.append({
            "bin_start": a,
            "bin_end": b,
            "active_power_kw": value,
            "observed_energy_kwh": value * 0.25,
            "valid_active_minutes": 15,
        })
    return output


def test_peak_analysis_is_deterministic_and_groups_adjacent_peaks():
    analysis = analyze_peak_rows(rows([1, 1, 1, 5, 5, 1, 1, 6]), percentile=0.75)
    assert analysis["peak_count"] == 2
    assert next(event for event in analysis["events"] if event["peak_kw"] == 5)["duration_minutes"] == 30
    assert analysis["peak_kw"] == 6
    assert next(event for event in analysis["events"] if event["peak_kw"] == 5)["peak_at"] == "2007-01-01T00:45:00"
    assert next(event for event in analysis["events"] if event["peak_kw"] == 5)["end"] == "2007-01-01T01:15:00"
    assert analysis == analyze_peak_rows(rows([1, 1, 1, 5, 5, 1, 1, 6]), percentile=0.75)


def test_incomplete_rows_reduce_coverage_and_do_not_become_peaks():
    sample = rows([1, 5, 1])
    sample[1]["valid_active_minutes"] = 7
    analysis = analyze_peak_rows(sample, percentile=0.9)
    assert analysis["coverage"] < 1
    assert analysis["valid_bins"] == 2
    assert analysis["peak_count"] == 0


def test_recommendations_are_independent_transparent_rules():
    analysis = analyze_peak_rows(rows([1, 1, 1, 5, 5, 1, 1, 5, 5, 1, 1, 5, 5]), percentile=0.8)
    recommendations = build_recommendations(analysis, anomaly_event_count=2, anomaly_peak_score=3.2)
    rule_ids = {item["rule_id"] for item in recommendations}
    assert "repeated_high_peaks" in rule_ids
    assert "repeated_forecast_deviation" in rule_ids
    assert all("evidence" in item and "limitation" in item for item in recommendations)
    peak_rule = next(item for item in recommendations if item["rule_id"] == "repeated_high_peaks")
    assert peak_rule["evidence"]["top_peak_windows"][0]["peak_at"]