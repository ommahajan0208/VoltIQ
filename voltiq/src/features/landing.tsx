"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Database,
  Pause,
  Play,
  ScanLine,
  ShieldCheck,
  Waves,
  Zap,
} from "lucide-react";
import { Brand } from "@/components/shell";
import { Badge, Modal, QueryState } from "@/components/ui";
import { usePreferences } from "@/components/providers";
import { useResource, useView } from "@/lib/state";
import { demoFixture } from "@/lib/demo";
import { addSourceMinutes, number, sourceLabel } from "@/lib/time";
import type { Bin, Dataset, Envelope, Run } from "@/lib/types";

type NightSample = { bins: Bin[]; dataset: Dataset; run: Run };
const methodSteps = [
  { icon: Database, title: "Validate readings", body: "Map units, preserve missing observations and inspect quality before analysis." },
  { icon: Zap, title: "Build the timeline", body: "PySpark aggregates minute readings into traceable 15-minute intervals." },
  { icon: Waves, title: "Forecast expected usage", body: "Compare pretrained forecasts with persistence and seasonal baselines." },
  { icon: ScanLine, title: "Inspect deviations", body: "Review candidate intervals with dated evidence. An unusual reading is a question, not a confirmed fault." },
];

async function localData<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal });
  if (!response.ok) throw new Error("Local analysis is unavailable");
  return ((await response.json()) as Envelope<T>).data;
}

async function savedNight(signal: AbortSignal): Promise<NightSample | null> {
  const datasets = await localData<Dataset[]>("/api/v1/datasets", signal);
  for (const dataset of datasets.filter((item) => item.status === "ready")) {
    try {
      const runs = await localData<Run[]>(
      `/api/v1/runs?dataset=${encodeURIComponent(dataset.id)}`,
      signal,
      );
      const run = runs.find((item) => item.status === "succeeded" && item.evaluation_kind === "held_out")
      ?? runs.find((item) => item.status === "succeeded");
      if (!run) continue;
      let start = `${run.test_from.slice(0, 10)}T00:00:00`;
      if (start < run.test_from) start = addSourceMinutes(start, 1440);
      const fullNight = addSourceMinutes(start, 300) <= run.test_to;
      if (!fullNight) start = run.test_from;
      const end = addSourceMinutes(start, 300) < run.test_to
      ? addSourceMinutes(start, 300) : run.test_to;
      const query = new URLSearchParams({
      from: start, to: end, dataset_version: dataset.version,
      channel: "active_power_kw", max_buckets: "20",
      });
      const bins = await localData<Bin[]>(
      `/api/v1/datasets/${encodeURIComponent(dataset.id)}/series?${query}`,
      signal,
      );
      if (bins.length) return { bins: bins.slice(0, 20), dataset, run };
    } catch (error) {
      if (signal.aborted) throw error;
    }
  }
  return null;
}

