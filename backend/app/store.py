"""SQLite metadata and durable, single-consumer job queue."""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(os.environ.get("VOLTIQ_DATA_DIR", Path(__file__).resolve().parents[1] / "data")).resolve()
DB = ROOT / "metadata.sqlite3"

def _relocate_legacy_path(value):
    if not isinstance(value, str):
        return value
    marker = chr(92) + "backend" + chr(92) + "data" + chr(92)
    index = value.lower().find(marker)
    if index < 0:
        return value
    candidate = ROOT / value[index + len(marker):].replace(chr(92), "/")
    return str(candidate) if candidate.exists() else value


def _relocate_legacy_paths(value):
    if isinstance(value, dict):
        return {key: _relocate_legacy_paths(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_relocate_legacy_paths(item) for item in value]
    return _relocate_legacy_path(value)



def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


def digest(value: object) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode()).hexdigest()


@contextmanager
def connect():
    ROOT.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB, timeout=30)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA busy_timeout=30000")
    db.execute("PRAGMA journal_mode=WAL")
    try:
        yield db
        db.commit()
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()


def init():
    with connect() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS entities (
          kind TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          PRIMARY KEY(kind,id));
        CREATE INDEX IF NOT EXISTS entities_kind_created ON entities(kind,created_at,id);
        CREATE TABLE IF NOT EXISTS jobs (
          id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL,
          stage TEXT NOT NULL, completed INTEGER, total INTEGER,
          payload TEXT NOT NULL, result TEXT, error TEXT, attempt INTEGER NOT NULL DEFAULT 1,
          cancel_requested INTEGER NOT NULL DEFAULT 0, lease_until TEXT,
          created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, updated_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS jobs_queue ON jobs(status,created_at,id);
        CREATE TABLE IF NOT EXISTS idempotency (
          key TEXT PRIMARY KEY, request_hash TEXT NOT NULL, response TEXT NOT NULL);
        """)


def put(kind: str, entity: dict):
    stamp = now()
    with connect() as db:
        db.execute("""INSERT INTO entities(kind,id,payload,created_at,updated_at)
            VALUES(?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET
            payload=excluded.payload,updated_at=excluded.updated_at""",
            (kind, entity["id"], json.dumps(entity, allow_nan=False), entity.get("created_at", stamp), stamp))
    return entity


def get(kind: str, id: str) -> dict | None:
    with connect() as db:
        row = db.execute("SELECT payload FROM entities WHERE kind=? AND id=?", (kind,id)).fetchone()
    return _relocate_legacy_paths(json.loads(row[0])) if row else None


def list_entities(kind: str, cursor: str | None = None, limit: int = 50) -> tuple[list[dict],str | None]:
    with connect() as db:
        rows = db.execute("SELECT id,payload FROM entities WHERE kind=? AND id>? ORDER BY id LIMIT ?", (kind,cursor or "",limit+1)).fetchall()
    more = len(rows)>limit
    rows=rows[:limit]
    return [_relocate_legacy_paths(json.loads(r["payload"])) for r in rows], rows[-1]["id"] if more else None


def enqueue(kind: str, payload: dict, key: str | None = None) -> dict:
    request_hash = digest({"kind":kind,"payload":payload})
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        if key:
            old=db.execute("SELECT request_hash,response FROM idempotency WHERE key=?",(key,)).fetchone()
            if old:
                if old["request_hash"] != request_hash:
                    raise ValueError("idempotency_conflict")
                return json.loads(old["response"])
        job={"id":new_id("job"),"kind":kind,"status":"queued","stage":"queued",
             "completed":None,"total":None,"attempt":1,"created_at":now(),"updated_at":now(),
             **{k:v for k,v in payload.items() if k.endswith("_id")}}
        db.execute("""INSERT INTO jobs(id,kind,status,stage,completed,total,payload,attempt,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?)""",(job["id"],kind,"queued","queued",None,None,json.dumps(payload),1,job["created_at"],job["updated_at"]))
        if key:
            db.execute("INSERT INTO idempotency VALUES(?,?,?)",(key,request_hash,json.dumps(job)))
        return job


def job_view(row) -> dict:
    if row is None: return None
    result=json.loads(row["result"]) if row["result"] else {}
    return {"id":row["id"],"kind":row["kind"],"status":row["status"],"stage":row["stage"],
            "completed":row["completed"],"total":row["total"],"error":row["error"],
            "attempt":row["attempt"],"cancel_requested":bool(row["cancel_requested"]),
            "created_at":row["created_at"],"updated_at":row["updated_at"],
            **{k:v for k,v in json.loads(row["payload"]).items() if k.endswith("_id")},**result}


def get_job(id: str) -> dict | None:
    with connect() as db: return job_view(db.execute("SELECT * FROM jobs WHERE id=?",(id,)).fetchone())


def list_jobs(cursor: str | None=None, status: str | None=None, limit: int=50):
    with connect() as db:
        rows=db.execute("SELECT * FROM jobs WHERE id>? AND (? IS NULL OR status=?) ORDER BY id LIMIT ?",(cursor or "",status,status,limit+1)).fetchall()
    more=len(rows)>limit; rows=rows[:limit]
    return [job_view(r) for r in rows], rows[-1]["id"] if more else None


def claim() -> tuple[dict,dict] | None:
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        row=db.execute("SELECT * FROM jobs WHERE status='queued' ORDER BY created_at,id LIMIT 1").fetchone()
        if not row: return None
        stamp=now()
        db.execute("UPDATE jobs SET status='running',stage='starting',started_at=?,updated_at=? WHERE id=?",(stamp,stamp,row["id"]))
        return job_view(db.execute("SELECT * FROM jobs WHERE id=?",(row["id"],)).fetchone()),json.loads(row["payload"])


def update_job(id: str, **fields):
    allowed={"status","stage","completed","total","error","result","cancel_requested","lease_until","finished_at"}
    fields={k:v for k,v in fields.items() if k in allowed}
    if "result" in fields and isinstance(fields["result"],dict): fields["result"]=json.dumps(fields["result"],allow_nan=False)
    fields["updated_at"]=now()
    with connect() as db:
        db.execute("UPDATE jobs SET "+",".join(f"{k}=?" for k in fields)+" WHERE id=?",(*fields.values(),id))


def cancel(id: str) -> dict | None:
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        row=db.execute("SELECT status FROM jobs WHERE id=?",(id,)).fetchone()
        if not row:return None
        if row[0]=="queued": db.execute("UPDATE jobs SET status='cancelled',stage='cancelled',finished_at=?,updated_at=? WHERE id=?",(now(),now(),id))
        elif row[0]=="running": db.execute("UPDATE jobs SET status='cancelling',cancel_requested=1,updated_at=? WHERE id=?",(now(),id))
    return get_job(id)


def interrupt_stale():
    # Worker is a single process. On its next launch, old in-flight jobs need explicit retry.
    with connect() as db:
        db.execute("UPDATE jobs SET status='interrupted',stage='interrupted',updated_at=? WHERE status IN ('running','cancelling')",(now(),))


def retry(id: str) -> dict | None:
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        row=db.execute("SELECT status FROM jobs WHERE id=?",(id,)).fetchone()
        if not row:return None
        if row[0] not in ("failed","interrupted","cancelled"): raise ValueError("retry_conflict")
        db.execute("UPDATE jobs SET status='queued',stage='queued',error=NULL,cancel_requested=0,attempt=attempt+1,updated_at=? WHERE id=?",(now(),id))
    return get_job(id)
