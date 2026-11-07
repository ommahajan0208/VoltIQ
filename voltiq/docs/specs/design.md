# Visual and Motion Design — VoltIQ

Revision 2 · 12 October 2026. The intended result is a premium midnight/cyan energy-analysis product with a memorable landing experience and precise, comfortable analytical pages. This is a detailed design specification, not a finished visual prototype.

## 1. Research and adaptation

Reviewed public website/design-system references on 12 October 2026. The observations below are grounded in their published pages and design descriptions, not a measured audit of their live animation timings. The timings, palette and compositions later in this document are original project decisions. No paid template, brand asset or proprietary source code is required.

| Reference | Relevant observed/documented idea | Project adaptation | Boundary |
|---|---|---|---|
| [AeroLaunch Midnight](https://aerolaunch.app/docs/themes/midnight/) | Dark elevated surfaces, cyan accent, radial background glow and cyan button emphasis | Closest palette reference: restrained glow behind hero and primary action | No pricing/customer-marketing sections; implement original components |
| [Dark Mode Neon showcase](https://chrislemke.github.io/website_designs/examples/Dark_Mode_Neon.html) | Layered near-black surfaces and luminous cyan linework | Thin energy traces and clear selected-state outlines | Drop multi-neon decoration, glowing body text and cyberpunk type |
| [Sui design system](https://docs.sui.io/references/contribute/diagram-standards) and [website](https://www.sui.io/) | Documented black/blue/white diagram language and coherent brand system | Treat explanatory pipeline graphics and website charts as one visual family | Blue-adjacent reference, not an exact midnight/cyan match; no blockchain imagery |
| [Linear design refresh](https://linear.app/now/behind-the-latest-design-refresh) | Focused navigation, reduced competition and hierarchy | Quiet sidebar and clear work area on data-heavy pages | Structural reference, not a claim that Linear uses our palette |
| [Lago](https://getlago.com/) | Product storytelling through metering, charts and usage-to-output sequences | Explain readings → intervals → forecast → review in a tangible sequence | Borrow explanatory structure, not financial metrics or billing copy |

The first two references directly address the requested dark/cyan treatment. The other references solve navigation, consistency and product storytelling. This distinction avoids calling every dark technology website “midnight cyan.”

## 2. Three considered visual directions

Scores below are design judgment on a 1–5 scale, not user-study results.

| Direction | Composition | Premium feel | Data readability | CPU-friendly motion | Decision |
|---|---|---:|---:|---:|---|
| A. Energy observatory | Midnight navy, broad cyan waveform, quiet chart surfaces | 5 | 5 | 5 | Core direction |
| B. Luminous glass | Translucent overlapping panels, bloom, floating 3D meter | 5 | 3 | 2 | Use only a small hero glow; avoid glass over data |
| C. Precision console | Compact borders, monospaced labels, fine grids, minimal flourish | 4 | 5 | 5 | Use its precision inside analytical pages |

**Selected synthesis:** A for brand and landing composition, C for day-to-day analysis. B contributes a single soft atmospheric layer behind the landing visual. The application should look intentionally designed when every animation is paused.

## 3. Visual identity

Keep “VoltIQ” as the product name. Use a simple original SVG mark: one cyan energy line passing through a small gap and returning to baseline. It must remain recognizable at 20 px. Avoid ghosts, surveillance imagery, fake gauges and household illustrations that imply device-level sensing.

Landing headline: “See what your electricity patterns reveal.” Supporting copy explains historical consumption, forecasting and candidate unusual intervals. Primary CTA: “Explore saved analysis.” Secondary: “Analyze your data.” Place a concise historical-data qualifier near the visual.

### Tokens

```css
:root {
  --canvas: #070D18;
  --surface: #0D1726;
  --surface-raised: #132236;
  --border: #26374B;
  --text: #EDF5FC;
  --text-muted: #A0B2C6;
  --cyan: #45DFF5;
  --cyan-ink: #05212A;
  --forecast: #A6A4FF;
  --reference: #A0B2C6;
  --candidate: #F4BB62;
  --error: #FF8996;
  --success: #77D6AD;
  --focus: #8AECFA;
  --radius-card: 16px;
  --radius-control: 8px;
  --space-unit: 4px;
}
```

Primary button: cyan fill + cyan-ink text; secondary button: surface with border and light text. Default panels have a 1 px border, no luminous shadow. Only a hovered primary action or hero accent gets a small cyan glow. Cyan is not the color of every label/icon.

Verify final contrast in implementation: normal text ≥4.5:1, large text ≥3:1, focus/control boundaries ≥3:1 where applicable. Tokens are proposed, not certified accessible until rendered against every actual background.

### Typography and spacing

Use locally bundled Inter for UI and headings, with system sans fallback. Use tabular numerals for metrics and tables; JetBrains Mono only for run IDs/config values if bundled, otherwise system monospace. No remote font fetch is required at runtime.

Desktop hero 64/68 px, compact hero 40/46; page title 28/36; section title 18/26; body 14/22; table 13/20; captions 12/18. Headings use 600 weight, body 400/500. Metrics use 32/38 with units visibly smaller, never omitted.

Spacing scale: 4, 8, 12, 16, 24, 32, 48, 64. Page padding 32 desktop / 20 tablet / 16 mobile. Use 24 px panel gaps. Avoid a bento grid of equal cards when one main analytical task should dominate.

## 4. Application shell

At ≥1280 px: fixed 224 px sidebar, 64 px top toolbar, content area with a 1600 px maximum. Sidebar groups Overview/Consumption/Forecasting/Anomalies under Analysis; Data/Models/Reports under Workspace. Brand above; active dataset and source-time label below. Navigation uses icons with text and a cyan left indicator.

At 768–1279 px: collapsed 72 px rail with labelled tooltips and an accessible expand control. At <768 px: drawer navigation and a compact dataset/run toolbar. Tables scroll inside their panel; the page itself should not require horizontal scrolling. Stack charts vertically; preserve readable axis labels.

Global toolbar contains dataset selector, run selector, source-date range and jobs indicator. Keep filters on analytical routes. Hide irrelevant date filtering during an upload mapping step. Changes in dataset reset incompatible runs with an explicit notice rather than displaying old results.

## 5. Landing composition and storyboard

1. **Header:** logo, Method, Preview, and Open workspace links; compact, no oversized navigation.
2. **Hero:** left 45% headline/copy/CTAs, right 55% original SVG timeline. The timeline has a bright observed trace, a subtle forecast continuation and one amber candidate interval. If illustrative, label “Illustrative animation.” Do not put invented consumption KPIs on it.
3. **Interactive night:** a real saved example when available. User scrubs one historical night; a cursor updates timestamp and observed power. Example badge includes run/date. If unavailable, offer a clearly marked fixture preview.
4. **Method sequence:** four scroll-triggered panels: validate readings, aggregate intervals, forecast expected usage, inspect deviations. One active panel at a time; scrolling remains native.
5. **Product preview:** real application screenshot or reusable chart component with controls, not an image pretending to be a clickable dashboard.
6. **Scope/footer:** dataset attribution and concise limitations; repeated entry CTA.

Hero visual implementation: SVG paths and CSS radial-gradient background. Animate a clipped highlight along a fixed path; do not recalculate dozens of paths each frame. No required WebGL/Three.js dependency. A subtle pointer response can move the background at most 6 px on mouse devices; disable on touch and reduced motion.

## 6. Page composition decisions

| Page | Visual hierarchy | Distinct interaction |
|---|---|---|
| Overview | Four compact metrics → large timeline → recent-event list and coverage summary | Brush a period and open its analysis |
| Consumption | Full-width timeline → heatmap + daily profile → circuit contribution | Heatmap selection synchronizes date and charts |
| Forecasting | Origin/horizon bar → dominant forecast plot → metrics/baselines | Switch historical origin without losing preceding context |
| Anomalies | Filter row → split event table/evidence preview | Selected row highlights the exact interval |
| Event detail | Plain-language summary → aligned evidence plots → review/provenance | Shared cursor across power and score plots |
| Data | Dataset list + primary upload action → quality map → pipeline stages | Real stage transitions and schema preview |
| Models | Run list/config → horizon-specific comparison → calibration evidence | Separate experimental threshold preview |
| Reports | Section controls left → print-like preview right | Preview and download use the same frozen report config |

All analytical charts occupy flat dark surfaces. Keep atmospheric gradients outside plot regions and behind hero artwork only. Reserve amber for candidate events and quality warnings, with explicit labels to distinguish them.

## 7. Chart grammar

| Semantic role | Appearance |
|---|---|
| Observed active power | Solid cyan, 2 px |
| Forecast median | Dashed lavender, 2 px |
| q10–q90 forecast band | Lavender fill ~14% opacity, boundary lines optional |
| Statistical reference | Thin slate dashed line |
| Candidate interval | Amber translucent span and diamond marker |
| Missing observations | Real line break with gap tooltip; no zero line |
| Unscored period | Neutral background pattern and “Not scored” label |
| Imputed context | Dotted segment with explicit tooltip |
| Threshold | Amber dashed line in the score chart, unit-labelled |

Grid lines are subtle but visible; 4–6 major ticks per y-axis. Power uses kW; energy uses kWh; submeter energy uses Wh or an explicitly converted kWh view. Different units get separate panels or a clearly labelled secondary axis, not a misleading single scale.

Tooltips show source timestamp, unit, quality, observed/predicted values and relevant score. Missing values read “Unavailable.” Quantile bands are described as forecast ranges with measured coverage available in Models; do not call them guaranteed confidence. Main forecast plot marks the origin with a vertical rule and shades only the future-of-origin region.

Do not animate number counters through fake intermediate energy totals. Values update together with their data version. Provide a table/CSV alternative for chart values and keyboard-accessible controls for interactions otherwise available only through dragging.

## 8. Motion specification

| Interaction | Trigger and implementation | Timing | Reduced-motion behavior |
|---|---|---|---|
| Primary button | Hover/focus opacity, border and subtle shadow | 140 ms ease-out | Instant state |
| Sidebar selection | Move/fade active indicator | 160 ms | Instant indicator |
| Route content | Opacity + at most 6 px vertical translation | 220 ms | Opacity only ≤100 ms |
| Hero trace | SVG clip/highlight across fixed geometry; repeat slowly | 10 s cycle | Static final trace |
| Method sequence | Reveal one step as it enters viewport | 280 ms, once | All steps visible |
| Event preview | 12 px panel entrance, preserve table scroll | 240 ms | Instant panel |
| Chart range change | Crossfade or geometry update for same scale only | 180 ms | Instant correct values |
| Forecast generation | Job stage indicator, then reveal completed band | Actual job state; band 250 ms | Instant completed band |
| Heatmap selection | Outline and associated chart highlight | 120 ms | Instant outline |
| Historical replay | Time cursor with play/pause, 1×/4×/16×, scrubber | Deterministic source-time progression | User-driven step controls; no autoplay |
| Upload/processing | Progress based on transferred bytes or measured units | Actual status updates | Same information, no decorative motion |
| Review saved | Small inline check and text | 160 ms | Text immediately |

No scroll hijacking, cursor replacement, flicker, continuously orbiting KPI cards or modal transition that delays input. Decorative animation stops when off-screen or the browser tab is hidden. Replay pauses on dataset/run change, on tab hide and when the user scrubs. Never label replay “Live.”

For replay, define 1× as one 15-minute data step per second of presentation time, explicitly labelled “Replay speed”; it is not real-time playback. Use elapsed animation time to calculate the cursor and update text at data-step boundaries. Keep the last selected time on pause.

## 9. React motion implementation sketch

```tsx
'use client';
import { MotionConfig, motion, useReducedMotion } from 'motion/react';

export function EvidencePanel({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : 0.22 }}
    >
      {children}
    </motion.section>
  );
}
// Application provider: <MotionConfig reducedMotion="user">...</MotionConfig>
```

Illustrative snippet; verify against the locked dependency release. Reduced motion must also reach ECharts options and CSS media queries. Motion's provider does not automatically disable every third-party chart transition or custom animation loop.

## 10. States and accessibility

Use stable-size skeleton panels for initial chart fetches. During filter refetch, retain previous geometry dimmed and labelled “Updating,” disable stale export/open-event actions until the new identity arrives, and discard out-of-order responses. Do not show zeros as placeholders.

Empty messages distinguish “No data in this range,” “No candidate events among eligible scored intervals,” and “This period has not been scored.” Errors name the failed action and offer retry without clearing a completed run. Long-running jobs persist in the top activity control across routes.

Focus stays visible. Drawers/dialogs trap focus and restore it to the trigger. Support Escape, Enter and arrow navigation where appropriate. Hover-only tooltips must have focus equivalents. Text descriptions accompany icons. Announce completed jobs using a polite live region, not every progress tick. Review inputs have explicit labels and save/error feedback.

## 11. Performance and visual QA

Lazy-load chart modules and analytical routes; locally bundle fonts and icons. Use ResizeObserver and dispose ECharts instances on unmount. Avoid creating a new chart instance for every filter change. Limit browser display series to 5,000 buckets; event markers retain separate exact coordinates.

Targets to measure on the user's laptop: smooth ordinary transitions near 60 fps, no long task repeatedly exceeding 50 ms during a static dashboard, no horizontal page overflow at 390/768/1440 px, stable layout while data loads, and no background animation consuming CPU after tab hide. These are acceptance targets, not claimed results.

Review screenshots of every page at desktop and mobile widths, plus focused controls, open dialogs, errors and reduced-motion mode. Test the highest-density chart and long review notes. A print report uses white surfaces and dark text; plot semantics stay consistent.

## 12. Implementation order

Build tokens and shell → static Overview/Forecasting/Event layouts with explicitly labelled fixtures → shared chart interactions → actual data connection → landing story → reduced-motion and performance pass. Motion is part of each component's contract, not a final layer of random effects. Approve visual consistency through these gates without requiring a separate design decision from the user for every component.

Additional implementation reference: https://motion.dev/docs/react-accessibility . Research pages provide inspiration; all project sizes, motions and page compositions above are original specifications.
