"""Download and verify the pinned Chronos-Bolt tiny safetensors checkpoint once."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from app import store
from app.models import CHECKPOINT_REVISION


REPOSITORY = "amazon/chronos-bolt-tiny"
WEIGHT_SHA256 = "75068728d376d2bec670379eeef4bfb4d24c0cfe24d957451f8d19b447030a32"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def prepare() -> Path:
    try:
        from huggingface_hub import snapshot_download
    except ImportError as exc:
        raise RuntimeError("Install backend/requirements-ml.txt before preparing the model") from exc
    directory = store.ROOT / "models" / "chronos-bolt-tiny"
    weights = directory / "model.safetensors"
    config = directory / "config.json"
    if not (weights.is_file() and config.is_file() and sha256(weights) == WEIGHT_SHA256):
        directory.mkdir(parents=True, exist_ok=True)
        snapshot_download(repo_id=REPOSITORY, revision=CHECKPOINT_REVISION,
                          allow_patterns=["config.json", "model.safetensors"],
                          local_dir=str(directory))
    if not config.is_file() or not weights.is_file():
        raise RuntimeError("Pinned checkpoint is missing config.json or model.safetensors")
    actual = sha256(weights)
    if actual != WEIGHT_SHA256:
        raise RuntimeError(f"Checkpoint weight checksum mismatch: {actual}")
    (directory / "prepared.json").write_text(json.dumps({
        "repository": REPOSITORY, "revision": CHECKPOINT_REVISION,
        "weight_sha256": actual, "format": "safetensors",
    }, indent=2), encoding="utf-8")
    return directory


if __name__ == "__main__":
    print(prepare())
