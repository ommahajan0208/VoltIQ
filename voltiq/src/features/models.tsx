"use client";
import { useState } from "react";
import { useResource, useSelection } from "@/lib/state";
import { mutateApi } from "@/lib/api/client";
import type { Metrics } from "@/lib/types";
import { number } from "@/lib/time";
import { AnalysisGate } from "@/components/analysis-gate";
import {
  PageTitle,
  Panel,
  QueryState,
  Notice,
  Badge,
  Empty,
} from "@/components/ui";
export function ModelsPage() {
  const { ready, run, runs, dataset, mode, filters, update, href } =
    useSelection();
  const metrics = useResource<Metrics[]>("metrics", ready && !!run);
  const [quantile, setQuantile] = useState(0.99);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function queue(path: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      const result = await mutateApi<{ job_id: string; run_id?: string }>(
        path,
        body,
        "POST",
        crypto.randomUUID(),
      );
      update({
        job: result.job_id,
        ...(result.run_id ? { run: result.run_id } : {}),
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="WORKSPACE / MODELS"
        title="Know what produced the result."
        description="Checkpoint identity, chronological evaluation and saved calibration — all in view."
      />
      <AnalysisGate>
        <div className="two-columns">
          <Panel
            title="Immutable run configuration"
            subtitle="A changed threshold or model configuration creates a new run."
          >
            <dl className="facts">
              <div>
                <dt>Run</dt>
                <dd>
                  <code>{run?.id}</code>
                </dd>
              </div>
              <div>
                <dt>Dataset version</dt>
                <dd>
                  <code>{run?.dataset_version}</code>
                </dd>
              </div>
              <div>
                <dt>Engine</dt>
                <dd>{run?.model_id}</dd>
              </div>
              <div>
                <dt>Checkpoint revision</dt>
                <dd>{run?.model_revision}</dd>
              </div>
              <div>
                <dt>Evaluation kind</dt>
                <dd>{run?.evaluation_kind.replaceAll("_", " ")}</dd>
              </div>
              <div>
                <dt>Source hash</dt>
                <dd>
                  <code>{run?.source_hash}</code>
                </dd>
              </div>
              <div>
                <dt>Config hash</dt>
                <dd>
                  <code>{run?.config_hash}</code>
                </dd>
              </div>
              <div>
                <dt>Test interval · source time</dt>
                <dd>
                  {run?.test_from.replace("T", " ")} →{" "}
                  {run?.test_to.replace("T", " ")}
                </dd>
              </div>
              <div>
                <dt>Residual threshold</dt>
                <dd>{number(run?.threshold)} kW</dd>
              </div>
            </dl>
          </Panel>
          <Panel
            title="Saved runs"
            subtitle="Select a completed result from the same registered dataset."
          >
            <QueryState query={runs}>
              <div className="saved-runs">
                {runs.data?.data.map((item) => (
                  <button
                    key={item.id}
                    className={`run-row ${item.id === run?.id ? "selected" : ""}`}
                    disabled={
                      item.status !== "succeeded" ||
                      item.dataset_version !== dataset?.version
                    }
                    onClick={() =>
                      update({
                        run: item.id,
                        from: null,
                        to: null,
                        origin: null,
                      })
                    }
                  >
                    <div>
                      <strong>{item.id}</strong>
                      <span>
                        {item.model_id} · {item.evaluation_kind}
                      </span>
                    </div>
                    <Badge
                      tone={item.status === "succeeded" ? "success" : "neutral"}
                    >
                      {item.status}
                    </Badge>
                  </button>
                ))}
              </div>
            </QueryState>
            <Notice>
              Ranked comparisons require the same dataset version, horizon and
              matched target set. A different configuration alone cannot
              establish a better model.
            </Notice>
          </Panel>
        </div>
        <Panel
          title="Forecast evaluation by horizon"
          subtitle="Held-out targets only; excluded observations remain in the recorded denominators."
        >
          <QueryState query={metrics}>
            {metrics.data?.data.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th>Horizon</th>
                      <th>MAE · kW</th>
                      <th>RMSE · kW</th>
                      <th>MASE</th>
                      <th>q10–q90 coverage</th>
                      <th>Targets</th>
                      <th>Skipped</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.data.data.map((m, index) => (
                      <tr
                        key={`${m.model_id}-${m.horizon}-${m.split ?? `row-${index}`}`}
                      >
                        <td>{m.model_id}</td>
                        <td>{m.horizon * 15} min</td>
                        <td>{number(m.mae_kw)}</td>
                        <td>{number(m.rmse_kw)}</td>
                        <td>{number(m.mase)}</td>
                        <td>
                          {m.coverage_q10_q90 == null
                            ? "Unavailable"
                            : number(m.coverage_q10_q90 * 100) + "%"}
                        </td>
                        <td>{m.count}</td>
                        <td>{m.skipped}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="No measured evaluation metrics available">
                Synthetic demonstration and inference-only runs do not report
                held-out accuracy. Run the required evaluation on real
                observations to populate this table.
              </Empty>
            )}
          </QueryState>
        </Panel>
        <Panel
          title="Pretrained inference"
          subtitle="Frozen checkpoint — no local training curve."
        >
          <p className="muted">
            The required Chronos-Bolt Tiny adapter uses a cached checkpoint.
            Persistence and seasonal naive baselines are evaluated on matched
            eligible targets. Training curves appear only for experiments that
            actually train a model.
          </p>
          <div className="method-badges">
            <Badge>192-bin causal context</Badge>
            <Badge>15 min / 1 h / 4 h horizons</Badge>
            <Badge>Training-only historical references</Badge>
            <Badge>Validation-only saved threshold</Badge>
          </div>
        </Panel>
        <div className="two-columns">
          <Panel
            title="Exploratory threshold preview"
            subtitle="Changes are derived from validation scores; the saved run stays immutable."
          >
            <Badge tone="amber">Exploratory preview</Badge>
            <label className="field">
              Validation quantile · {quantile.toFixed(3)}
              <input
                type="range"
                min={0.95}
                max={0.999}
                step={0.001}
                value={quantile}
                onChange={(e) => setQuantile(Number(e.target.value))}
              />
            </label>
            <p className="small muted">
              After viewing test outputs, further tuning must be recorded as
              exploratory. Candidate counts are returned by the worker; the
              browser does not derive a threshold.
            </p>
            <div className="inline-controls">
              <button
                className="button primary"
                disabled={busy || mode === "demo" || !run}
                onClick={() =>
                  queue(`/runs/${filters.run}/threshold-previews`, {
                    validation_quantile: quantile,
                    exploratory: true,
                  })
                }
              >
                Queue preview
              </button>
              <button className="button" onClick={() => setQuantile(0.99)}>
                Reset preview
              </button>
            </div>
            {mode === "demo" && (
              <p className="small muted">
                Unavailable: no actual validation scores exist in this visual
                fixture.
              </p>
            )}
          </Panel>
          <Panel
            title="Optional experiments"
            subtitle="Separate results; reconstruction support never inflates primary interval KPIs."
          >
            <h3>Four-channel autoencoder</h3>
            <p className="muted">
              Requires complete two-hour windows and enough training /
              validation examples. Reconstruction describes window support, not
              device attribution.
            </p>
            <p className="small muted">
              Unavailable in this backend: the experiment endpoint currently
              rejects submissions. Dataset eligibility alone does not enable it.
            </p>
          </Panel>
        </div>
        <Panel
          title="Import a Colab result bundle"
          subtitle="Imported hashes and schema must match this registered dataset version."
        >
          <p className="small muted">
            Unavailable in this backend: bundle import currently rejects
            submissions. No archive is accepted or published.
          </p>
        </Panel>
        {error && <Notice>{error}</Notice>}
      </AnalysisGate>
    </>
  );
}
