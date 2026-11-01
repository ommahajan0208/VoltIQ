"""Deterministic peak-load analysis over canonical observation rows."""
from __future__ import annotations

from datetime import datetime
from statistics import median
from typing import Any


def _percentile(values: list[float], percentile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    position = (len(ordered) - 1) * percentile
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    fraction = position - lower
    return ordered[lower] + (ordered[upper] - ordered[lower]) * fraction


def _iso(value: Any) -> str:
    if isinstance(value, datetime):
        return value.isoformat(timespec="seconds")
    return str(value)


def analyze_peak_rows(
    rows: list[dict[str, Any]],
    *,
    percentile: float = 0.99,
    min_duration_minutes: int = 15,
    gap_minutes: int = 15,
    max_series_points: int = 5000,
) -> dict[str, Any]:
    """Return peak summary, events, and chart series for canonical rows.

    Rules use active power for demand and observed energy for energy totals.
    Incomplete rows remain visible in the series but are excluded from peak
    detection and energy totals.
    """
    if not 0.5 <= percentile < 1:
        raise ValueError("percentile must be between 0.5 and 0.999")
    if min_duration_minutes < 15 or gap_minutes < 0:
        raise ValueError("duration must be at least 15 minutes and gap non-negative")
    ordered = sorted(rows, key=lambda row: _iso(row.get("bin_start")))
    valid = [
        row for row in ordered
        if row.get("active_power_kw") is not None
        and int(row.get("valid_active_minutes") or 0) == 15
    ]
    values = [float(row["active_power_kw"]) for row in valid]
    baseline_value = median(values) if values else None
    threshold = _percentile(values, percentile) if values else None
    peak_rows = [
        row
        for row in valid
        if threshold is not None
        and baseline_value is not None
        and threshold > baseline_value
        and float(row["active_power_kw"]) >= threshold
    ]

    groups: list[list[dict[str, Any]]] = []
    for row in peak_rows:
        if not groups:
            groups.append([row])
            continue
        previous = groups[-1][-1]
        previous_end = _iso(previous.get("bin_end"))
        current_start = _iso(row.get("bin_start"))
        gap = (datetime.fromisoformat(current_start) - datetime.fromisoformat(previous_end)).total_seconds() / 60
        if gap <= gap_minutes:
            groups[-1].append(row)
        else:
            groups.append([row])

    events: list[dict[str, Any]] = []
    for index, group in enumerate(groups, start=1):
        duration = len(group) * 15
        if duration < min_duration_minutes:
            continue
        powers = [float(row["active_power_kw"]) for row in group]
        peak_at = _iso(next(row for row in group if float(row["active_power_kw"]) == max(powers)).get("bin_start"))
        energy = sum(float(row.get("observed_energy_kwh") or 0) for row in group)
        baseline = baseline_value if baseline_value is not None else 0.0
        excess = sum(max(0.0, power - baseline) * 0.25 for power in powers)
        events.append({
            "id": f"peak_{index:04d}_{_iso(group[0].get('bin_start')).replace(':', '').replace('-', '')}",
            "start": _iso(group[0].get("bin_start")),
            "end": _iso(group[-1].get("bin_end")),
            "duration_minutes": duration,
            "peak_kw": max(powers),
            "peak_at": peak_at,
            "average_kw": sum(powers) / len(powers),
            "energy_kwh": energy,
            "excess_over_median_kwh": excess,
            "baseline_kw": baseline,
            "threshold_kw": threshold,
            "bin_count": len(group),
        })

    series = [
        {
            "time": _iso(row.get("bin_start")),
            "observed_kw": float(row["active_power_kw"]) if row.get("active_power_kw") is not None else None,
            "observed_energy_kwh": float(row["observed_energy_kwh"]) if row.get("observed_energy_kwh") is not None else None,
            "baseline_kw": baseline_value,
            "threshold_kw": threshold,
            "valid": int(row.get("valid_active_minutes") or 0) == 15,
            "is_peak": any(event["start"] <= _iso(row.get("bin_start")) < event["end"] for event in events),
        }
        for row in ordered
    ]
    if len(series) > max_series_points:
        stride = max(1, len(series) // max_series_points)
        kept = series[::stride]
        kept[-1:] = series[-1:]
        series = kept
    coverage = sum(1 for row in ordered if int(row.get("valid_active_minutes") or 0) == 15) / len(ordered) if ordered else 0.0
    top = sorted(events, key=lambda event: (-event["peak_kw"], event["start"]))
    return {
        "threshold_kw": threshold,
        "percentile": percentile,
        "coverage": coverage,
        "observed_bins": len(ordered),
        "valid_bins": len(valid),
        "peak_count": len(events),
        "peak_kw": max((event["peak_kw"] for event in events), default=None),
        "peak_energy_kwh": sum(event["energy_kwh"] for event in events),
        "excess_over_median_kwh": sum(event["excess_over_median_kwh"] for event in events),
        "events": top,
        "series": series,
    }
