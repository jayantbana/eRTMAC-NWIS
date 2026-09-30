import { memo, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import {
  Activity, ArrowRight, BadgeCheck, BellRing, Check, CheckCircle2, ChevronRight, Columns3, Database, FileCheck2, FileSearch, FileText, Info, Layers,
  Library, MapPin, MessageSquareText, Play, Radar, ScrollText, Server, TriangleAlert, UserCheck, X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api, type Meta, type Offset, type RiskTrack } from "../api";
import { Brand, GovStrip } from "../components/Chrome";
import { moduleHref, scrollToId, type ModuleId } from "../router";
import { Bar, FAMILY_COLOR, FORMATION_COLOR, Ring, fmt, vars } from "../ui";
import HeroScene from "./HeroScene";

const DEMO = moduleHref("live", "autostart=2740&speed=300");
const pct = (v: number | null | undefined) => (v == null ? "–" : `${Math.round(v * 100)}%`);

const NAV: [string, string][] = [["challenge", "The challenge"], ["how", "How it works"], ["modules", "Modules"], ["results", "Results"], ["trust", "Trust & safety"]];

const CHALLENGES: { icon: LucideIcon; tone: string; title: string; text: string }[] = [
  { icon: FileText, tone: "t-blue", title: "Thousands of pages, many of them scanned",
    text: "Daily drilling reports and well completion reports hold the field's history, but no one can read them all while a well is being drilled." },
  { icon: MapPin, tone: "t-saffron", title: "The nearest well can mislead",
    text: "A well 2 km away but across a fault may have met very different rock. One 8 km away in the same fault block can be the better guide." },
  { icon: Layers, tone: "t-violet", title: "Depths never line up",
    text: "The same rock layer sits at a different depth in every well, so problems have to be matched by geology, not by raw depth." },
];

const STEPS: { icon: LucideIcon; c1: string; c2: string; title: string; text: string }[] = [
  { icon: FileSearch, c1: "#4F8BFF", c2: "#1F4FE0", title: "Read every report",
    text: "Daily and completion reports are read, including scanned pages. Each problem is recorded with its depth, rock layer, outcome and source page." },
  { icon: Radar, c1: "#34D399", c2: "#0E9F6E", title: "Find the wells that matter",
    text: "Each nearby well is scored on rock-layer match, fault block, distance within the layer, well path, hole and mud, data quality and age." },
  { icon: Layers, c1: "#B49BFF", c2: "#7C3AED", title: "Map risks onto the new well",
    text: "Problems from relevant wells are aligned by rock layer and projected onto the new well, drawing a risk map ahead of the bit." },
  { icon: BellRing, c1: "#FFAA5C", c2: "#EA6A0C", title: "Warn early, with proof",
    text: "History and live drilling signals are combined into Advisory, Caution and Warning alerts, each with its evidence and the fixes that worked before." },
];

const MODS: { id: ModuleId; icon: LucideIcon; tone: string; title: string; text: string }[] = [
  { id: "live", icon: Activity, tone: "t-blue", title: "Live monitoring",
    text: "Follow the drilling feed in real time. See risk zones ahead of the bit and receive tiered alerts, each backed by evidence." },
  { id: "wells", icon: MapPin, tone: "t-green", title: "Nearby wells",
    text: "A map of every offset well, ranked by how closely its geology matches the new well, not just by how close it is." },
  { id: "compare", icon: Columns3, tone: "t-violet", title: "Compare wells",
    text: "Line up rock layers across wells so that problems at the same geological position sit side by side." },
  { id: "atlas", icon: Layers, tone: "t-saffron", title: "Risk by rock layer",
    text: "The chance of each problem in each formation, with honest uncertainty ranges and the historical cases behind every number." },
  { id: "ask", icon: MessageSquareText, tone: "t-pink", title: "Ask the reports",
    text: "Ask questions in plain English. Answers quote the drilling reports word for word, with a link to each page." },
  { id: "knowledge", icon: Library, tone: "t-teal", title: "Knowledge base",
    text: "Every ingested report, an expert review queue, a complete audit trail and a measured accuracy report." },
];

const TRUST: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: FileCheck2, title: "Evidence on every warning", text: "Each alert and answer links to the report page it came from, with the exact sentence highlighted." },
  { icon: UserCheck, title: "Engineers stay in command", text: "NWIS advises and never controls the rig. Alerts are acknowledged with a reason, and those reasons help tune thresholds." },
  { icon: ScrollText, title: "Complete audit trail", text: "Every expert review and every acknowledgement is written to an append-only audit log." },
  { icon: Server, title: "Runs on-premises", text: "Works on local servers without internet access, cloud services or API keys. Only the optional background map loads online." },
];

