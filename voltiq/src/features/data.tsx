"use client";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  FileUp,
  Play,
  Upload as UploadIcon,
} from "lucide-react";
import { useResource, useSelection } from "@/lib/state";
import { mutateApi, uploadApi } from "@/lib/api/client";
import type { Upload, QualityReport, Job } from "@/lib/types";
import { number } from "@/lib/time";
import {
  PageTitle,
  Panel,
  QueryState,
  Empty,
  Metric,
  Notice,
  Badge,
  Modal,
} from "@/components/ui";
import { JobCard } from "@/components/jobs";
const stages = ["Select", "Map", "Preview", "Configure", "Process", "Analyze"];
export function DataPage() {
  const { mode, ready, dataset, datasets, filters, params, update, href } =
    useSelection();
  const [wizard, setWizard] = useState(params.get("upload") === "1");
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [upload, setUpload] = useState<Upload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [kind, setKind] = useState("generic");
  const [delimiter, setDelimiter] = useState(",");
  const [timestamp, setTimestamp] = useState("");
  const [format, setFormat] = useState("yyyy-MM-dd HH:mm:ss");
  const [power, setPower] = useState("");
  const [unit, setUnit] = useState("kW");
  const [optional, setOptional] = useState<Record<string, string>>({});
  const [mapping, setMapping] = useState<{
    preview?: Record<string, unknown>[];
    diagnostics?: string[];
    invalid_rows?: number;
  }>({});
  const [profile, setProfile] = useState("development");
  const [start, setStart] = useState("");
  const [jobId, setJobId] = useState("");
  const cache = useQueryClient();
  const quality = useResource<QualityReport>(
    "quality",
    ready && dataset?.status === "ready",
  );
  const jobs = useResource<Job[]>("jobs");
  const job = useResource<Job>("job", !!jobId && mode === "api", jobId);
  useEffect(() => {
    if (job.data?.data.status === "succeeded") {
      setStep(5);
      cache.invalidateQueries({
        predicate: (q) =>
          ["datasets", "dataset", "quality", "runs"].includes(
            String(q.queryKey[1]),
          ),
      });
    }
  }, [job.data?.data.status, cache]);
  async function perform(fn: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function selectFile(next: File | null) {
    setError("");
    if (!next) {
      setFile(null);
      return;
    }
    if (!/\.(csv|txt)$/i.test(next.name)) {
      setError(
        "Choose a plain CSV or TXT file. Archives are not raw readings.",
      );
      return;
    }
    if (next.size > 200 * 1024 * 1024) {
      setError("The maximum upload size is 200 MiB. Select a smaller file.");
      return;
    }
    setFile(next);
  }
  async function register() {
    if (!file) return;
    const result = await uploadApi(file);
    setUpload(result);
    setStep(1);
  }
  async function validate() {
    if (!upload) return;
    const native = kind === "uci_native";
    if (
      native &&
      !["Date", "Time", "Global_active_power"].every((c) =>
        upload.detected_columns.includes(c),
      )
    )
      throw new Error(
        "Native UCI data requires Date, Time and Global_active_power columns.",
      );
    if (!native && (!timestamp || !power || timestamp === power))
      throw new Error("Select separate timestamp and power columns.");
    const result = await mutateApi<typeof mapping>(
      `/datasets/${upload.id}/mapping`,
      native
        ? {
            profile: "uci_native",
            delimiter: ";",
            timestamp_format: "dd/MM/yyyy HH:mm:ss",
            timestamp_columns: ["Date", "Time"],
            active_power: { column: "Global_active_power", unit: "kW" },
          }
        : {
            profile: "generic_minute_power",
            delimiter,
            timestamp_format: format,
            timestamp_column: timestamp,
            active_power: { column: power, unit },
            optional_channels: Object.fromEntries(
              Object.entries(optional)
                .filter(([, col]) => col)
                .map(([channel, column]) => [
                  channel,
                  {
                    column,
                    unit: {
                      reactive_power: "kVAR",
                      voltage: "V",
                      current: "A",
                      sub1: "Wh",
                      sub2: "Wh",
                      sub3: "Wh",
                    }[channel],
                  },
                ]),
            ),
          },
      "PUT",
    );
    setMapping(result);
    setStep(2);
  }
  async function process() {
    if (!upload) return;
    const result = await mutateApi<{ job_id: string }>(
      `/datasets/${upload.id}/preprocess`,
      { profile, start_date: start || null },
      "POST",
      crypto.randomUUID(),
    );
    setJobId(result.job_id);
    setStep(4);
    update({
      dataset: upload.id,
      run: null,
      from: null,
      to: null,
      job: result.job_id,
      upload: null,
    });
  }
  async function analyze(evaluation_kind: string) {
    if (!dataset) return;
    const result = await mutateApi<{ job_id: string; run_id: string }>(
      "/runs",
      {
        dataset_id: dataset.id,
        dataset_version: dataset.version,
        model_id: "chronos_bolt_tiny",
        evaluation_kind,
        config: {
          context_bins: 192,
          horizons: [1, 4, 16],
          threshold_quantile: 0.99,
        },
      },
      "POST",
      crypto.randomUUID(),
    );
    update({ run: result.run_id, job: result.job_id });
  }
  const columns = upload?.detected_columns ?? [];
  const optionList = (
    <>
      <option value="">Choose column</option>
      {columns.map((col) => (
        <option key={col} value={col}>
          {col}
        </option>
      ))}
    </>
  );
  return (
    <>
      <PageTitle
        eyebrow="WORKSPACE / DATA"
        title="Good evidence starts here."
        description="Register readings, verify their interpretation and run a reproducible local pipeline."
        action={
          <button className="button primary" onClick={() => setWizard(true)}>
            <UploadIcon size={16} />
            Add dataset
          </button>
        }
      />
      {mode === "demo" && (
        <Notice>
          Demo mode uses a fixed synthetic fixture. Switch to local API mode to
          register or process your own file.
        </Notice>
      )}
      <Panel
        title="Dataset inventory"
        subtitle="Each ready version retains its source and configuration identity."
      >
        <QueryState query={datasets}>
          {datasets.data?.data.length ? (
            <div className="dataset-list">
              {datasets.data.data.map((ds) => (
                <button
                  className={`dataset-row ${dataset?.id === ds.id ? "selected" : ""}`}
                  key={ds.id}
                  onClick={() =>
                    update({
                      dataset: ds.id,
                      version: ds.version,
                      run: null,
                      from: null,
                      to: null,
                      origin: null,
                    })
                  }
                >
                  <span className="dataset-symbol">
                    <FileUp size={20} />
                  </span>
                  <div>
                    <strong>{ds.label}</strong>
                    <small>
                      {ds.from?.slice(0, 10) ?? "Not processed"} —{" "}
                      {ds.to?.slice(0, 10) ?? "Not processed"} · {ds.version}
                    </small>
                  </div>
                  <Badge tone={ds.status === "ready" ? "success" : "neutral"}>
                    {ds.status}
                  </Badge>
                  <Badge>{ds.source_kind}</Badge>
                  <ArrowRight size={17} />
                </button>
              ))}
            </div>
          ) : (
            <Empty title="No registered datasets yet">
              Import a downloaded UCI source file, use a maintainer-provided
              saved bundle, or upload compatible minute-resolution power data.
            </Empty>
          )}
        </QueryState>
      </Panel>
      {dataset?.status === "ready" && (
        <>
          <Panel
            title="Quality before conclusions"
            subtitle="Observed energy is retained separately from extrapolated estimates."
          >
            <QueryState query={quality}>
              {quality.data && (
                <>
                  <div className="metrics-grid">
                    <Metric
                      label="Selected source rows"
                      value={quality.data.data.selected_rows}
                      unit="rows"
                      detail="After timestamp parsing and deduplication"
                    />
                    <Metric
                      label="Complete intervals"
                      value={quality.data.data.complete_bins}
                      unit="bins"
                      detail="All 15 active-power readings present"
                    />
                    <Metric
                      label="Partial intervals"
                      value={quality.data.data.partial_bins}
                      unit="bins"
                      detail="Observed averages are not evaluation targets"
                    />
                    <Metric
                      label="Missing intervals"
                      value={quality.data.data.missing_bins}
                      unit="bins"
                      detail="Null observations, never zero consumption"
                    />
                  </div>
                  <dl className="facts inline-facts">
                    <div>
                      <dt>Invalid timestamps</dt>
                      <dd>{quality.data.data.invalid_timestamps ?? "Unavailable"}</dd>
                    </div>
                    <div>
                      <dt>Duplicate rows</dt>
                      <dd>{quality.data.data.duplicate_rows ?? "Unavailable"}</dd>
                    </div>
                    <div>
                      <dt>Observed coverage</dt>
                      <dd>{quality.data.data.coverage == null ? "Unavailable" : `${number(quality.data.data.coverage * 100)}%`}</dd>
                    </div>
                    <div>
                      <dt>Measured ETL runtime</dt>
                      <dd>
                        {quality.data.data.etl_seconds == null
                          ? "Not measured"
                          : `${number(quality.data.data.etl_seconds)} s`}
                      </dd>
                    </div>
                  </dl>
                  {quality.data.data.gaps.map((gap) => (
                    <Link
                      className="gap-row"
                      href={href("/consumption", {
                        from: gap.from,
                        to: gap.to,
                      })}
                      key={gap.from}
                    >
                      <Badge tone="amber">Gap</Badge>
                      <span>
                        {gap.from.replace("T", " ")} →{" "}
                        {gap.to.replace("T", " ")}
                      </span>
                      <small>{gap.reason}</small>
                      <ArrowRight size={14} />
                    </Link>
                  ))}
                </>
              )}
            </QueryState>
          </Panel>
          <Panel
            title="Choose the next analysis"
            subtitle="Actions depend on history, coverage, channels and cached model artifacts."
          >
            <div className="capability-grid">
              <div>
                <Wording
                  title="Explore observations"
                  enabled={dataset.capabilities.observations}
                  reason="A ready observed dataset is required."
                />
                <Link className="button" href={href("/consumption")}>
                  Open consumption
                  <ArrowRight size={15} />
                </Link>
              </div>
              <div>
                <Wording
                  title="Evaluate & calibrate"
                  enabled={dataset.capabilities.evaluation}
                  reason="Add sufficient chronological history for training-reference, validation and test targets."
                />
                <button
                  className="button primary"
                  disabled={
                    busy || mode === "demo" || !dataset.capabilities.evaluation
                  }
                  onClick={() => perform(() => analyze("held_out"))}
                >
                  <Play size={15} />
                  Queue required evaluation
                </button>
              </div>
              <div>
                <Wording
                  title="Forecast after endpoint"
                  enabled={dataset.capabilities.forecast}
                  reason="Requires 192 eligible context bins and a cached checkpoint."
                />
                <button
                  className="button"
                  disabled={
                    busy || mode === "demo" || !dataset.capabilities.forecast
                  }
                  onClick={() => perform(() => analyze("inference"))}
                >
                  Create inference run
                </button>
              </div>
            </div>
            {error && !wizard && <Notice>{error}</Notice>}
          </Panel>
        </>
      )}
      <Panel
        title="Persistent pipeline activity"
        subtitle="Worker-reported stages; no simulated progress or estimated completion time."
      >
        <QueryState query={jobs}>
          {jobs.data?.data.length ? (
            jobs.data.data.map((item) => (
              <JobCard
                key={item.id}
                job={item}
                onChanged={() => jobs.refetch()}
              />
            ))
          ) : (
            <p className="muted">
              No processing jobs yet. Submit a mapped upload to begin.
            </p>
          )}
        </QueryState>
      </Panel>
      <Modal
        open={wizard}
        onOpenChange={setWizard}
        title="Bring your readings"
        description="CSV / TXT · minute-resolution power · maximum 200 MiB"
      >
        <ol className="wizard-steps">
          {stages.map((name, i) => (
            <li
              key={name}
              className={step === i ? "current" : step > i ? "done" : ""}
            >
              <span>{step > i ? <Check size={13} /> : i + 1}</span>
              {name}
            </li>
          ))}
        </ol>
        {mode === "demo" ? (
          <>
            <Notice>
              Real file processing is unavailable in synthetic mode.
            </Notice>
            <Link className="button primary" href="/data?mode=api&upload=1">
              Connect local API
            </Link>
          </>
        ) : (
          <>
            {step === 0 && (
              <>
                <label className="upload-zone">
                  <FileUp size={30} />
                  <strong>
                    {file?.name ?? "Select a CSV or TXT source file"}
                  </strong>
                  <span>
                    {file
                      ? `${number(file.size / 1024 / 1024)} MiB`
                      : "UCI native or generic minute power"}
                  </span>
                  <input
                    type="file"
                    accept=".csv,.txt"
                    aria-label="Choose power data file"
                    onChange={(e) => selectFile(e.target.files?.[0] ?? null)}
                  />
                </label>
                <Notice>
                  Uploads remain local. Map units explicitly; energy-only kWh
                  files are not power readings.
                </Notice>
                <button
                  className="button primary"
                  disabled={!file || busy}
                  onClick={() => perform(register)}
                >
                  {busy ? "Registering…" : "Register upload"}
                  <ArrowRight size={16} />
                </button>
              </>
            )}
            {step === 1 && (
              <>
                <label className="field">
                  Source profile
                  <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value)}
                  >
                    <option value="generic">Generic minute power</option>
                    <option value="uci_native">Native UCI source</option>
                  </select>
                </label>
                {kind === "generic" ? (
                  <div className="mapping-grid">
                    <label className="field">
                      Timestamp column
                      <select
                        value={timestamp}
                        onChange={(e) => setTimestamp(e.target.value)}
                      >
                        {optionList}
                      </select>
                    </label>
                    <label className="field">
                      Timestamp format
                      <input
                        value={format}
                        onChange={(e) => setFormat(e.target.value)}
                      />
                    </label>
                    <label className="field">
                      Active power column
                      <select
                        value={power}
                        onChange={(e) => setPower(e.target.value)}
                      >
                        {optionList}
                      </select>
                    </label>
                    <label className="field">
                      Power unit
                      <select
                        value={unit}
                        onChange={(e) => setUnit(e.target.value)}
                      >
                        <option value="kW">kW</option>
                        <option value="W">W → convert once to kW</option>
                      </select>
                    </label>
                    <label className="field">
                      Delimiter
                      <select
                        value={delimiter}
                        onChange={(e) => setDelimiter(e.target.value)}
                      >
                        <option value=",">Comma</option>
                        <option value=";">Semicolon</option>
                      </select>
                    </label>
                  </div>
                ) : (
                  <Notice>
                    Native UCI uses Date + Time, semicolon delimiters and
                    original channel units.
                  </Notice>
                )}
                {kind === "generic" && (
                  <details>
                    <summary>Optional measured channels</summary>
                    <div className="mapping-grid">
                      {[
                        "reactive_power",
                        "voltage",
                        "current",
                        "sub1",
                        "sub2",
                        "sub3",
                      ].map((name) => (
                        <label className="field" key={name}>
                          {name.replaceAll("_", " ")} ·{" "}
                          {
                            {
                              reactive_power: "kVAR",
                              voltage: "V",
                              current: "A",
                              sub1: "Wh per minute",
                              sub2: "Wh per minute",
                              sub3: "Wh per minute",
                            }[name]
                          }
                          <select
                            value={optional[name] ?? ""}
                            onChange={(e) =>
                              setOptional({
                                ...optional,
                                [name]: e.target.value,
                              })
                            }
                          >
                            {optionList}
                          </select>
                        </label>
                      ))}
                    </div>
                  </details>
                )}
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => perform(validate)}
                >
                  {busy ? "Validating…" : "Validate mapping"}
                  <ArrowRight size={16} />
                </button>
              </>
            )}
            {step === 2 && (
              <>
                <p>Review the parsed interpretation before selecting rows.</p>
                {mapping.diagnostics?.map((text) => (
                  <Notice key={text}>{text}</Notice>
                ))}
                {mapping.invalid_rows != null && (
                  <Badge tone="amber">
                    {mapping.invalid_rows} invalid rows
                  </Badge>
                )}
                <RawPreview rows={mapping.preview ?? upload?.preview ?? []} />
                {!mapping.preview && (
                  <Notice>
                    The server did not return a parsed preview. Rows shown are
                    raw upload values. Confirm the backend mapping response
                    before processing.
                  </Notice>
                )}
                <div className="panel-actions">
                  <button className="button" onClick={() => setStep(1)}>
                    Edit mapping
                  </button>
                  <button
                    className="button primary"
                    disabled={!mapping.preview}
                    onClick={() => setStep(3)}
                  >
                    Confirm interpretation
                    <ArrowRight size={16} />
                  </button>
                </div>
              </>
            )}
            {step === 3 && (
              <>
                <label className="field">
                  Chronological row selection
                  <select
                    value={profile}
                    onChange={(e) => setProfile(e.target.value)}
                  >
                    <option value="development">
                      Development · 100,000 rows
                    </option>
                    <option value="final">Final · 250,000 rows</option>
                    <option value="full">Full source</option>
                  </select>
                </label>
                <label className="field">
                  Optional source start date
                  <input
                    type="date"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                  />
                </label>
                <Notice>
                  Selection happens after timestamp parsing and deterministic
                  deduplication. Missing readings remain in the timeline.
                </Notice>
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => perform(process)}
                >
                  {busy ? "Submitting…" : "Start PySpark processing"}
                  <Play size={15} />
                </button>
              </>
            )}
            {step === 4 && (
              <QueryState query={job}>
                {job.data && (
                  <JobCard
                    job={job.data.data}
                    onChanged={() => job.refetch()}
                  />
                )}
              </QueryState>
            )}
            {step === 5 && (
              <>
                <Badge tone="success">Processing completed</Badge>
                <p>
                  Inspect the published quality report, then select a supported
                  evaluation or inference action.
                </p>
                <button
                  className="button primary"
                  onClick={() => setWizard(false)}
                >
                  Review dataset quality
                  <ArrowRight size={16} />
                </button>
              </>
            )}
            {error && <Notice>{error}</Notice>}
          </>
        )}
      </Modal>
    </>
  );
}
function Wording({
  title,
  enabled,
  reason,
}: {
  title: string;
  enabled: boolean;
  reason: string;
}) {
  return (
    <>
      <h3>{title}</h3>
      <Badge tone={enabled ? "success" : "amber"}>
        {enabled ? "Available" : "Setup required"}
      </Badge>
      <p className="muted">
        {enabled ? "Enabled by this dataset’s recorded capabilities." : reason}
      </p>
    </>
  );
}
function RawPreview({ rows }: { rows: Record<string, unknown>[] }) {
  const cols = Object.keys(rows[0] ?? {});
  return (
    <div className="table-scroll raw-preview">
      <table>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 100).map((row, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c}>{String(row[c] ?? "Unavailable")}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
