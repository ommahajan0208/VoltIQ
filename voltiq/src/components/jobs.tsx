"use client";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Activity, Download } from "lucide-react";
import { useResource, useView } from "@/lib/state";
import { mutateApi } from "@/lib/api/client";
import type { Job } from "@/lib/types";
import { Modal, QueryState, Badge, Notice } from "./ui";
import { downloadCsv } from "@/lib/time";
export function JobCard({
  job,
  onChanged,
}: {
  job: Job;
  onChanged: () => unknown;
}) {
  const { mode } = useView();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const active = ["queued", "running", "cancelling"].includes(job.status);
  return (
    <article className="job-card">
      <div>
        <strong>{job.kind}</strong>
        <Badge tone={job.status === "succeeded" ? "success" : "neutral"}>
          {job.status}
        </Badge>
      </div>
      <p>{job.stage}</p>
      {job.total != null && job.completed != null ? (
        <>
          <progress max={job.total} value={job.completed} />
          <small>
            {job.completed} / {job.total} completed
          </small>
        </>
      ) : active ? (
        <p>In progress · stage timing is reported by the worker</p>
      ) : null}
      {job.error && <Notice>{job.error}</Notice>}
      {active && job.status !== "cancelling" && mode === "api" && (
        <button
          className="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await mutateApi(`/jobs/${job.id}/cancel`, {});
              onChanged();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Request cancellation
        </button>
      )}
      {job.status === "succeeded" && job.artifact_id && (
        <a
          className="button"
          href={`/api/v1/artifacts/${encodeURIComponent(job.artifact_id)}/download`}
        >
          <Download size={16} />
          Download completed artifact
          {job.row_count != null ? ` · ${job.row_count} rows` : ""}
        </a>
      )}
      {error && <Notice>{error}</Notice>}
    </article>
  );
}
export function JobsIndicator() {
  const [open, setOpen] = useState(false);
  const jobs = useResource<Job[]>("jobs");
  const active =
    jobs.data?.data.filter((j) =>
      ["queued", "running", "cancelling"].includes(j.status),
    ).length ?? 0;
  return (
    <>
      <button className="jobs-button" onClick={() => setOpen(true)}>
        <Activity size={16} />
        <span>Activity</span>
        {active > 0 && <b>{active}</b>}
      </button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Processing activity"
        description="Actual worker stages and completed artifacts."
      >
        <QueryState query={jobs}>
          {jobs.data?.data.length ? (
            jobs.data.data.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                onChanged={() => jobs.refetch()}
              />
            ))
          ) : (
            <p className="muted">
              No active or saved jobs. Processing starts when you submit a
              dataset or analysis.
            </p>
          )}
        </QueryState>
      </Modal>
    </>
  );
}
export function ExportButton({
  kind,
  rows,
  disabled = false,
  label = "Export CSV",
}: {
  kind: string;
  rows?: Record<string, unknown>[];
  disabled?: boolean;
  label?: string;
}) {
  const { mode, filters, update } = useView();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div>
      <button
        className="button"
        disabled={disabled || busy}
        onClick={async () => {
          setError("");
          if (mode === "demo") {
            if (rows?.length) downloadCsv(`synthetic-${kind}.csv`, rows);
            else setError("No synthetic rows available to export.");
            return;
          }
          setBusy(true);
          try {
            const job = await mutateApi<{ job_id: string }>(
              "/exports",
              {
                dataset_id: filters.dataset,
                run_id: filters.run,
                kind,
                filters: {
                  from: filters.from,
                  to: filters.to,
                  scope: filters.scope,
                  detector: filters.detector,
                  direction: filters.direction,
                  review: filters.review,
                  min_peak_score: filters.min_score,
                  origin: filters.origin,
                  horizon: filters.horizon,
                  model: filters.model,
                },
              },
              "POST",
              crypto.randomUUID(),
            );
            update({ job: job.job_id });
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Download size={16} />
        {busy ? "Submitting…" : label}
      </button>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
    </div>
  );
}
export function SelectedJob() {
  const { params, mode } = useView();
  const id = params.get("job") ?? "";
  const query = useResource<Job>("job", !!id && mode === "api", id);
  const cache = useQueryClient();
  useEffect(() => {
    if (query.data?.data.status === "succeeded") {
      cache.invalidateQueries({
        predicate: (q) =>
          q.queryKey[0] === mode &&
          !["job", "jobs"].includes(String(q.queryKey[1])),
      });
    }
  }, [query.data?.data.status, id, mode, cache]);
  if (!id || mode === "demo") return null;
  return (
    <div className="selected-job" aria-live="polite">
      <QueryState query={query}>
        {query.data && (
          <JobCard job={query.data.data} onChanged={() => query.refetch()} />
        )}
      </QueryState>
    </div>
  );
}
