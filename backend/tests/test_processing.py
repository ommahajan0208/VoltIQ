"""Processing contract checks; Spark numerical checks run when PySpark is installed."""

import unittest
import shutil
import uuid
from pathlib import Path

from backend.app.processing import ProcessingError, inspect_source, process_dataset, validate_mapping

TEST_TEMP_ROOT = Path(__file__).resolve().parent


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

    def test_preview_is_bounded(self):
        folder = TEST_TEMP_ROOT / f"test-{uuid.uuid4().hex}"
        folder.mkdir()
        try:
            path = folder / "readings.csv"
            path.write_text("ts,p\n" + "\n".join(f"t{i},{i}" for i in range(105)), encoding="utf-8")
            preview = inspect_source(path)
            self.assertEqual(preview["columns"], ["ts", "p"])
            self.assertEqual(len(preview["preview"]), 100)
        finally:
            shutil.rmtree(folder)


class SparkNumericalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            import pyspark  # noqa: F401
        except ImportError:
            raise unittest.SkipTest("PySpark is not installed")

    def test_energy_missingness_and_remainder(self):
        root = TEST_TEMP_ROOT / f"test-{uuid.uuid4().hex}"
        root.mkdir()
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
        root = TEST_TEMP_ROOT / f"test-{uuid.uuid4().hex}"
        root.mkdir()
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
