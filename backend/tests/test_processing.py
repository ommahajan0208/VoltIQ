"""Processing contract checks; Spark numerical checks run when PySpark is installed."""

import unittest
import os
import shutil
import tempfile
import uuid
from pathlib import Path

from backend.app.processing import ProcessingError, inspect_source, process_dataset, validate_mapping

class MappingTests(unittest.TestCase):
    def test_frontend_uci_mapping(self):
        normalized = validate_mapping({
            "profile": "uci_native", "timestamp_columns": ["Date", "Time"],
            "active_power": {"column": "Global_active_power", "unit": "kW"},
        })
        self.assertEqual(normalized["source_kind"], "uci")
        self.assertEqual(normalized["columns"]["Sub_metering_3"], "sub3_observed_wh")

    def test_frontend_generic_mapping_and_units(self):
        normalized = validate_mapping({
            "profile": "generic_minute_power", "timestamp_column": "ts",
            "timestamp_format": "yyyy-MM-dd HH:mm:ss", "active_power": {"column": "p", "unit": "W"},
            "optional_channels": {"sub1": {"column": "kitchen", "unit": "Wh"}},
        })
        self.assertEqual(normalized["columns"]["kitchen"], "sub1_observed_wh")
        self.assertEqual(normalized["units"]["active_power_kw"], "W")

    def test_rejects_energy_units_and_offsets(self):
        base = {"source_kind": "generic", "timestamp_column": "ts",
                "timestamp_format": "yyyy-MM-dd HH:mm:ss", "active_power_column": "p"}
        with self.assertRaisesRegex(ProcessingError, "kWh"):
            validate_mapping({**base, "active_power_unit": "kWh"})
        with self.assertRaisesRegex(ProcessingError, "Offset-bearing"):
            validate_mapping({**base, "active_power_unit": "kW",
                              "timestamp_format": "yyyy-MM-dd HH:mm:ssXXX"})

    def test_requires_explicit_units_for_optional_channels(self):
        base = {"source_kind": "generic", "timestamp_column": "ts",
                "timestamp_format": "yyyy-MM-dd HH:mm:ss",
                "active_power_column": "p", "active_power_unit": "kW"}
        with self.assertRaisesRegex(ProcessingError, "Explicit unit Wh"):
            validate_mapping({**base, "optional_channels": {
                "sub1": {"column": "kitchen", "unit": "kW"}
            }})

        with self.assertRaisesRegex(ProcessingError, "mapped twice"):
            validate_mapping({**base, "columns": {
                "a": "voltage_v", "b": "voltage_v"
            }, "units": {"voltage_v": "V"}})

    def test_rejects_invalid_generic_shape_and_optional_channel(self):
        with self.assertRaisesRegex(ProcessingError, "delimiter"):
            validate_mapping({"source_kind": "generic", "delimiter": "|"})
        with self.assertRaisesRegex(ProcessingError, "Unsupported optional channel"):
            validate_mapping({"source_kind": "generic", "timestamp_column": "ts",
                              "timestamp_format": "yyyy-MM-dd HH:mm:ss",
                              "active_power_column": "p", "active_power_unit": "kW",
                              "optional_channels": {"appliance": {"column": "x", "unit": "Wh"}}})

    def test_preview_is_bounded(self):
        folder = Path(tempfile.mkdtemp(prefix=f"voltiq-preview-{uuid.uuid4().hex}-"))
        try:
            path = folder / "readings.csv"
            path.write_text("ts,p\n" + "\n".join(f"t{i},{i}" for i in range(105)), encoding="utf-8")
            preview = inspect_source(path)
            self.assertEqual(preview["columns"], ["ts", "p"])
            self.assertEqual(len(preview["preview"]), 100)
        finally:
            shutil.rmtree(folder)

    def test_preview_rejects_missing_binary_and_duplicate_headers(self):
        missing = Path(tempfile.mkdtemp(prefix="voltiq-missing-")) / "missing.csv"
        with self.assertRaisesRegex(ProcessingError, "does not exist"):
            inspect_source(missing)

        folder = Path(tempfile.mkdtemp(prefix="voltiq-invalid-preview-"))
        try:
            duplicate = folder / "duplicate.csv"
            duplicate.write_text("ts,ts\n2007-01-01,1\n", encoding="utf-8")
            with self.assertRaisesRegex(ProcessingError, "duplicate column"):
                inspect_source(duplicate)

            binary = folder / "binary.csv"
            binary.write_bytes(b"ts,p\n\x00,1\n")
            with self.assertRaisesRegex(ProcessingError, "Binary data"):
                inspect_source(binary)
        finally:
            shutil.rmtree(folder)


class SparkNumericalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            import pyspark  # noqa: F401
        except ImportError:
            raise unittest.SkipTest("PySpark is not installed")
        if not os.environ.get("JAVA_HOME") and shutil.which("java") is None:
            raise unittest.SkipTest("Java is not installed or JAVA_HOME is not configured")

    def test_energy_missingness_and_remainder(self):
        root = Path(tempfile.mkdtemp(prefix=f"voltiq-spark-{uuid.uuid4().hex}-"))
        try:
            source = root / "input.txt"
            header = "Date;Time;Global_active_power;Global_reactive_power;Voltage;Global_intensity;Sub_metering_1;Sub_metering_2;Sub_metering_3"
            rows = []
            for minute in range(30):
                active = "?" if minute in {16, 17, 18} else "1"
                rows.append(f"1/1/2007;00:{minute:02d}:00;{active};0.1;230;4;10;0;0")
            source.write_text(header + "\n" + "\n".join(rows) + "\n", encoding="utf-8")
            manifest = process_dataset(source, root / "version", "ds_test", {"source_kind": "uci"})
            self.assertEqual(manifest["selected_rows"], 30)
            self.assertEqual(manifest["aggregate_rows"], 2)
            self.assertEqual(manifest["quality"]["quality_counts"],
                             {"complete": 1, "partial": 1, "missing": 0})
            self.assertTrue((root / "version" / "manifest.json").is_file())
            import pyspark.sql
            spark = pyspark.sql.SparkSession.builder.master("local[1]").getOrCreate()
            try:
                data = spark.read.parquet(str(root / "version" / "observations")).orderBy("bin_start").collect()
                self.assertAlmostEqual(data[0]["observed_energy_kwh"], 0.25)
                self.assertAlmostEqual(data[1]["observed_energy_kwh"], 0.20)
                self.assertAlmostEqual(data[1]["estimated_full_bin_energy_kwh"], 0.25)
                self.assertAlmostEqual(data[0]["sub1_observed_wh"], 150.0)
                self.assertEqual(data[1]["valid_active_minutes"], 12)
                self.assertEqual(data[1]["remainder_valid_minutes"], 12)
            finally:
                spark.stop()
        finally:
            shutil.rmtree(root)

    def test_conflicting_duplicates_do_not_publish(self):
        root = Path(tempfile.mkdtemp(prefix=f"voltiq-conflict-{uuid.uuid4().hex}-"))
        try:
            source = root / "input.csv"
            source.write_text("ts,p\n2007-01-01 00:00:00,1\n2007-01-01 00:00:00,2\n", encoding="utf-8")
            mapping = {"source_kind": "generic", "timestamp_column": "ts",
                       "timestamp_format": "yyyy-MM-dd HH:mm:ss",
                       "active_power_column": "p", "active_power_unit": "kW"}
            with self.assertRaisesRegex(ProcessingError, "conflicting duplicate"):
                process_dataset(source, root / "version", "ds_conflict", mapping)
            self.assertFalse((root / "version" / "manifest.json").exists())
        finally:
            shutil.rmtree(root)


if __name__ == "__main__":
    unittest.main()
