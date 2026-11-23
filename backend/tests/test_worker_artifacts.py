"""Worker publication and artifact integrity tests."""

import hashlib

import pytest

from backend.app import store, worker


def test_publish_moves_complete_job_directory_and_rejects_overwrite(tmp_path):
    temporary = tmp_path / "tmp" / "job-1"
    final = tmp_path / "runs" / "run-1"
    temporary.mkdir(parents=True)
    (temporary / "run_manifest.json").write_text("{}", encoding="utf-8")

    worker._publish(temporary, final)
    assert final.is_dir()
    assert (final / "run_manifest.json").read_text(encoding="utf-8") == "{}"
    assert not temporary.exists()

    replacement = tmp_path / "tmp" / "job-2"
    replacement.mkdir(parents=True)
    with pytest.raises(RuntimeError, match="already exists"):
        worker._publish(replacement, final)


def test_registered_artifact_has_a_verifiable_checksum(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "ROOT", tmp_path)
    monkeypatch.setattr(store, "DB", tmp_path / "metadata.sqlite3")
    store.init()
    path = tmp_path / "artifacts" / "result.csv"
    path.parent.mkdir(parents=True)
    content = b"value\n1\n"
    path.write_bytes(content)
    artifact = store.put("artifact", {
        "id": "art-1", "owner_id": "run-1", "path": str(path),
        "mime": "text/csv", "sha256": hashlib.sha256(content).hexdigest(),
        "size": len(content),
    })
    assert artifact["sha256"] == hashlib.sha256(path.read_bytes()).hexdigest()
    assert artifact["size"] == path.stat().st_size
