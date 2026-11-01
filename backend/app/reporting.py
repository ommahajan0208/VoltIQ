"""Frozen, print-style report composed from published dataset and run artifacts."""

from __future__ import annotations

import html
import json
from pathlib import Path

import duckdb
from reportlab.graphics.shapes import Drawing, Line, PolyLine, Rect, String
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (
    HRFlowable, KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
)


INK = colors.HexColor("#142b43")
MUTED = colors.HexColor("#4b6075")
CYAN = colors.HexColor("#087b91")
LAVENDER = colors.HexColor("#625ac0")
AMBER = colors.HexColor("#986007")
BORDER = colors.HexColor("#dce5ed")
PALE = colors.HexColor("#f1f5f9")


def _para(text: object, style: ParagraphStyle) -> Paragraph:
    return Paragraph(html.escape(str(text or "")), style)


def _source(path: str) -> str:
    item = Path(path)
    return str(item / "*.parquet") if item.is_dir() else str(item)


def _query(path: str, sql: str, params: list[object]) -> list[tuple]:
    db = duckdb.connect()
    try:
        return db.execute(sql, [_source(path), *params]).fetchall()
    finally:
        db.close()


def _chart(values: list[float | None], title: str, hue: colors.Color) -> Drawing:
    width, height = 505, 155
    drawing = Drawing(width, height)
    drawing.add(Rect(0, 0, width, height, fillColor=colors.white,
                     strokeColor=BORDER, strokeWidth=.6))
    drawing.add(String(12, height - 18, title, fontName="Helvetica", fontSize=8,
                       fillColor=MUTED))
    left, right, bottom, top = 42, width - 12, 24, height - 33
    valid = [float(value) for value in values if value is not None]
    maximum = max(valid, default=1.0)
    maximum = max(maximum, 0.1)
    for fraction in (0, .5, 1):
        y = bottom + (top - bottom) * fraction
        drawing.add(Line(left, y, right, y, strokeColor=BORDER, strokeWidth=.5))
        drawing.add(String(5, y - 2, f"{maximum * fraction:.1f}",
                           fontName="Helvetica", fontSize=7, fillColor=MUTED))
    segment: list[float] = []
    for index, value in enumerate([*values, None]):
        if value is None:
            if len(segment) >= 4:
                drawing.add(PolyLine(segment, strokeColor=hue, strokeWidth=1.5))
            segment = []
            continue
        x = left + (right - left) * index / max(1, len(values) - 1)
        y = bottom + (top - bottom) * max(0, float(value)) / maximum
        segment.extend((x, y))
    drawing.add(String(left, 7, "Start of selected source period", fontName="Helvetica",
                       fontSize=7, fillColor=MUTED))
    drawing.add(String(right - 123, 7, "End of selected source period",
                       fontName="Helvetica", fontSize=7, fillColor=MUTED))
    return drawing


