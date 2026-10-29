"""Deterministic PySpark ETL for minute household-power readings.

Measurement timestamps are source-local wall-clock labels. Spark uses UTC only
to make parsing and grouping stable; exported strings carry no UTC suffix.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

SCHEMA_VERSION = "2.0"
TIME_BASIS = "source_local_naive"
ROW_LIMITS = {"development": 100_000, "final": 250_000, "full": None}
SOURCE_TO_CANONICAL = {
    "Global_active_power": "active_power_kw",
    "Global_reactive_power": "reactive_power_kvar",
    "Voltage": "voltage_v",
    "Global_intensity": "current_a",
    "Sub_metering_1": "sub1_observed_wh",
    "Sub_metering_2": "sub2_observed_wh",
    "Sub_metering_3": "sub3_observed_wh",
}
CHANNELS = tuple(SOURCE_TO_CANONICAL.values())
COUNT_NAMES = {
    "active_power_kw": "valid_active_minutes",
    "reactive_power_kvar": "valid_reactive_minutes",
    "voltage_v": "valid_voltage_minutes",
    "current_a": "valid_current_minutes",
    "sub1_observed_wh": "valid_sub1_minutes",
    "sub2_observed_wh": "valid_sub2_minutes",
    "sub3_observed_wh": "valid_sub3_minutes",
}
MEAN_CHANNELS = set(CHANNELS[:4])
UPLOAD_MAX_BYTES = 200 * 1024 * 1024
UPLOAD_MAX_ROWS = 3_000_000


class ProcessingError(ValueError):
    """Actionable invalid-source or invalid-mapping error."""


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_json(path: Path, value: Any) -> None:
    with path.open("w", encoding="utf-8") as stream:
        json.dump(value, stream, indent=2, sort_keys=True, allow_nan=False)
        stream.write("\n")


def validate_mapping(mapping: dict[str, Any]) -> dict[str, Any]:
    """Normalize UCI or generic minute-power mapping before starting Spark.

    Generic example: {"timestamp_column":"time", "timestamp_format":
    "yyyy-MM-dd HH:mm:ss", "active_power_column":"power", "active_power_unit":"W"}.
    Optional channels can be supplied by ``columns`` and ``units`` dictionaries.
    """
    if not isinstance(mapping, dict):
        raise ProcessingError("Mapping must be a JSON object.")
    kind = mapping.get("source_kind", mapping.get("kind", mapping.get("profile", "uci")))
    kind = {"uci_native": "uci", "generic_minute_power": "generic"}.get(kind, kind)
    if kind not in {"uci", "generic"}:
        raise ProcessingError("source_kind must be 'uci' or 'generic'.")
    if kind == "uci":
        columns = dict(SOURCE_TO_CANONICAL)
        normalized = {
            "source_kind": "uci", "delimiter": ";", "date_column": "Date",
            "time_column": "Time", "timestamp_format": "dd/MM/yyyy HH:mm:ss",
            "columns": columns,
            "units": {key: ("Wh" if key.startswith("sub") else "kW" if key == "active_power_kw" else "native") for key in CHANNELS},
        }
    else:
        active_spec = mapping.get("active_power", {})
        if not isinstance(active_spec, dict):
            raise ProcessingError("active_power must specify a source column and unit.")
        delimiter = mapping.get("delimiter", ",")
        if delimiter not in {",", ";"}:
            raise ProcessingError("delimiter must be comma or semicolon.")
        timestamp_column = mapping.get("timestamp_column")
        timestamp_format = mapping.get("timestamp_format")
        active_column = mapping.get("active_power_column", active_spec.get("column"))
        unit = mapping.get("active_power_unit", active_spec.get("unit"))
        if not all(isinstance(v, str) and v for v in (timestamp_column, timestamp_format, active_column)):
            raise ProcessingError("Generic mapping requires timestamp_column, timestamp_format and active_power_column.")
        if unit not in {"kW", "W"}:
            raise ProcessingError("active_power_unit must be explicitly set to kW or W; kWh is energy, not power.")
        if any(token in timestamp_format for token in ("X", "x", "Z", "z", "O", "V")):
            raise ProcessingError("Offset-bearing timestamp formats are unsupported; normalize to naive minute timestamps first.")
        if not ("H" in timestamp_format and "m" in timestamp_format):
            raise ProcessingError("timestamp_format must include hour and minute.")
        columns = {active_column: "active_power_kw"}
        optional = mapping.get("columns", {})
        frontend_channels = {
            "reactive_power": "reactive_power_kvar", "voltage": "voltage_v",
            "current": "current_a", "sub1": "sub1_observed_wh",
            "sub2": "sub2_observed_wh", "sub3": "sub3_observed_wh",
        }
        if "optional_channels" in mapping:
            optional = {}
            for key, spec in mapping["optional_channels"].items():
                if key not in frontend_channels or not isinstance(spec, dict):
                    raise ProcessingError(f"Unsupported optional channel: {key!r}.")
                optional[spec.get("column")] = frontend_channels[key]
        if not isinstance(optional, dict):
            raise ProcessingError("columns must map source column names to canonical channels.")
        for source, canonical in optional.items():
            if canonical not in CHANNELS or canonical == "active_power_kw" or not isinstance(source, str):
                raise ProcessingError(f"Unsupported optional column mapping: {source!r} → {canonical!r}.")
            if canonical in columns.values():
                raise ProcessingError(f"Channel {canonical} is mapped twice.")
            columns[source] = canonical
        units = {"active_power_kw": unit}
        supplied_units = dict(mapping.get("units", {}))
        for key, spec in mapping.get("optional_channels", {}).items():
            if key in frontend_channels and isinstance(spec, dict):
                supplied_units[frontend_channels[key]] = spec.get("unit")
        for canonical in columns.values():
            if canonical == "active_power_kw":
                continue
            expected = "Wh" if canonical.startswith("sub") else {"reactive_power_kvar": "kVAR", "voltage_v": "V", "current_a": "A"}[canonical]
            if supplied_units.get(canonical) != expected:
                raise ProcessingError(f"Explicit unit {expected} required for {canonical}.")
            units[canonical] = expected
        normalized = {
            "source_kind": kind, "delimiter": delimiter, "timestamp_column": timestamp_column,
            "timestamp_format": timestamp_format, "columns": columns, "units": units,
        }
    if len(set(normalized["columns"])) != len(normalized["columns"]):
        raise ProcessingError("A source column can map to only one channel.")
    return normalized


def inspect_source(source_path: str | Path, *, preview_limit: int = 100) -> dict[str, Any]:
    """Bounded, non-Spark preview for the upload/mapping screen."""
    import csv

    path = Path(source_path)
    if not path.is_file():
        raise ProcessingError("Source file does not exist.")
    if path.stat().st_size > UPLOAD_MAX_BYTES:
        raise ProcessingError("Source exceeds the 200 MiB upload limit.")
    with path.open("r", encoding="utf-8-sig", newline="") as stream:
        head = stream.readline()
        if "\x00" in head:
            raise ProcessingError("Binary data is not accepted.")
        delimiter = ";" if head.count(";") > head.count(",") else ","
        stream.seek(0)
        reader = csv.DictReader(stream, delimiter=delimiter)
        columns = reader.fieldnames or []
        if len(columns) != len(set(columns)) or not columns:
            raise ProcessingError("Header has missing or duplicate column names.")
        preview = []
        for _, row in zip(range(max(0, min(preview_limit, 100))), reader):
            preview.append(row)
    return {"columns": columns, "delimiter": delimiter, "preview": preview, "size_bytes": path.stat().st_size}


def process_dataset(
    source_path: str | Path,
    output_dir: str | Path,
    dataset_id: str,
    mapping: dict[str, Any],
    profile: str = "development",
    start_date: str | None = None,
    spark_master: str = "local[2]",
) -> dict[str, Any]:
    """Process source into an atomically published immutable dataset version.

    ``output_dir`` is a version directory that must not already contain a
    manifest. Only this invocation's staging directory is removed on failure.
    The returned manifest is also written to ``output_dir/manifest.json`` last.
    """
    try:
        from pyspark.sql import SparkSession, Window, functions as F, types as T
    except ImportError as exc:
        raise RuntimeError("PySpark is required; install backend dependencies and Java before preprocessing.") from exc

    source = Path(source_path).resolve()
    destination = Path(output_dir).resolve()
    if not source.is_file():
        raise ProcessingError("Source file does not exist.")
    if source.stat().st_size > UPLOAD_MAX_BYTES:
        raise ProcessingError("Source exceeds the 200 MiB upload limit.")
    if not dataset_id or any(ch not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-" for ch in dataset_id):
        raise ProcessingError("dataset_id must be an opaque alphanumeric ID.")
    if profile not in ROW_LIMITS:
        raise ProcessingError("profile must be development, final or full.")
    config = validate_mapping(mapping)
    if destination.joinpath("manifest.json").exists():
        raise ProcessingError("Dataset version is already published; use a new output directory.")
    if start_date is not None:
        try:
            datetime.strptime(start_date, "%Y-%m-%d")
        except ValueError as exc:
            raise ProcessingError("start_date must be YYYY-MM-DD.") from exc
    destination.parent.mkdir(parents=True, exist_ok=True)
    staging = destination.parent / f".{dataset_id}-{uuid.uuid4().hex}.staging"
    staging.mkdir()
    spark = None
    started = time.monotonic()
    try:
        source_copy = staging / "source" / "input.txt"
        source_copy.parent.mkdir()
        shutil.copyfile(source, source_copy)
        source_hash = _sha256(source_copy)
        spark_start = time.monotonic()
        spark = (SparkSession.builder.master(spark_master).appName("VoltIQETL")
                 .config("spark.sql.session.timeZone", "UTC")
                 .config("spark.sql.ansi.enabled", "false")
                 .config("spark.sql.shuffle.partitions", "4")
                 .config("spark.driver.host", "127.0.0.1")
                 .getOrCreate())
        spark.conf.set("spark.sql.session.timeZone", "UTC")
        spark_start_seconds = time.monotonic() - spark_start
        raw = (spark.read.option("header", True).option("sep", config["delimiter"])
               .option("mode", "PERMISSIVE").option("encoding", "UTF-8")
               .option("inferSchema", False).csv(str(source_copy)))
        expected_columns = set(config["columns"])
        if config["source_kind"] == "uci":
            expected_columns.update(("Date", "Time"))
        else:
            expected_columns.add(config["timestamp_column"])
        missing_columns = sorted(expected_columns - set(raw.columns))
        if missing_columns:
            raise ProcessingError(f"Missing required source columns: {', '.join(missing_columns)}")
        source_rows = raw.count()
        if source_rows > UPLOAD_MAX_ROWS:
            raise ProcessingError("Source exceeds the 3,000,000-row processing limit.")
        if config["source_kind"] == "uci":
            # Normalization accepts single-digit source dates while retaining strict order.
            d = F.trim(F.col("Date"))
            t = F.trim(F.col("Time"))
            parts = F.regexp_extract(d, r"^(\d{1,2})/(\d{1,2})/(\d{4})$", 1)
            month = F.regexp_extract(d, r"^(\d{1,2})/(\d{1,2})/(\d{4})$", 2)
            year = F.regexp_extract(d, r"^(\d{1,2})/(\d{1,2})/(\d{4})$", 3)
            normalized_time = F.concat_ws("-", year, F.lpad(month, 2, "0"), F.lpad(parts, 2, "0"))
            timestamp_text = F.concat_ws(" ", normalized_time, t)
            timestamp = F.when(t.rlike(r"^\d{2}:\d{2}:\d{2}$"), F.to_timestamp(timestamp_text, "yyyy-MM-dd HH:mm:ss"))
        else:
            raw_text = F.trim(F.col(config["timestamp_column"]))
            # Offsets must never be silently discarded by a permissive parser.
            without_offset = ~raw_text.rlike(r"(?i)(Z|[+-]\d{2}:?\d{2})$")
            if raw.filter(~without_offset).limit(1).count():
                raise ProcessingError("Offset-bearing timestamps are unsupported; normalize to naive source-local minutes first.")
            timestamp = F.when(without_offset, F.to_timestamp(raw_text, config["timestamp_format"]))
        parsed = raw.withColumn("timestamp_local", timestamp)
        parsed = parsed.withColumn("timestamp_local", F.when(
            F.second("timestamp_local") == 0, F.col("timestamp_local")))
        invalid_timestamps = parsed.filter(F.col("timestamp_local").isNull()).count()
        parsed = parsed.filter(F.col("timestamp_local").isNotNull())
        if source_rows == invalid_timestamps:
            raise ProcessingError("No minute timestamps parsed. Check timestamp format and source columns.")
        for raw_name, canonical in config["columns"].items():
            value = F.trim(F.col(raw_name))
            number = F.when((value != "") & (value != "?"), value.cast("double"))
            number = F.when(~(F.isnan(number) | (F.abs(number) == float("inf"))), number)
            if canonical == "active_power_kw" and config["units"][canonical] == "W":
                number = number / 1000.0
            parsed = parsed.withColumn(canonical, number)
            parsed = parsed.withColumn(f"parse_error_{canonical}",
                                       F.when((value != "") & (value != "?") & F.col(canonical).isNull(), 1).otherwise(0))
        for canonical in CHANNELS:
            if canonical not in config["columns"].values():
                parsed = parsed.withColumn(canonical, F.lit(None).cast("double"))
                parsed = parsed.withColumn(f"parse_error_{canonical}", F.lit(0))
        parsed = parsed.select("timestamp_local", *CHANNELS, *(f"parse_error_{c}" for c in CHANNELS))
        # Exact duplicates collapse; conflicting values at one timestamp fail.
        unique = parsed.dropDuplicates(["timestamp_local", *CHANNELS])
        distinct_rows = unique.count()
        conflicts = (unique.groupBy("timestamp_local").count().filter("count > 1").count())
        if conflicts:
            raise ProcessingError(f"{conflicts} timestamps have conflicting duplicate readings; correct the source before import.")
        duplicate_rows = (source_rows - invalid_timestamps) - distinct_rows
        unique = unique.dropDuplicates(["timestamp_local"])
        if start_date:
            unique = unique.filter(F.col("timestamp_local") >= F.to_timestamp(F.lit(start_date), "yyyy-MM-dd"))
        selected = unique.orderBy("timestamp_local")
        limit = ROW_LIMITS[profile]
        if limit is not None:
            selected = selected.limit(limit)
        selected = selected.cache()
        selected_rows = selected.count()
        if not selected_rows:
            raise ProcessingError("No rows remain after the selected start_date.")
        bounds = selected.agg(
            F.date_format(F.min("timestamp_local"), "yyyy-MM-dd'T'HH:mm:ss").alias("first"),
            F.date_format(F.max("timestamp_local"), "yyyy-MM-dd'T'HH:mm:ss").alias("last"),
            F.min("timestamp_local").alias("min_ts"), F.max("timestamp_local").alias("max_ts"),
        ).first()
        minute = selected.withColumn("bin_start", F.from_unixtime(
            F.floor(F.unix_timestamp("timestamp_local") / 900) * 900).cast("timestamp"))
        aligned = F.when(
            F.col("active_power_kw").isNotNull() &
            F.col("sub1_observed_wh").isNotNull() &
            F.col("sub2_observed_wh").isNotNull() &
            F.col("sub3_observed_wh").isNotNull(),
            F.col("active_power_kw") * (1000.0 / 60.0) - F.col("sub1_observed_wh") -
            F.col("sub2_observed_wh") - F.col("sub3_observed_wh"),
        )
        minute = minute.withColumn("remainder_minute_wh", aligned)
        measures = [F.count("timestamp_local").alias("present_minutes")]
        for canonical in CHANNELS:
            measures.append(F.count(canonical).cast("int").alias(COUNT_NAMES[canonical]))
            if canonical in MEAN_CHANNELS:
                measures.append(F.avg(canonical).alias(canonical))
            else:
                measures.append(F.sum(canonical).alias(canonical))
        measures += [F.sum(F.col("active_power_kw") / 60.0).alias("observed_energy_kwh"),
                     F.sum("remainder_minute_wh").alias("remainder_observed_wh"),
                     F.count("remainder_minute_wh").cast("int").alias("remainder_valid_minutes")]
        grouped = minute.groupBy("bin_start").agg(*measures)
        grid = spark.range(1).select(F.explode(F.sequence(
            F.from_unixtime(F.floor(F.unix_timestamp(F.lit(bounds["min_ts"])) / 900) * 900).cast("timestamp"),
            F.from_unixtime(F.floor(F.unix_timestamp(F.lit(bounds["max_ts"])) / 900) * 900).cast("timestamp"),
            F.expr("interval 15 minutes"))).alias("bin_start"))
        observations = grid.join(grouped, "bin_start", "left")
        for count_name in ["present_minutes", *COUNT_NAMES.values(), "remainder_valid_minutes"]:
            observations = observations.withColumn(count_name, F.coalesce(F.col(count_name), F.lit(0)).cast("int"))
        observations = (observations.withColumn("bin_end", F.expr("bin_start + interval 15 minutes"))
                        .withColumn("schema_version", F.lit(SCHEMA_VERSION))
                        .withColumn("dataset_id", F.lit(dataset_id))
                        .withColumn("expected_minutes", F.lit(15))
                        .withColumn("active_coverage", F.col("valid_active_minutes") / 15.0)
                        .withColumn("estimated_full_bin_energy_kwh", F.when(
                            F.col("valid_active_minutes") >= 12, F.col("active_power_kw") * 0.25))
                        .withColumn("quality", F.when(F.col("valid_active_minutes") == 15, "complete")
                                    .when(F.col("valid_active_minutes") == 0, "missing").otherwise("partial"))
                        .withColumn("quality_flags", F.array_compact(F.array(
                            F.when(F.col("present_minutes") < 15, F.lit("missing_positions")),
                            F.when(F.col("valid_active_minutes") < F.col("present_minutes"), F.lit("missing_active_readings")),
                            F.when(F.col("remainder_observed_wh") < 0, F.lit("negative_remainder"))))))
        observations = observations.orderBy("bin_start").cache()
        counts = observations.groupBy("quality").count().collect()
        quality_counts = {kind: 0 for kind in ("complete", "partial", "missing")}
        quality_counts.update({row["quality"]: row["count"] for row in counts})
        aggregate_rows = sum(quality_counts.values())
        parse_errors = selected.agg(*(F.sum(f"parse_error_{c}").alias(c) for c in CHANNELS)).first().asDict()
        gap_rows = (observations.filter(F.col("quality") == "missing")
                    .select(F.date_format("bin_start", "yyyy-MM-dd'T'HH:mm:ss").alias("start"))
                    .orderBy("start").collect())
        # Missing-bin starts are bounded by the 3M-row source limit (~200k bins).
        gaps = []
        for row in gap_rows:
            start = row["start"]
            if gaps and datetime.fromisoformat(start) == datetime.fromisoformat(gaps[-1]["end"]):
                gaps[-1]["end"] = (datetime.fromisoformat(start) + timedelta(minutes=15)).isoformat()
                gaps[-1]["bins"] += 1
            else:
                gaps.append({"start": start, "end": (datetime.fromisoformat(start) +
                             timedelta(minutes=15)).isoformat(), "bins": 1})
        quality = {
            "schema_version": SCHEMA_VERSION, "dataset_id": dataset_id,
            "time_basis": TIME_BASIS, "source_rows": source_rows,
            "invalid_timestamp_rows": invalid_timestamps, "duplicate_rows": duplicate_rows,
            "conflicting_timestamp_count": 0, "valid_unique_rows_before_selection": distinct_rows,
            "selected_rows": selected_rows, "aggregate_rows": aggregate_rows,
            "missing_minute_positions": aggregate_rows * 15 - selected_rows,
            "quality_counts": quality_counts, "numeric_parse_errors_selected": parse_errors,
            "gap_spans": gaps,
        }
        _write_json(staging / "quality.json", quality)
        parquet_path = staging / "observations"
        observations.coalesce(4).write.mode("errorifexists").parquet(str(parquet_path))
        observations.unpersist()
        selected.unpersist()
        checksums = {str(path.relative_to(staging)).replace("\\", "/"): _sha256(path)
                     for path in parquet_path.rglob("*.parquet")}
        checksums["source/input.txt"] = source_hash
        checksums["quality.json"] = _sha256(staging / "quality.json")
        manifest = {
            "schema_version": SCHEMA_VERSION, "dataset_id": dataset_id,
            "dataset_version_hash": hashlib.sha256(json.dumps({
                "source_sha256": source_hash, "mapping": config, "profile": profile,
                "start_date": start_date, "schema_version": SCHEMA_VERSION,
            }, sort_keys=True).encode("utf-8")).hexdigest(),
            "observations_path": str(destination / "observations"),
            "observations": "observations",
            "source_kind": config["source_kind"], "source_sha256": source_hash,
            "source_filename": source.name, "source_license": "CC BY 4.0" if config["source_kind"] == "uci" else None,
            "mapping": config, "profile": profile, "row_limit": limit,
            "start_date": start_date, "time_basis": TIME_BASIS,
            "display_zone_label": "Source household time", "interval_minutes": 15,
            "first_timestamp": bounds["first"], "last_timestamp": bounds["last"],
            "from": datetime.fromisoformat(bounds["first"]).replace(
                minute=(datetime.fromisoformat(bounds["first"]).minute // 15) * 15,
                second=0, microsecond=0).isoformat(),
            "to": (datetime.fromisoformat(bounds["last"]).replace(
                minute=(datetime.fromisoformat(bounds["last"]).minute // 15) * 15,
                second=0, microsecond=0) + timedelta(minutes=15)).isoformat(),
            "selected_rows": selected_rows, "aggregate_rows": aggregate_rows,
            "quality": quality, "checksums": checksums,
            "capabilities": {"submetering": all(c in config["columns"].values() for c in CHANNELS[4:]),
                             "multivariate": all(c in config["columns"].values() for c in CHANNELS[:4])},
            "software": {"pyspark": spark.version},
            "etl_config": {"spark_master": spark_master, "shuffle_partitions": 4,
                           "target_required_minutes": 15, "display_estimate_min_minutes": 12},
            "created_at": _utc_now(),
            "timings_seconds": {"spark_startup": round(spark_start_seconds, 3),
                                "total_before_publish": round(time.monotonic() - started, 3)},
        }
        _write_json(staging / "manifest.json", manifest)
        if destination.exists():
            if any(destination.iterdir()):
                raise ProcessingError("Output directory is not empty; choose a new dataset version path.")
            destination.rmdir()
        os.replace(staging, destination)
        return manifest
    finally:
        if spark is not None:
            spark.stop()
        if staging.exists():
            shutil.rmtree(staging)
