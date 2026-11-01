"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Database,
  FileText,
  Gauge,
  Lightbulb,
  TrendingUp,
  Menu,
  Moon,
  Settings2,
  Sun,
  Waves,
} from "lucide-react";
import { useSelection } from "@/lib/state";
import { exclusiveEndToInclusive, inclusiveEndToExclusive } from "@/lib/time";
import { usePreferences } from "./providers";
import { Badge, Modal, Notice } from "./ui";
import { JobsIndicator, SelectedJob } from "./jobs";
const navigation = [
  {
    title: "Analysis",
    items: [
      ["/overview", "Overview", Gauge],
      ["/consumption", "Consumption", BarChart3],
      ["/forecasting", "Forecasting", Waves],
      ["/anomalies", "Anomalies", Activity],
      ["/peak-load", "Peak load", TrendingUp],
    ],
  },
  {
    title: "Workspace",
    items: [
      ["/data", "Data & pipeline", Database],
      ["/models", "Models & evaluation", Settings2],
      ["/reports", "Reports", FileText],
      ["/recommendations", "Recommendations", Lightbulb],
    ],
  },
] as const;
export function Brand() {
  return (
    <Link href="/" className="brand">
      <span className="brand-symbol">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M2 12h6l3-5 3 10 3-5h2m2 0h1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span>
        VoltIQ
      </span>
    </Link>
  );
}
export function Shell({ children }: { children: ReactNode }) {
  const {
    dataset,
    run,
    datasets,
    runs,
    filters,
    mode,
    update,
    href,
    pathname,
  } = useSelection();
  const [drawer, setDrawer] = useState(false);
  const { reduce, light, toggleMotion, toggleTheme } = usePreferences();
  const [rangeError, setRangeError] = useState("");
  const [selectionNotice, setSelectionNotice] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  useEffect(() => {
    setStart(filters.from.slice(0, 10));
    setEnd(filters.to ? exclusiveEndToInclusive(filters.to) : "");
  }, [filters.from, filters.to]);
  useEffect(() => {
    setDrawer(false);
    setSelectionNotice("");
    setRangeError("");
  }, [pathname]);
  const nav = (
    <>
      <Brand />
      <nav aria-label="Primary navigation">
        {navigation.map((group) => (
          <div className="nav-group" key={group.title}>
            <span>{group.title}</span>
            {group.items.map(([url, label, Icon]) => (
              <Link
                key={url}
                href={href(url)}
                aria-label={label}
                title={label}
                className={
                  pathname === url || pathname.startsWith(url + "/")
                    ? "active"
                    : ""
                }
                aria-current={pathname === url ? "page" : undefined}
              >
                <Icon size={18} />
                <span>{label}</span>
              </Link>
            ))}
          </div>
        ))}
      </nav>
      <div className="sidebar-footer">
        <div className="workspace-label">
          <span className="status-dot" />
          Local workspace
        </div>
        <p>{dataset?.label ?? "No dataset selected"}</p>
        <small>
          Source household time
          <br />
          15-minute intervals
        </small>
        <Link href="/">
          About the project
          <ArrowUpRight size={13} />
        </Link>
      </div>
    </>
  );
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar">{nav}</aside>
      <Modal
        open={drawer}
        onOpenChange={setDrawer}
        title="Workspace navigation"
        description="Analysis and data tools"
      >
        <div className="mobile-nav">{nav}</div>
      </Modal>
      <div className="workspace">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Open navigation"
            onClick={() => setDrawer(true)}
          >
            <Menu size={21} />
          </button>
          <button
            className="icon-button tablet-menu"
            aria-label="Expand navigation"
            onClick={() => setDrawer(true)}
          >
            <Menu size={21} />
          </button>
          <div className="context-selectors">
            <label>
              <span>Dataset</span>
              <select
                value={dataset?.id ?? ""}
                onChange={(e) => {
                  const ds = datasets.data?.data.find(
                    (d) => d.id === e.target.value,
                  );
                  setSelectionNotice(
                    "Dataset changed. Run, dates and report selection were reset; a compatible saved run may be selected automatically.",
                  );
                  update({
                    dataset: e.target.value,
                    version: ds?.version ?? null,
                    run: null,
                    from: null,
                    to: null,
                    origin: null,
                    job: null,
                    report: null,
                    cursor: null,
                  });
                }}
              >
                <option value="">
                  {datasets.isError ? "API unavailable" : "Select dataset"}
                </option>
                {datasets.data?.data.map((ds) => (
                  <option value={ds.id} key={ds.id}>
                    {ds.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Run</span>
              <select
                value={run?.id ?? ""}
                disabled={!dataset}
                onChange={(e) =>
                  update({
                    run: e.target.value,
                    from: null,
                    to: null,
                    origin: null,
                    cursor: null,
                  })
                }
              >
                <option value="">
                  {runs.data?.data.length === 0 ? "No saved run" : "Select run"}
                </option>
                {runs.data?.data.map((r) => (
                  <option
                    key={r.id}
                    value={r.id}
                    disabled={r.status !== "succeeded"}
                  >
                    {r.id} · {r.status}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="toolbar-actions">
            <JobsIndicator />
            <button
              className="icon-button"
              onClick={toggleMotion}
              aria-label={reduce ? "Enable animation" : "Reduce animation"}
              title={reduce ? "Motion reduced" : "Motion enabled"}
            >
              <Waves size={17} />
            </button>
            <button
              className="icon-button"
              onClick={toggleTheme}
              aria-label={light ? "Use dark theme" : "Use light theme"}
            >
              {light ? <Moon size={17} /> : <Sun size={17} />}
            </button>
          </div>
          {!["/data", "/models"].includes(pathname) &&
            dataset?.status === "ready" && (
              <div className="range-toolbar">
                <div>
                  <span className="source-label">Source household time</span>
                  <span className="mono">{run?.id ?? dataset.id}</span>
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    setRangeError("");
                    const from = start + "T00:00:00";
                    const to = inclusiveEndToExclusive(end);
                    if (from >= to) {
                      setRangeError(
                        "The end date must be on or after the start date.",
                      );
                      return;
                    }
                    if (
                      from < dataset.from.slice(0, 10) + "T00:00:00" ||
                      to >
                        inclusiveEndToExclusive(
                          exclusiveEndToInclusive(dataset.to),
                        )
                    ) {
                      setRangeError(
                        "Choose dates inside the dataset coverage.",
                      );
                      return;
                    }
                    update({ from, to, cursor: null });
                  }}
                >
                  <label className="sr-only" htmlFor="range-from">
                    Start date inclusive
                  </label>
                  <input
                    id="range-from"
                    type="date"
                    min={dataset?.from.slice(0, 10)}
                    max={dataset?.to.slice(0, 10)}
                    value={start}
                    required
                    onChange={(e) => setStart(e.target.value)}
                  />
                  <span>to</span>
                  <label className="sr-only" htmlFor="range-to">
                    End date inclusive
                  </label>
                  <input
                    id="range-to"
                    type="date"
                    min={dataset?.from.slice(0, 10)}
                    max={dataset ? exclusiveEndToInclusive(dataset.to) : undefined}
                    value={end}
                    required
                    onChange={(e) => setEnd(e.target.value)}
                  />
                  <button className="button compact">Apply</button>
                  <label className="sr-only" htmlFor="scope">
                    Time scope
                  </label>
                  <select
                    id="scope"
                    value={filters.scope}
                    onChange={(e) =>
                      update({ scope: e.target.value, cursor: null })
                    }
                  >
                    <option value="all">All day</option>
                    <option value="overnight">Overnight · 00–05</option>
                  </select>
                </form>
              </div>
            )}
        </header>
        <div
          className={`mode-banner ${mode === "demo" ? "synthetic" : "api-mode"}`}
        >
          <div>
            <span className="status-dot" />
            <strong>
              {mode === "demo" ? "Synthetic demonstration" : "Local API mode"}
            </strong>
            <span>
              {mode === "demo"
                ? "Illustrative readings and forecasts. No scientific evaluation."
                : "Results are read from your local backend."}
            </span>
          </div>
          <Link href={`${pathname}?mode=${mode === "demo" ? "api" : "demo"}`}>
            {mode === "demo" ? "Connect local API" : "Open synthetic demo"}
            <ArrowUpRight size={13} />
          </Link>
        </div>
        <main id="main-content" className="main-content">
          {selectionNotice && <Notice>{selectionNotice}</Notice>}
          {rangeError && <Notice>{rangeError}</Notice>}
          <SelectedJob />
          {children}
        </main>
        <footer className="app-footer">
          <span>VoltIQ · local-first energy analysis</span>
          <span>Candidate events require human review</span>
        </footer>
      </div>
    </div>
  );
}