def render_report_pdf(report: dict, run: dict, dataset: dict, destination: Path) -> None:
    """Render the report's frozen configuration and review snapshot."""
    styles = {
        "title": ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=24,
                                leading=29, textColor=INK, spaceAfter=8),
        "subtitle": ParagraphStyle("subtitle", fontName="Helvetica", fontSize=10,
                                   leading=15, textColor=MUTED, spaceAfter=14),
        "heading": ParagraphStyle("heading", fontName="Helvetica-Bold", fontSize=12,
                                  leading=16, textColor=INK, spaceBefore=19, spaceAfter=10),
        "body": ParagraphStyle("body", fontName="Helvetica", fontSize=9,
                               leading=14, textColor=INK, spaceAfter=9),
        "small": ParagraphStyle("small", fontName="Helvetica", fontSize=8,
                                leading=12, textColor=MUTED, spaceAfter=7),
        "cell": ParagraphStyle("cell", fontName="Helvetica", fontSize=8,
                               leading=11, textColor=INK),
    }
    destination.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(str(destination), pagesize=A4, leftMargin=43,
                            rightMargin=43, topMargin=58, bottomMargin=54,
                            title="VoltIQ frozen report")
    story: list = []

    def section(title: str) -> None:
        story.append(_para(title, styles["heading"]))
        story.append(HRFlowable(width="100%", thickness=.6, color=BORDER,
                                spaceAfter=10))

    def table(rows: list[list[object]], widths: list[float] | None = None) -> None:
        rendered = [[_para(value, styles["cell"]) for value in row] for row in rows]
        item = Table(rendered, colWidths=widths, repeatRows=1, hAlign="LEFT")
        item.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), PALE),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("GRID", (0, 0), (-1, -1), .35, BORDER),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]))
        story.append(item)
        story.append(Spacer(1, 8))

    story.append(_para("Household energy analysis report", styles["title"]))
    story.append(_para(f'{dataset.get("label", "Dataset")} - source household time', styles["subtitle"]))
    if dataset.get("source_kind") == "test":
        story.append(_para("SYNTHETIC TEST FIXTURE - NOT UCI READINGS", styles["small"]))
    identity = [
        ["Run", run["id"]],
        ["Source dates", f'{report.get("from")} to {report.get("to")} (exclusive)'],
        ["Method", f'{run.get("model_id", "Unavailable")} - {run.get("evaluation_kind", "Unavailable")}'],
        ["Source hash", dataset.get("source_hash", "Unavailable")],
        ["Config hash", run.get("config_hash", "Unavailable")],
        ["Scope", report.get("scope", "all")],
    ]
    table(identity, [105, 404])

    sections = report.get("sections", [])
    from_time, to_time = report["from"], report["to"]
    observation_path = dataset.get("manifest", {}).get("observations_path")
    where = "bin_start>=? AND bin_start<?"
    if report.get("scope") == "overnight":
        where += " AND extract(hour from bin_start)<5"
    if "consumption" in sections and observation_path:
        section("01 / Consumption & coverage")
        result = _query(observation_path,
            f"SELECT sum(observed_energy_kwh),sum(valid_active_minutes),sum(expected_minutes) FROM read_parquet(?) WHERE {where}",
            [from_time, to_time])[0]
        energy, valid, expected = result
        coverage = (valid or 0) / expected if expected else 0
        score_path = run.get("manifest", {}).get("scores_path")
        eligible = "Unavailable"
        if score_path:
            eligible = _query(score_path,
                "SELECT count(*) FROM read_parquet(?) WHERE detector='residual' AND split='test' AND status='scored' AND bin_start>=? AND bin_start<?",
                [from_time, to_time])[0][0]
        table([["Observed energy", "Observed minute coverage", "Eligible scored intervals"],
               [f"{energy:.2f} kWh" if energy is not None else "Unavailable",
                f"{coverage * 100:.2f}%", str(eligible)]], [170, 170, 169])
        rows = _query(observation_path,
            f"SELECT active_power_kw FROM read_parquet(?) WHERE {where} ORDER BY bin_start",
            [from_time, to_time])
        values = [row[0] for row in rows]
        step = max(1, (len(values) + 799) // 800)
        story.append(_chart(values[::step], "Observed active power - kW", CYAN))
        story.append(Spacer(1, 10))
        story.append(_para("Observed totals include valid readings only. Gaps in the trace are missing observations.", styles["small"]))

    if "forecasting" in sections:
        section("Forecasting")
        story.append(_para(f'Model: {report.get("forecast_model") or run.get("model_id")}; origin: {report.get("forecast_origin") or "saved evaluation"}; horizon: {report.get("forecast_horizon") or "saved evaluation"} bins.', styles["body"]))
        metrics_path = run.get("manifest", {}).get("metrics_path")
        if metrics_path and Path(metrics_path).is_file():
            metrics = json.loads(Path(metrics_path).read_text(encoding="utf-8"))
            rows = [["Held-out horizon", "MAE (kW)", "Evaluated targets"]]
            for key, value in metrics.items():
                if key.startswith("test_h") and isinstance(value, dict):
                    mae = value.get("mae_kw")
                    rows.append([key.removeprefix("test_h"), f"{mae:.3f}" if isinstance(mae, (int, float)) else "Unavailable", value.get("target_bins", "Unavailable")])
            if len(rows) > 1:
                table(rows, [170, 170, 169])
        story.append(_para("A q10-q90 forecast range, when available, describes model spread and is not a guaranteed confidence interval.", styles["small"]))

    if "events" in sections:
        section("02 / Candidate intervals")
        events_path = run.get("manifest", {}).get("events_path")
        events = []
        if events_path:
            detector = {"chronos_residual": "residual", "statistical": "slot_mad"}.get(
                report.get("detector"), report.get("detector", "residual"))
            events = _query(events_path,
                'SELECT id,"start",duration_minutes,direction,peak_score,score_unit FROM read_parquet(?) WHERE "end">? AND "start"<? AND detector=? ORDER BY "start",id',
                [from_time, to_time, detector])
        selected = set(report.get("event_ids") or [])
        if selected:
            events = [event for event in events if event[0] in selected]
        story.append(_para(f"{len(events)} whole events intersect the selected source period.", styles["small"]))
        if events:
            rows = [["Source start", "Duration", "Direction", "Peak score"]]
            rows.extend([[str(event[1])[:16], f"{event[2]} min", event[3],
                          f"{event[4]:.2f} {event[5]}" if event[4] is not None else "Unavailable"]
                         for event in events])
            table(rows, [174, 92, 108, 135])
        else:
            story.append(_para("No candidate events match these filters.", styles["body"]))

    if "notes" in sections:
        section("Human review notes")
        snapshot = report.get("notes_snapshot", [])
        if not snapshot:
            story.append(_para("No review notes were selected when this report was requested.", styles["body"]))
        for item in snapshot:
            story.append(KeepTogether([
                _para(f'{item.get("event_id")} - {item.get("status")}', styles["body"]),
                _para(item.get("note", ""), styles["small"]),
            ]))

    if "quality" in sections:
        section("03 / Data quality")
        quality = dataset.get("manifest", {}).get("quality", {})
        counts = quality.get("quality_counts", {})
        if all(key in counts for key in ("complete", "partial", "missing")):
            quality_text = (f'Dataset quality snapshot: {counts["complete"]} complete, '
                            f'{counts["partial"]} partial and {counts["missing"]} missing '
                            'intervals. This covers the registered dataset.')
        else:
            quality_text = 'Interval quality counts are unavailable for this registered dataset.'
        story.append(_para(quality_text, styles["body"]))
        story.append(_para("Missing and partial intervals retain explicit quality states. Imputed model context never becomes observed target data.", styles["small"]))

    if "methodology" in sections:
        section("04 / Methodology & limitations")
        story.append(_para("Minute readings are validated and aggregated into 15-minute bins. Chronological evaluation separates training, validation calibration and held-out targets. Candidate events group adjacent flagged intervals under a saved threshold.", styles["body"]))
        story.append(_para("This household dataset has no verified anomaly labels. Unusual readings may reflect ordinary activity or forecast error. Estimated energy above a historical reference is not measured waste or savings.", styles["body"]))

    story.append(Spacer(1, 18))
    story.append(HRFlowable(width="100%", thickness=.6, color=BORDER, spaceAfter=10))
    source = dataset.get("manifest", {}).get("source_kind") or dataset.get("source_kind")
    attribution = ("Source: local test fixture, not measured UCI observations."
                   if source == "test" else
                   "Source: UCI Individual Household Electric Power Consumption - CC BY 4.0."
                   if source == "uci" else "Source: user-registered local dataset.")
    story.append(_para(attribution + " Time basis: offset-free source household time.", styles["small"]))

    def furniture(canvas, document):
        canvas.saveState()
        canvas.setFillColor(CYAN)
        canvas.setFont("Helvetica-Bold", 8)
        canvas.drawString(43, A4[1] - 35, "VOLTIQ")
        canvas.setFillColor(MUTED)
        canvas.setFont("Helvetica", 8)
        canvas.drawRightString(A4[0] - 43, A4[1] - 35, "FROZEN REPORT")
        canvas.setStrokeColor(BORDER)
        canvas.line(43, A4[1] - 42, A4[0] - 43, A4[1] - 42)
        canvas.drawString(43, 31, "Candidate events require human review")
        canvas.drawRightString(A4[0] - 43, 31, f"Page {document.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=furniture, onLaterPages=furniture)
