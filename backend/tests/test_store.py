"""Durable SQLite metadata and job-queue contract tests."""

import pytest

from backend.app import store


@pytest.fixture()
def isolated_store(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "ROOT", tmp_path)
    monkeypatch.setattr(store, "DB", tmp_path / "metadata.sqlite3")
    store.init()
    return store


def test_idempotency_returns_original_job_and_rejects_changed_payload(isolated_store):
    first = isolated_store.enqueue(
        "evaluate", {"run_id": "run_a", "dataset_id": "ds_a"}, "same-key"
    )
    replay = isolated_store.enqueue(
        "evaluate", {"run_id": "run_a", "dataset_id": "ds_a"}, "same-key"
    )

    assert replay["id"] == first["id"]
    with pytest.raises(ValueError, match="idempotency_conflict"):
        isolated_store.enqueue(
            "evaluate", {"run_id": "run_b", "dataset_id": "ds_a"}, "same-key"
        )


def test_claim_update_and_list_jobs_preserve_state(isolated_store):
    queued = isolated_store.enqueue("export", {"run_id": "run_a"})
    claimed, payload = isolated_store.claim()

    assert claimed["id"] == queued["id"]
    assert claimed["status"] == "running"
    assert payload == {"run_id": "run_a"}

    isolated_store.update_job(
        queued["id"], stage="exporting", completed=2, total=4,
        result={"artifact_id": "art_a"}
    )
    job = isolated_store.get_job(queued["id"])
    assert job["stage"] == "exporting"
    assert job["completed"] == 2
    assert job["total"] == 4
    assert job["artifact_id"] == "art_a"
    jobs, cursor = isolated_store.list_jobs(status="running", limit=10)
    assert cursor is None
    assert [item["id"] for item in jobs] == [queued["id"]]


def test_cancel_queued_job_and_retry_increments_attempt(isolated_store):
    queued = isolated_store.enqueue("report", {"report_id": "report_a"})
    cancelled = isolated_store.cancel(queued["id"])
    assert cancelled["status"] == "cancelled"
    assert cancelled["stage"] == "cancelled"

    retried = isolated_store.retry(queued["id"])
    assert retried["status"] == "queued"
    assert retried["stage"] == "queued"
    assert retried["attempt"] == 2
    assert retried["cancel_requested"] is False


def test_retry_clears_previous_progress_and_result(isolated_store):
    queued = isolated_store.enqueue("export", {"run_id": "run_a"})
    isolated_store.update_job(
        queued["id"],
        status="failed",
        stage="failed",
        completed=4,
        total=4,
        error="temporary failure",
        result={"artifact_id": "stale-artifact", "row_count": 4},
    )

    retried = isolated_store.retry(queued["id"])

    assert retried["status"] == "queued"
    assert retried["stage"] == "queued"
    assert retried["completed"] is None
    assert retried["total"] is None
    assert retried["error"] is None
    assert "artifact_id" not in retried
    assert "row_count" not in retried


def test_running_cancel_is_cooperative_and_stale_jobs_are_interrupted(isolated_store):
    queued = isolated_store.enqueue("evaluate", {"run_id": "run_a"})
    claimed, _ = isolated_store.claim()
    assert claimed["status"] == "running"

    cancelling = isolated_store.cancel(queued["id"])
    assert cancelling["status"] == "cancelling"
    assert cancelling["cancel_requested"] is True

    isolated_store.interrupt_stale()
    interrupted = isolated_store.get_job(queued["id"])
    assert interrupted["status"] == "interrupted"
    assert interrupted["stage"] == "interrupted"


def test_retry_rejects_active_jobs_and_missing_jobs(isolated_store):
    queued = isolated_store.enqueue("evaluate", {"run_id": "run_a"})
    with pytest.raises(ValueError, match="retry_conflict"):
        isolated_store.retry(queued["id"])
    assert isolated_store.cancel("missing") is None
    assert isolated_store.retry("missing") is None