function observedTrace(bins: Bin[]): string {
  const maximum = Math.max(0.1, ...bins.map((bin) => bin.active_power_kw ?? 0));
  return bins.map((bin, index) => {
    if (bin.active_power_kw == null) return "";
    const previous = bins[index - 1]?.active_power_kw;
    const x = (index / Math.max(1, bins.length - 1)) * 500;
    const y = 90 - Math.max(0, bin.active_power_kw) / maximum * 80;
    return `${index && previous != null ? "L" : "M"}${x} ${y}`;
  }).join(" ");
}
function EnergyArtwork({ reduce }: { reduce: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let inView = false;
    const update = () => setVisible(inView && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      update();
    }, { threshold: 0.1 });
    observer.observe(element);
    document.addEventListener("visibilitychange", update);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return (
    <div ref={host} className={`energy-art ${visible && !reduce ? "is-playing" : ""}`}>
      <div className="art-grid" />
      <div className="art-caption">
        <span className="status-dot" />
        HOUSEHOLD ENERGY SIGNATURE<Badge>Illustrative animation</Badge>
      </div>
      <svg
        viewBox="0 0 680 380"
        role="img"
        aria-label="Illustrative energy waveform with an amber candidate interval and a lavender forecast continuation"
      >
        <defs>
          <linearGradient id="traceFill" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#45DFF5" stopOpacity=".16" />
            <stop offset="1" stopColor="#45DFF5" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="lineGlow">
            <stop stopColor="#45DFF5" stopOpacity=".2" />
            <stop offset=".5" stopColor="#45DFF5" />
            <stop offset="1" stopColor="#45DFF5" />
          </linearGradient>
          <clipPath id="hero-trace-sweep">
            <rect className="hero-sweep-window" x="-150" y="0" width="150" height="380" />
          </clipPath>
        </defs>
        <path
          d="M20 278 L48 278 L68 259 L84 270 L100 263 L116 272 L135 183 L148 214 L164 252 L190 262 L211 255 L231 267 L251 260 L276 95 L297 115 L318 98 L339 106 L361 238 L380 257 L400 263 L418 251 L439 261 L455 255 L472 237 L493 258 L520 250 L545 257 L545 330 L20 330 Z"
          fill="url(#traceFill)"
        />
        <rect
          x="266"
          y="55"
          width="92"
          height="280"
          fill="#F4BB62"
          opacity=".06"
        />
        <path
          d="M20 278 L48 278 L68 259 L84 270 L100 263 L116 272 L135 183 L148 214 L164 252 L190 262 L211 255 L231 267 L251 260 L276 95 L297 115 L318 98 L339 106 L361 238 L380 257 L400 263 L418 251 L439 261 L455 255 L472 237 L493 258 L520 250 L545 257"
          fill="none"
          stroke="url(#lineGlow)"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <path
          className="hero-trace-highlight"
          d="M20 278 L48 278 L68 259 L84 270 L100 263 L116 272 L135 183 L148 214 L164 252 L190 262 L211 255 L231 267 L251 260 L276 95 L297 115 L318 98 L339 106 L361 238 L380 257 L400 263 L418 251 L439 261 L455 255 L472 237 L493 258 L520 250 L545 257"
          fill="none"
          stroke="#B7F8FF"
          strokeWidth="5"
          strokeLinejoin="round"
          strokeLinecap="round"
          clipPath="url(#hero-trace-sweep)"
        />
        <path
          d="M545 257 L563 252 L585 263 L607 246 L633 257 L660 253"
          fill="none"
          stroke="#A6A4FF"
          strokeWidth="2"
          strokeDasharray="5 6"
        />
        <path
          d="M545 242 L660 235 L660 275 L545 272 Z"
          fill="#A6A4FF"
          opacity=".1"
        />
        <circle cx="297" cy="115" r="5" fill="#F4BB62" />
        <line
          x1="297"
          y1="61"
          x2="297"
          y2="101"
          stroke="#F4BB62"
          opacity=".5"
        />
        <text x="240" y="43" fill="#F4BB62" fontSize="12" fontFamily="Inter">
          Candidate interval
        </text>
        <text x="10" y="360" fill="#A0B2C6" fontSize="12">
          00:00
        </text>
        <text x="245" y="360" fill="#A0B2C6" fontSize="12">
          02:00
        </text>
        <text x="530" y="360" fill="#A0B2C6" fontSize="12">
          04:00
        </text>
        <text x="595" y="215" fill="#A6A4FF" fontSize="11">
          Forecast
        </text>
      </svg>
      <div className="art-legend">
        <span>
          <i className="dot cyan-dot" />
          Observed power
        </span>
        <span>
          <i className="dot forecast-dot" />
          Forecast range
        </span>
        <span>
          <i className="dot amber-dot" />
          Candidate
        </span>
      </div>
    </div>
  );
}
export function Landing() {
  const { mode } = useView();
  const [picker, setPicker] = useState(false);
  const [selected, setSelected] = useState("");
  const datasets = useResource<Dataset[]>("datasets", picker);
  const runs = useResource<Run[]>("runs", picker && !!selected, undefined, {
    dataset: selected,
  });
  const [bins, setBins] = useState<Bin[]>([]);
  const [savedSample, setSavedSample] = useState<NightSample | null>(null);
  const [cursor, setCursor] = useState(0);
  const [play, setPlay] = useState(false);
  const [speed, setSpeed] = useState(1);
  const { reduce } = usePreferences();
  const methodRef = useRef<HTMLElement>(null);
  const [activeMethod, setActiveMethod] = useState(0);
  const [revealedMethods, setRevealedMethods] = useState<number[]>([]);
  useEffect(() => {
    const section = methodRef.current;
    if (!section) return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const index = Number((entry.target as HTMLElement).dataset.step);
        setActiveMethod(index);
        setRevealedMethods((previous) => previous.includes(index) ? previous : [...previous, index]);
      }
    }, { rootMargin: "-40% 0px -40% 0px" });
    section.querySelectorAll<HTMLElement>("[data-step]").forEach((step) => observer.observe(step));
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setPlay(false);
    setCursor(0);
    setSavedSample(null);
    if (mode === "demo") {
      demoFixture().then((f) => {
        if (!controller.signal.aborted) setBins(f.bins.slice(0, 20));
      });
    } else {
      savedNight(controller.signal).then((sample) => {
        if (controller.signal.aborted) return;
        if (sample) {
          setSavedSample(sample);
          setBins(sample.bins);
        } else {
          demoFixture().then((f) => {
            if (!controller.signal.aborted) setBins(f.bins.slice(0, 20));
          });
        }
      }).catch(() => {
        if (!controller.signal.aborted) demoFixture().then((f) => {
          if (!controller.signal.aborted) setBins(f.bins.slice(0, 20));
        });
      });
    }
    return () => controller.abort();
  }, [mode]);
  useEffect(() => {
    if (reduce) setPlay(false);
  }, [reduce]);
  useEffect(() => {
    const pauseWhenHidden = () => {
      if (document.hidden) setPlay(false);
    };
    document.addEventListener("visibilitychange", pauseWhenHidden);
    return () => document.removeEventListener("visibilitychange", pauseWhenHidden);
  }, []);
  useEffect(() => {
    if (!play) return;
    let frame = 0;
    let previous = performance.now();
    let elapsed = 0;
    const advance = (now: number) => {
      if (document.hidden) return;
      elapsed += (now - previous) * speed;
      previous = now;
      const steps = Math.floor(elapsed / 1000);
      if (steps) {
        elapsed -= steps * 1000;
        setCursor((value) => (value + steps) % Math.max(1, bins.length));
      }
      frame = requestAnimationFrame(advance);
    };
    frame = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(frame);
  }, [play, speed, bins.length]);
  const point = bins[cursor];
  const sampleHref = savedSample
    ? `/overview?${new URLSearchParams({mode: "api", dataset: savedSample.dataset.id,
      version: savedSample.dataset.version, run: savedSample.run.id,
      model: savedSample.run.model_id, from: bins[0]?.bin_start ?? savedSample.run.test_from,
      to: bins.at(-1)?.bin_end ?? savedSample.run.test_to})}`
    : "/overview?mode=demo";
  return (
    <div className="landing">
      <header className="landing-header">
        <Brand />
        <nav aria-label="Landing navigation">
          <a href="#method">Method</a>
          <a href="#preview">Preview</a>
          <Link className="button compact" href="/data">
            Open workspace
            <ArrowUpRight size={15} />
          </Link>
        </nav>
      </header>
      <main>
        <section className="hero">
          <motion.div
            className="hero-copy"
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <span className="eyebrow hero-eyebrow">
              <span className="status-dot" />
              MAKE EVERY INTERVAL VISIBLE
            </span>
            <h1>
              See what your
              <br />electricity patterns
              <br />
              <span>reveal.</span>
            </h1>
            <p>
              Explore the patterns behind household consumption. Forecast what
              comes next, and inspect the intervals that deserve a closer look.
            </p>
            <div className="hero-actions">
              <button
                className="button primary"
                onClick={() => setPicker(true)}
              >
                Explore saved analysis
                <ArrowRight size={17} />
              </button>
              <Link className="button" href="/data?upload=1">
                Analyze your data
                <ArrowUpRight size={17} />
              </Link>
            </div>
            <div className="hero-footnote">
              <ShieldCheck size={15} />
              Local-first · no account needed · your data stays local
            </div>
          </motion.div>
          <EnergyArtwork reduce={reduce} />
        </section>
        <div className="method-chips">
          <span>
            <Database size={17} />
            PySpark processing
          </span>
          <span>
            <Waves size={17} />
            Pretrained forecasting
          </span>
          <span>
            <ScanLine size={17} />
            Evidence-led review
          </span>
        </div>
        <section className="night-preview" id="preview">
          <div>
            <span className="eyebrow">A CLOSER LOOK</span>
            <h2>
              The quiet hours
              <br />
              aren’t always quiet.
            </h2>
            <p>
              {savedSample
                ? "Scrub through saved observations from a completed local run. Open the analysis for dated quality and event evidence."
                : "Scrub through an illustrative night. In your workspace, the same view links to dated observations, quality and event evidence."}
            </p>
            <Badge tone={savedSample ? "cyan" : "amber"}>
              {savedSample
                ? `Saved analysis · ${savedSample.dataset.label} · ${savedSample.run.id}`
                : "Synthetic demonstration · not UCI readings"}
            </Badge>
          </div>
          <div className="night-player">
            <div className="night-header">
              <span>Historical-night preview</span>
              <span>
                {point ? sourceLabel(point.bin_start) : "Loading illustration"}
              </span>
            </div>
            <div className="night-value">
              {number(point?.active_power_kw)}
              <small>kW observed</small>
            </div>
            <svg viewBox="0 0 500 95" aria-hidden="true">
              <path
                d={observedTrace(bins)}
                fill="none"
                stroke="#45DFF5"
                strokeWidth="2"
              />
              <line
                x1={(cursor / Math.max(1, bins.length - 1)) * 500}
                x2={(cursor / Math.max(1, bins.length - 1)) * 500}
                y1="0"
                y2="95"
                stroke="#EDF5FC"
                opacity=".5"
              />
            </svg>
            <div className="player-controls">
              <button
                className="icon-button"
                aria-label={play ? "Pause replay" : "Play replay"}
                onClick={() => setPlay(!play)}
              >
                {play ? <Pause size={18} /> : <Play size={18} />}
              </button>
                <label className="sr-only" htmlFor="night-scrub">
                Scrub historical preview
              </label>
              <input
                id="night-scrub"
                type="range"
                min={0}
                max={Math.max(0, bins.length - 1)}
                value={cursor}
                onChange={(e) => {
                  setPlay(false);
                  setCursor(Number(e.target.value));
                }}
              />
              <label className="sr-only" htmlFor="replay-speed">
                Historical replay speed
              </label>
              <select
                id="replay-speed"
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
              >
                <option value={1}>1×</option>
                <option value={4}>4×</option>
                <option value={16}>16×</option>
              </select>
            </div>
            <Link href={sampleHref}>
              {savedSample ? "Open saved analysis" : "Open the interactive demonstration"}
              <ArrowRight size={14} />
            </Link>
          </div>
        </section>
        <section className="method-section" id="method" ref={methodRef}>
          <div className="section-intro">
            <span className="eyebrow">FROM READINGS TO REASONING</span>
            <h2>Four steps. A traceable result.</h2>
            <p>
              Each conclusion starts with observed data and keeps its limits
              visible.
            </p>
          </div>
          <div className="method-grid">
            <div className="method-visual" aria-hidden="true">
              <div className="method-visual-heading">
                <span>ANALYSIS SIGNAL</span>
                <strong>0{activeMethod + 1} / 04</strong>
              </div>
              <svg viewBox="0 0 440 260">
                <path className="method-gridline" d="M25 45H415 M25 100H415 M25 155H415 M25 210H415" />
                <path className="method-gridline" d="M70 25V235 M170 25V235 M270 25V235 M370 25V235" />
                <g className={activeMethod === 0 ? "signal-active" : ""}>
                  <circle cx="70" cy="178" r="5" /><circle cx="105" cy="135" r="5" />
                  <circle cx="140" cy="159" r="5" /><circle cx="175" cy="105" r="5" />
                  <circle cx="210" cy="145" r="5" />
                </g>
                <g className={activeMethod === 1 ? "signal-active" : ""}>
                  <rect x="65" y="155" width="30" height="55" rx="3" />
                  <rect x="110" y="133" width="30" height="77" rx="3" />
                  <rect x="155" y="112" width="30" height="98" rx="3" />
                  <rect x="200" y="146" width="30" height="64" rx="3" />
                </g>
                <path className={activeMethod === 2 ? "signal-active" : ""}
                  d="M242 153 C265 144 279 117 299 128 S332 176 349 146 S379 91 412 111" />
                <g className={`method-candidate ${activeMethod === 3 ? "signal-active" : ""}`}>
                  <rect x="345" y="36" width="48" height="174" rx="4" />
                  <path d="M369 91L378 100L369 109L360 100Z" />
                </g>
              </svg>
              <div className="method-visual-foot">
                <span>READINGS</span><span>INTERVALS</span><span>EXPECTED</span><span>REVIEW</span>
              </div>
            </div>
            <div className="method-steps">
            {methodSteps.map((step, i) => (
              <div key={step.title} data-step={i}
                className={`method-step ${activeMethod === i ? "is-active" : ""} ${revealedMethods.includes(i) && !reduce ? "is-revealed" : ""}`}>
                <span className="step-number">0{i + 1}</span>
                <step.icon size={22} />
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            ))}
            </div>
          </div>
        </section>
        <section className="landing-cta">
          <div>
            <h2>Start with your next question.</h2>
            <p>
              Use saved analysis or bring compatible minute-resolution power
              readings.
            </p>
          </div>
          <Link href="/data" className="button primary">
            Open workspace
            <ArrowRight size={17} />
          </Link>
        </section>
      </main>
      <footer className="landing-footer">
        <Brand />
        <p>
          Designed for the UCI Individual Household Electric Power Consumption
          dataset.
          <br />
          Source attribution: UCI Machine Learning Repository · CC BY 4.0.
          <br />
          Candidate events are not verified faults or measured savings.
        </p>
        <a
          href="https://archive.ics.uci.edu/dataset/235/individual+household+electric+power+consumption"
          target="_blank"
          rel="noreferrer"
        >
          Dataset source
          <ArrowUpRight size={14} />
        </a>
      </footer>
      <Modal
        open={picker}
        onOpenChange={setPicker}
        title="Explore saved analysis"
        description="Select a ready dataset and an immutable completed run."
      >
        <QueryState query={datasets}>
          {datasets.data?.data.length ? (
            <>
              <label className="field">
                Dataset
                <select
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  <option value="">Choose dataset</option>
                  {datasets.data.data.map((ds) => (
                    <option key={ds.id} value={ds.id}>
                      {ds.label}
                    </option>
                  ))}
                </select>
              </label>
              {selected && (
                <QueryState query={runs}>
                  {runs.data?.data
                    .filter((r) => r.status === "succeeded")
                    .map((run) => (
                      <Link
                        className="run-picker-row"
                        key={run.id}
                        href={`/overview?mode=api&dataset=${encodeURIComponent(selected)}&run=${encodeURIComponent(run.id)}`}
                      >
                        <Check size={16} />
                        {run.id}
                        <ArrowRight size={16} />
                      </Link>
                    ))}
                  {!runs.data?.data.length && (
                    <Link className="button primary" href="/data">
                      Prepare an analysis run
                    </Link>
                  )}
                </QueryState>
              )}
            </>
          ) : (
            <p>
              No saved datasets yet.{" "}
              <Link href="/data">Set up your dataset.</Link>
            </p>
          )}
        </QueryState>
        <div className="picker-footer">
          <Link href="/data" className="button">
            Set up local analysis
          </Link>
          <Link href="/overview?mode=demo" className="button">
            View synthetic demo
          </Link>
        </div>
      </Modal>
    </div>
  );
}
