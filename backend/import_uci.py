"""Register the official UCI archive and queue a PySpark dataset version.

Run from backend/: python import_uci.py path/to/individual+household+electric+power+consumption.zip
"""

from __future__ import annotations

import argparse
import hashlib
import zipfile
from pathlib import Path

from app import store
from app.processing import validate_mapping


EXPECTED_SHA256 = "4259c9d7ece5dbee9ab8d53682baac68d791c864f0f64a52b4043cb3b90894b7"
INNER_NAME = "household_power_consumption.txt"


def register(archive: Path, profile: str) -> tuple[str, str]:
    if profile not in {"development", "final"}:
        raise ValueError("profile must be development or final")
    store.init()
    with zipfile.ZipFile(archive) as source:
        if source.namelist() != [INNER_NAME]:
            raise ValueError("Archive must contain only the official UCI TXT file")
        if source.getinfo(INNER_NAME).file_size > 200 * 1024 * 1024:
            raise ValueError("Uncompressed dataset exceeds the upload limit")
        dataset_id = store.new_id("ds")
        destination = store.ROOT / "uploads" / f"{dataset_id}.txt"
        destination.parent.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256()
        with source.open(INNER_NAME) as incoming, destination.open("wb") as outgoing:
            while block := incoming.read(1024 * 1024):
                digest.update(block)
                outgoing.write(block)
    if digest.hexdigest() != EXPECTED_SHA256:
        destination.unlink(missing_ok=True)
        raise ValueError("UCI file checksum does not match the expected official source")
    mapping = validate_mapping({"source_kind": "uci"})
    version = "v_" + store.digest({"source_hash": EXPECTED_SHA256, "mapping": mapping,
                                    "profile": profile, "start_date": None})
    dataset = {
        "id": dataset_id, "version": "", "label": "UCI Household Electric Power Consumption",
        "source_kind": "uci", "source_hash": EXPECTED_SHA256,
        "source_path": str(destination), "status": "processing", "mapping": mapping,
        "created_at": store.now(), "from": "", "to": "",
        "capabilities": {"observations": False, "forecast": False, "evaluation": False,
                         "circuits": False, "autoencoder": False},
    }
    store.put("dataset", dataset)
    job = store.enqueue("preprocess", {"dataset_id": dataset_id, "version": version,
                                       "profile": profile, "start_date": None})
    return dataset_id, job["id"]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--profile", choices=("development", "final"), default="development")
    args = parser.parse_args()
    dataset_id, job_id = register(args.archive, args.profile)
    print(f"dataset_id={dataset_id}\njob_id={job_id}")
