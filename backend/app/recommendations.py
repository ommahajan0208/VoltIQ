"""Explainable rule-based recommendations from dynamic household evidence."""
from __future__ import annotations

from collections import Counter
from typing import Any


def build_recommendations(
    peak_analysis: dict[str, Any],
    *,
    anomaly_event_count: int = 0,
    anomaly_peak_score: float | None = None,
) -> list[dict[str, Any]]:
    """Evaluate independent rules; no weighted aggregate score is used."""
    recommendations: list[dict[str, Any]] = []
    events = peak_analysis.get("events", [])
    coverage = float(peak_analysis.get("coverage") or 0)

    if len(events) >= 3:
        recommendations.append({
            "id": "rule_peak_shaving",
            "rule_id": "repeated_high_peaks",
            "category": "peak_shaving",
            "severity": "high" if len(events) >= 6 else "medium",
            "title": "Review repeated high-demand peaks",
            "rationale": "The selected period contains repeated demand intervals above the household's dynamic peak threshold.",
            "action": "Review the largest peak windows and consider staggering flexible loads.",
            "confidence": "high" if coverage >= 0.95 else "medium",
            "evidence": {
                "peak_count": len(events),
                "threshold_kw": peak_analysis.get("threshold_kw"),
                "peak_kw": peak_analysis.get("peak_kw"),
                "excess_over_median_kwh": peak_analysis.get("excess_over_median_kwh"),
                "top_peak_windows": [{key: event.get(key) for key in ("start", "end", "peak_at", "peak_kw")} for event in events[:5]],
            },
            "limitation": "This identifies a repeated load pattern; it does not identify a specific appliance or guarantee savings.",
        })

    hours = Counter(event["start"][11:13] for event in events if event.get("start"))
    if events and hours and max(hours.values()) >= 2:
        common_hour, count = hours.most_common(1)[0]
        recommendations.append({
            "id": "rule_load_shifting",
            "rule_id": "concentrated_peak_window",
            "category": "load_shifting",
            "severity": "medium",
            "title": "Investigate a concentrated peak window",
            "rationale": f"Peak events recur most often around source-household hour {common_hour}:00.",
            "action": "Compare flexible consumption in this window with lower-demand periods before considering load shifting.",
            "confidence": "medium" if coverage >= 0.9 else "low",
            "evidence": {"source_hour": common_hour, "event_count": count},
            "limitation": "Time concentration alone does not prove that a load is flexible or wasteful.",
        })

    overnight = [event for event in events if event.get("start", "")[11:13] < "05"]
    if overnight:
        recommendations.append({
            "id": "rule_overnight_review",
            "rule_id": "overnight_peak_activity",
            "category": "overnight_review",
            "severity": "medium",
            "title": "Review unusual overnight demand",
            "rationale": "At least one dynamic peak occurred during the configured overnight window.",
            "action": "Review equipment operating during the overnight period and compare with the household's normal overnight baseline.",
            "confidence": "medium" if coverage >= 0.95 else "low",
            "evidence": {"overnight_peak_count": len(overnight)},
            "limitation": "Overnight usage can be intentional; this is a review prompt, not a fault diagnosis.",
        })

    if anomaly_event_count > 0:
        recommendations.append({
            "id": "rule_forecast_investigation",
            "rule_id": "repeated_forecast_deviation",
            "category": "investigation",
            "severity": "high" if anomaly_event_count >= 3 else "medium",
            "title": "Investigate forecast-deviation events",
            "rationale": "The selected run contains candidate intervals where observed demand differed materially from the forecast.",
            "action": "Open the anomaly evidence and compare the intervals with observed consumption and data quality.",
            "confidence": "high" if anomaly_peak_score is not None else "medium",
            "evidence": {"candidate_event_count": anomaly_event_count, "largest_score": anomaly_peak_score},
            "limitation": "Forecast deviation may reflect normal activity, missing context, or model error.",
        })

    if coverage < 0.95:
        recommendations.append({
            "id": "rule_data_quality",
            "rule_id": "incomplete_measurement_coverage",
            "category": "data_quality",
            "severity": "high" if coverage < 0.8 else "medium",
            "title": "Improve measurement coverage before acting",
            "rationale": "Incomplete intervals reduce confidence in peak totals and rule evidence.",
            "action": "Resolve missing or partial readings and rerun the analysis before estimating impact.",
            "confidence": "high",
            "evidence": {"coverage": coverage, "missing_fraction": 1 - coverage},
            "limitation": "This is a data-quality recommendation, not a household-consumption recommendation.",
        })

    return recommendations