function useInView<T extends Element>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen] as const;
}

function CountUp({ to, run, decimals = 0, suffix = "" }: { to: number | null | undefined; run: boolean; decimals?: number; suffix?: string }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!run || to == null) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { setV(to); return; }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 1300);
      setV(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, run]);
  if (to == null) return <>–</>;
  return <>{v.toLocaleString("en-IN", { maximumFractionDigits: decimals, minimumFractionDigits: decimals })}{suffix}</>;
}

function Landing({ meta }: { meta: Meta | null }) {
  const [ev, setEv] = useState<any>(null);
  const [track, setTrack] = useState<RiskTrack | null>(null);
  const [offsets, setOffsets] = useState<Offset[] | null>(null);
  const [statsRef, statsSeen] = useInView<HTMLDivElement>();

  useEffect(() => { api.evaluation().then(setEv).catch(() => setEv(null)); }, []);
  useEffect(() => {
    if (!meta) return;
    api.track(meta.active_well_id, meta.default_radius_km).then(setTrack).catch(() => {});
    api.offsets(meta.active_well_id, meta.default_radius_km).then(setOffsets).catch(() => {});
  }, [meta?.active_well_id]);

  const x = ev?.extraction, ing = ev?.ingest;
  const updated = ev?.generated_at ? new Date(ev.generated_at.replace(" ", "T")) : null;
  const go = (id: string) => (e: MouseEvent) => { e.preventDefault(); scrollToId(id); };

  return (
    <div className="lp">
      <GovStrip narrow />
      <header className="lp-header">
        <div className="container">
          <Brand />
          <nav className="lp-nav" aria-label="Page sections">
            {NAV.map(([id, label]) => <a key={id} href={`#${id}`} onClick={go(id)}>{label}</a>)}
          </nav>
          <a className="btn btn-primary btn-lg" href={moduleHref("live")}>Open workspace <ArrowRight /></a>
        </div>
      </header>

      <main id="main" tabIndex={-1}>
        {/* ------------------------------------------------ hero */}
        <section className="lp-hero">
          <div className="container lp-hero-grid">
            <div>
              <span className="eyebrow"><span className="eyebrow-tag">eRTMAC companion</span>Decision support for safer drilling</span>
              <h1 className="lp-h1">See drilling risks <span className="grad">before the bit gets there.</span></h1>
              <p className="lp-lead">
                NWIS learns from every nearby well already drilled. It finds the wells that truly match, maps their problems onto the new well,
                and warns engineers early, with the exact report page as proof.
              </p>
              <div className="lp-cta">
                <a className="btn btn-primary btn-xl" href={moduleHref("live")}>Open workspace <ArrowRight /></a>
                <a className="btn btn-xl" href={DEMO}><Play /> Watch the live demo</a>
              </div>
              <ul className="lp-checks">
                <li><CheckCircle2 aria-hidden />Every warning cites its source page</li>
                <li><CheckCircle2 aria-hidden />Runs on local servers</li>
                <li><CheckCircle2 aria-hidden />Engineers keep final authority</li>
              </ul>
            </div>
            <HeroScene track={track} />
          </div>
        </section>

        {/* ------------------------------------------------ live numbers */}
        <section className="lp-stats" aria-label="Knowledge base at a glance">
          <div className="container">
            <div className="lp-stats-in" ref={statsRef}>
              <Stat icon={MapPin} tone="t-blue" value={<CountUp to={meta?.counts.wells} run={statsSeen} />} label="wells in the field" sub="mapped with their paths and rock layers" />
              <Stat icon={FileSearch} tone="t-saffron" value={<CountUp to={meta?.counts.documents} run={statsSeen} />} label="drilling reports read"
                sub={ing ? `${fmt.int(ing.pages)} pages, ${ing.ocr_pages} scanned` : "daily and completion reports"} />
              <Stat icon={Database} tone="t-violet" value={<CountUp to={meta?.counts.events} run={statsSeen} />} label="drilling problems catalogued" sub="each linked to its source page" />
              <Stat icon={BadgeCheck} tone="t-green" value={<CountUp to={x ? Math.round(x.f1 * 100) : null} run={statsSeen} suffix="%" />} label="extraction accuracy"
                sub="F1 score against hidden ground truth" />
            </div>
          </div>
        </section>

        {/* ------------------------------------------------ challenge */}
        <section className="lp-section" id="challenge">
          <div className="container ch-grid">
            <div>
              <div className="sec-head" style={{ marginBottom: 32 }}>
                <span className="kicker">The challenge</span>
                <h2 className="sec-title">Lessons from past wells are buried in paper.</h2>
                <p className="sec-sub">Every new well is drilled close to wells that already met the same rocks. Their experience is written down, but it is hard to find when it matters.</p>
              </div>
              <div className="ch-list">
                {CHALLENGES.map((c) => (
                  <div key={c.title} className="ch-item">
                    <div className={`ic-tile ${c.tone}`}><c.icon aria-hidden /></div>
                    <div><h3>{c.title}</h3><p>{c.text}</p></div>
                  </div>
                ))}
              </div>
            </div>
            <NearestCard offsets={offsets} />
          </div>
        </section>

        {/* ------------------------------------------------ how it works */}
        <section className="lp-section alt" id="how">
          <div className="container">
            <div className="sec-head is-center">
              <span className="kicker">How it works</span>
              <h2 className="sec-title">From old reports to early warnings, in four steps.</h2>
              <p className="sec-sub">NWIS runs next to eRTMAC. It only reads the drilling feed and never sends commands to the rig.</p>
            </div>
            <div className="steps">
              {STEPS.map((s, i) => (
                <div key={s.title} className="step">
                  <div className="step-top">
                    <div className="step-ic" style={vars({ c1: s.c1, c2: s.c2 })}><s.icon aria-hidden /></div>
                    <span className="step-n">0{i + 1}</span>
                  </div>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                  {i < STEPS.length - 1 && <span className="step-arrow" aria-hidden><ChevronRight /></span>}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------ modules */}
        <section className="lp-section" id="modules">
          <div className="container">
            <div className="sec-head is-center">
              <span className="kicker">Modules</span>
              <h2 className="sec-title">One workspace for the whole drilling team.</h2>
              <p className="sec-sub">Six modules share the same evidence. Open any of them to explore the demo field.</p>
            </div>
            <div className="mods">
              {MODS.map((m) => (
                <a key={m.id} className="mod" href={moduleHref(m.id)}>
                  <div className={`ic-tile ${m.tone}`}><m.icon aria-hidden /></div>
                  <h3>{m.title}</h3>
                  <p>{m.text}</p>
                  <span className="mod-link">Open module <ArrowRight aria-hidden /></span>
                </a>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------ demo scenario */}
        <section className="lp-section lp-dark" id="demo">
          <div className="container demo-grid">
            <div>
              <span className="kicker">See it in action</span>
              <h2 className="sec-title">Watch Well A drill into known trouble.</h2>
              <p className="sec-sub">The demo replays Well A's drilling feed from 2,740 m. Alerts rise step by step as the bit approaches intervals where nearby wells had problems.</p>
              <ol className="tl">
                <li><span className="tier ADVISORY">Advisory</span><div><b>Risk zone enters the look-ahead window</b><p>About 50 m before the mud-loss interval that Wells B and D ran into.</p></div></li>
                <li><span className="tier CAUTION">Caution</span><div><b>The bit enters the historical interval</b><p>Engineers see the evidence and the fixes that worked in similar cases.</p></div></li>
                <li><span className="tier WARNING">Warning</span><div><b>Live signals confirm the loss</b><p>Raised about 1 m after the loss begins, when flow out drops below flow in.</p></div></li>
                <li><span className="tier OK">No false alarm</span><div><b>A routine pit transfer raises nothing</b><p>Rules and models tell normal operations apart from real trouble.</p></div></li>
                <li><span className="tier INFO">Re-aligned</span><div><b>Barail top found 6 m shallower than planned</b><p>Every projected zone shifts to match, and open alerts keep their history.</p></div></li>
              </ol>
              <div className="lp-cta">
                <a className="btn btn-saffron btn-xl" href={DEMO}><Play /> Run this scenario</a>
              </div>
            </div>
            <DepthRibbon track={track} />
          </div>
        </section>

        {/* ------------------------------------------------ results */}
        <section className="lp-section" id="results">
          <div className="container">
            <div className="sec-head is-center">
              <span className="kicker">Measured, not assumed</span>
              <h2 className="sec-title">Every part is tested against known answers.</h2>
              <p className="sec-sub">The demo field is synthetic, so the true answers are known. That lets each part of NWIS be scored rather than just claimed.</p>
            </div>
            {ev ? <Results ev={ev} /> : <div className="res-note"><Info aria-hidden />The accuracy report appears here once the NWIS service is running.</div>}
          </div>
        </section>

        {/* ------------------------------------------------ trust */}
        <section className="lp-section alt" id="trust">
          <div className="container">
            <div className="sec-head is-center">
              <span className="kicker">Trust & safety</span>
              <h2 className="sec-title">Built to be checked, not just believed.</h2>
            </div>
            <div className="trust-grid">
              {TRUST.map((t) => (
                <div key={t.title} className="trust">
                  <div className="ic-tile t-green"><t.icon aria-hidden /></div>
                  <h3>{t.title}</h3>
                  <p>{t.text}</p>
                </div>
              ))}
            </div>
            <div className="notice-card" role="note">
              <TriangleAlert aria-hidden />
              <div>
                <b>Demo data notice.</b> All wells, reports and drilling data in this prototype are synthetic, created for Smart India Hackathon problem
                statement PS26121. They are not real Oil India Limited records. The system is built so that real reports and live feeds can replace them without redesign.
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------ call to action */}
        <section className="lp-section lp-cta-band" style={{ paddingTop: 108 }}>
          <div className="container">
            <div className="cta-box">
              <div>
                <h2>Ready to see the well ahead?</h2>
                <p>Open the workspace to explore the demo field, or start the live replay and watch the alerts unfold.</p>
              </div>
              <div className="cta-actions">
                <a className="btn btn-white btn-xl" href={moduleHref("live")}>Open workspace <ArrowRight /></a>
                <a className="btn btn-glass btn-xl" href={DEMO}><Play /> Watch the live demo</a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="ft-tricolor" aria-hidden />
        <div className="container">
          <div className="ft-grid">
            <div>
              <Brand />
              <p className="ft-about">A decision-support layer that runs alongside eRTMAC. It compares the active well with the offset wells that matter and warns engineers before they reach a risky interval.</p>
            </div>
            <div>
              <div className="ft-h">Modules</div>
              <div className="ft-links">{MODS.map((m) => <a key={m.id} href={moduleHref(m.id)}>{m.title}</a>)}</div>
            </div>
            <div>
              <div className="ft-h">Resources</div>
              <div className="ft-links">
                <a href={DEMO}>Live demo</a>
                <a href={moduleHref("knowledge")}>Accuracy report</a>
                <a href="/docs" target="_blank" rel="noreferrer">API documentation</a>
                <a href="#top" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Back to top</a>
              </div>
            </div>
            <div>
              <div className="ft-h">Important notice</div>
              <p className="ft-about" style={{ marginTop: 0 }}>
                NWIS gives decision support only. The drilling engineer keeps full authority over every operational decision.
                All data shown is synthetic demo data.
              </p>
            </div>
          </div>
          <div className="ft-bottom">
            <span>NWIS prototype · Smart India Hackathon · PS26121</span>
            <span>Data mode: {meta?.data_mode ?? "SYNTHETIC"}{updated ? ` · Accuracy report updated ${updated.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}` : ""}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default memo(Landing);

function Stat({ icon: Icon, tone, value, label, sub }: { icon: LucideIcon; tone: string; value: ReactNode; label: string; sub: string }) {
  return (
    <div className="lp-stat">
      <div className={`lp-stat-ic ${tone}`}><Icon aria-hidden /></div>
      <div style={{ minWidth: 0 }}>
        <div className="lp-stat-v">{value}</div>
        <div className="lp-stat-l">{label}</div>
        <div className="lp-stat-s">{sub}</div>
      </div>
    </div>
  );
}

function Results({ ev }: { ev: any }) {
  const x = ev.extraction, la = ev.lookahead, rl = ev.relevance, pr = ev.precursors, s = ev.search, ing = ev.ingest;
  const [pv, pt] = String(x?.provenance_valid ?? "0/0").split("/").map(Number);
  const models = pr ? (Object.values(pr.tier2_logistic) as any[]) : [];
  const range = (k: string) => { const v = models.map((m) => m[k] as number); return [Math.min(...v), Math.max(...v)]; };
  const [auc0, auc1] = range("auc_grouped_cv");
  const [lead0, lead1] = range("median_lead_min");
  const [, fa1] = range("false_alarms_per_24h");
  const times = la && la.baseline.event_recall > 0 ? Math.round(la.ours.event_recall / la.baseline.event_recall) : null;
  return (
    <>
      <div className="res-grid">
        {x && (
          <div className="res">
            <div className="res-top">
              <Ring value={x.f1} size={92} color="var(--primary)"><span style={{ fontSize: "1.3rem" }}>{pct(x.f1)}</span></Ring>
              <div><h3>Reads reports accurately</h3><div className="small muted">F1 score for finding drilling problems</div></div>
            </div>
            <p>Precision {pct(x.precision)} and recall {pct(x.recall)} across {ing?.documents ?? "all"} reports{ing ? `, including ${ing.ocr_pages} scanned pages` : ""}.</p>
          </div>
        )}
        {x && (
          <div className="res">
            <div className="res-top">
              <Ring value={pt ? pv / pt : 0} size={92} color="var(--green)"><span style={{ fontSize: "1.3rem" }}>{pt ? pct(pv / pt) : "–"}</span></Ring>
              <div><h3>Every quote verified</h3><div className="small muted">{pv} of {pt} quotes checked</div></div>
            </div>
            <p>Each quote NWIS shows was found word for word on the page it cites. Depths are read to within {x.depth_abs_error_m.median} m (median).</p>
          </div>
        )}
        {la && (
          <div className="res">
            <div className="res-top">
              <div className="res-v" style={{ color: "var(--saffron-ink)" }}>{times}×</div>
              <div><h3>More problems flagged ahead</h3><div className="small muted">Look-ahead back-test</div></div>
            </div>
            <div className="col" style={{ gap: 10 }}>
              <div className="cmpbar"><span>NWIS</span><Bar value={la.ours.event_recall} color="var(--saffron)" /><b>{pct(la.ours.event_recall)}</b></div>
              <div className="cmpbar"><span>Depth only</span><Bar value={la.baseline.event_recall} color="var(--faint)" /><b>{pct(la.baseline.event_recall)}</b></div>
            </div>
            <p>Share of held-out problems flagged in advance using only earlier wells, while marking just {pct(la.ours.share_of_hole_flagged)} of the hole.</p>
          </div>
        )}
        {rl && (
          <div className="res">
            <div className="res-top">
              <div className="res-v" style={{ color: "var(--green-ink)" }}>{rl.improvement_pct > 0 ? "+" : ""}{rl.improvement_pct}%</div>
              <div><h3>Better choice of guide wells</h3><div className="small muted">Ranking quality (NDCG@5)</div></div>
            </div>
            <div className="col" style={{ gap: 10 }}>
              <div className="cmpbar"><span>NWIS</span><Bar value={rl.ndcg5_relevance} color="var(--green)" /><b>{rl.ndcg5_relevance.toFixed(2)}</b></div>
              <div className="cmpbar"><span>Distance</span><Bar value={rl.ndcg5_distance_only} color="var(--faint)" /><b>{rl.ndcg5_distance_only.toFixed(2)}</b></div>
            </div>
            <p>Tested on {rl.wells_evaluated} wells: ranking by geology and fault block beats ranking by distance alone.</p>
          </div>
        )}
        {models.length > 0 && (
          <div className="res">
            <div className="res-top">
              <div className="res-v" style={{ color: "var(--violet-ink)" }}>{Math.round(lead0)}–{Math.round(lead1)}<span style={{ fontSize: "1.1rem", marginLeft: 6 }}>min</span></div>
              <div><h3>Early warning from live data</h3><div className="small muted">Median lead time</div></div>
            </div>
            <p>Live models flag problems a median {Math.round(lead0)}–{Math.round(lead1)} minutes early, scoring {auc0.toFixed(3)}–{auc1.toFixed(3)} AUC on wells they never saw, with at most {Math.ceil(fa1)} false alarms per day of drilling.</p>
          </div>
        )}
        {s && !s.error && (
          <div className="res">
            <div className="res-top">
              <Ring value={s.recall_at_5} size={92} color="#DB2777"><span style={{ fontSize: "1.3rem" }}>{pct(s.recall_at_5)}</span></Ring>
              <div><h3>Finds the right evidence</h3><div className="small muted">Ask the reports</div></div>
            </div>
            <p>The right source is in the top five for {pct(s.recall_at_5)} of {s.golden_questions} test questions. NWIS correctly says “not enough evidence” for {pct(s.correct_insufficient_evidence)} of {s.unanswerable_questions} unanswerable ones.</p>
          </div>
        )}
      </div>
      <div className="res-note"><Info aria-hidden />{ev.note}</div>
    </>
  );
}

/** "Nearest is not the best guide": a small map plus the real scores of Wells G and E. */
function NearestCard({ offsets }: { offsets: Offset[] | null }) {
  const g = offsets?.find((o) => o.name === "Well G");
  const e = offsets?.find((o) => o.name === "Well E");
  const rows = [
    { name: "Well G", km: g?.surface_distance_km ?? 2.0, score: g?.overall ?? 0.35, same: g?.same_compartment ?? false },
    { name: "Well E", km: e?.surface_distance_km ?? 8.0, score: e?.overall ?? 0.66, same: e?.same_compartment ?? true },
  ];
  return (
    <div className="cmp-card">
      <span className="kicker">Why ranking matters</span>
      <h3 style={{ marginTop: 12 }}>The nearest well is not always the best guide</h3>
      <div className="cmp-map">
        <svg viewBox="0 0 520 200" role="img" aria-label="Well G is 2 km from Well A but across a fault. Well E is 8 km away in the same fault block.">
          <polygon points="352,-10 300,210 530,210 530,-10" fill="#FFF1E7" opacity={0.85} />
          <path d="M352 -10 L300 210" stroke="#E4572E" strokeWidth={2.4} strokeDasharray="8 6" />
          <text x={378} y={26} fontSize={12} fontWeight={800} fill="#C2410C" letterSpacing=".06em">ACROSS THE FAULT</text>
          <text x={22} y={186} fontSize={12} fontWeight={800} fill="#047857" letterSpacing=".06em">SAME FAULT BLOCK</text>
          <path d="M300 106 L62 80" stroke="#0E9F6E" strokeWidth={2.4} strokeDasharray="2 6" strokeLinecap="round" />
          <path d="M300 106 L358 122" stroke="#8C9AB0" strokeWidth={2.4} strokeDasharray="2 6" strokeLinecap="round" />
          <text x={170} y={114} fontSize={12.5} fontWeight={800} fill="#047857" textAnchor="middle">{rows[1].km.toFixed(1)} km</text>
          <text x={328} y={146} fontSize={12.5} fontWeight={800} fill="#56667F" textAnchor="middle">{rows[0].km.toFixed(1)} km</text>
          <circle cx={62} cy={80} r={13} fill="#0E9F6E" stroke="#fff" strokeWidth={3} />
          <path d="M56 80 l4 4 l8 -9" stroke="#fff" strokeWidth={2.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <text x={62} y={112} fontSize={13} fontWeight={800} fill="#0B1B34" textAnchor="middle">Well E</text>
          <circle cx={358} cy={122} r={13} fill="#A6B2C8" stroke="#fff" strokeWidth={3} />
          <path d="M353 117 l10 10 M363 117 l-10 10" stroke="#fff" strokeWidth={2.6} strokeLinecap="round" />
          <text x={392} y={127} fontSize={13} fontWeight={800} fill="#0B1B34">Well G</text>
          <polygon points="300,90 305,101 317,102 308,110 311,122 300,116 289,122 292,110 283,102 295,101" fill="#FF7A1A" stroke="#fff" strokeWidth={2} />
          <text x={290} y={82} fontSize={13} fontWeight={800} fill="#C2410C" textAnchor="end">Well A (drilling)</text>
        </svg>
      </div>
      {rows.map((r) => (
        <div key={r.name} className="cmp-row">
          <div>
            <div className="cmp-name">{r.name}</div>
            <div className="cmp-meta">
              <span>{r.km.toFixed(1)} km away</span>
              {r.same ? <span className="tag same"><Check /> Same fault block</span> : <span className="tag across"><X /> Across a fault</span>}
            </div>
          </div>
          <div className="cmp-score">
            <div className="xs muted strong">Relevance score</div>
            <b style={{ color: r.same ? "var(--green-ink)" : "var(--muted)" }}>{r.score.toFixed(2)}</b>
            <Bar value={r.score} color={r.same ? "var(--green)" : "var(--faint)"} />
          </div>
        </div>
      ))}
      <p className="cmp-foot">Well E is used as a guide for Well A. Well G is set aside, even though it is four times closer.</p>
    </div>
  );
}

/** Vertical depth ribbon of the demo interval, drawn from the live risk track. */
function DepthRibbon({ track }: { track: RiskTrack | null }) {
  const top = 2740, bot = 2920, H = 430, y0 = 18, y1 = H - 14;
  const y = (md: number) => y0 + ((md - top) / (bot - top)) * (y1 - y0);
  const zones = (track?.zones ?? []).filter((z) => z.md_to > top && z.md_from < bot);
  const tops = (track?.tops ?? []).filter((t) => t.md_base > top && t.md_top < bot);
  const ticks: number[] = [];
  for (let d = top; d <= bot; d += 20) ticks.push(d);
  return (
    <div className="ribbon-card">
      <h3>Well A · demo interval</h3>
      <p style={{ color: "#B8C6E2", fontSize: ".95rem", marginTop: 4 }}>Risk zones projected from nearby wells, before drilling starts</p>
      <svg viewBox={`0 0 440 ${H}`} role="img" aria-label="Depth ribbon from 2,740 to 2,920 metres showing the projected risk zones">
        {ticks.map((d) => (
          <g key={d}>
            <line x1={62} x2={430} y1={y(d)} y2={y(d)} stroke="rgba(255,255,255,.07)" />
            <text x={54} y={y(d) + 4} fontSize={11.5} fill="#8FA3C8" textAnchor="end" fontWeight={600}>{d.toLocaleString("en-IN")}</text>
          </g>
        ))}
        {tops.map((t) => {
          const a = Math.max(t.md_top, top), b = Math.min(t.md_base, bot);
          return (
            <g key={t.code}>
              <rect x={66} y={y(a)} width={46} height={y(b) - y(a)} fill={FORMATION_COLOR[t.code] ?? "#94A3B8"} rx={3} />
              <text transform={`translate(${89} ${(y(a) + y(b)) / 2}) rotate(-90)`} fontSize={11} fontWeight={800} fill="#1E293B" textAnchor="middle" dominantBaseline="middle">
                {t.name.split(" ")[0]}
              </text>
            </g>
          );
        })}
        {zones.map((z) => (
          <g key={z.id}>
            <rect x={124} y={y(Math.max(z.md_from, top))} width={24} height={Math.max(6, y(Math.min(z.md_to, bot)) - y(Math.max(z.md_from, top)))} rx={6}
              fill={FAMILY_COLOR[z.family]} />
            <text x={162} y={y((z.md_from + z.md_to) / 2) - 3} fontSize={15} fontWeight={800} fill="#fff">{z.label}</text>
            <text x={162} y={y((z.md_from + z.md_to) / 2) + 15} fontSize={12} fill="#B8C6E2" fontWeight={600}>
              {fmt.int(z.md_from)}–{fmt.int(z.md_to)} m · {Math.round(z.peak * 100)}% · {z.wells.join(", ")}
            </text>
          </g>
        ))}
        <line x1={62} x2={430} y1={y(top) + 1} y2={y(top) + 1} stroke="#FF7A1A" strokeWidth={3} />
        <text x={430} y={y(top) + 18} fontSize={12} fontWeight={800} fill="#FFB27A" textAnchor="end">Replay starts at 2,740 m</text>
        {!track && <text x={250} y={H / 2} fontSize={14} fill="#8FA3C8" textAnchor="middle">Start the NWIS service to load Well A's risk track</text>}
      </svg>
    </div>
  );
}
