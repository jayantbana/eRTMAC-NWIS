import { useId, useState, type MouseEvent } from "react";
import { Info } from "lucide-react";
import { applyTextSize, getTextSize, TEXT_SIZES } from "../textsize";

/** NWIS mark: a rig and well bore reaching a drill bit, with "nearby" rings around it. */
export function Logo({ size = 44 }: { size?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <defs>
        <linearGradient id={`lg${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2E6BFF" />
          <stop offset="1" stopColor="#0A2566" />
        </linearGradient>
        <clipPath id={`lc${id}`}><rect width="40" height="40" rx="11" /></clipPath>
      </defs>
      <rect width="40" height="40" rx="11" fill={`url(#lg${id})`} />
      <g clipPath={`url(#lc${id})`} fill="none" stroke="#fff">
        <circle cx="20" cy="28" r="8.5" strokeOpacity=".32" strokeWidth="1.5" />
        <circle cx="20" cy="28" r="14" strokeOpacity=".16" strokeWidth="1.5" />
      </g>
      <path d="M14.6 17.5 20 6l5.4 11.5" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M16.6 13.4h6.8" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M20 17.5v7.2" stroke="#fff" strokeWidth="2.3" strokeLinecap="round" />
      <circle cx="20" cy="28" r="3.2" fill="#FF8A1F" />
    </svg>
  );
}

export function Brand({ compact, href = "#/" }: { compact?: boolean; href?: string }) {
  return (
    <a className={`brand${compact ? " compact" : ""}`} href={href} aria-label="NWIS home">
      <Logo size={compact ? 40 : 46} />
      <span className="brand-txt">
        <span className="brand-top"><b>NWIS</b><span lang="hi">निकटवर्ती कूप आसूचना प्रणाली</span></span>
        <span className="brand-name">Nearby Wells Intelligence System</span>
        <span className="brand-short">NWIS</span>
      </span>
    </a>
  );
}

/** Thin government-portal utility strip: identity, data notice, skip link and text-size controls. */
export function GovStrip({ narrow }: { narrow?: boolean }) {
  const [size, setSize] = useState(getTextSize);
  const skip = (e: MouseEvent) => {
    e.preventDefault(); // the hash holds the route
    const m = document.getElementById("main");
    m?.focus();
    m?.scrollIntoView();
  };
  return (
    <div className="gov-strip">
      <div className={`gov-in${narrow ? " narrow" : ""}`}>
        <span className="tricolor" aria-hidden><i /><i /><i /></span>
        <span className="gov-t">Smart India Hackathon · Problem statement PS26121 · Oil India Limited</span>
        <span className="spacer" />
        <span className="gov-note"><Info aria-hidden />Prototype · synthetic demo data</span>
        <span className="gov-sep" aria-hidden />
        <a href="#main" className="skip" onClick={skip}>Skip to main content</a>
        <span className="gov-sep" aria-hidden />
        <div className="ts" role="group" aria-label="Text size">
          <span className="ts-l">Text size</span>
          {TEXT_SIZES.map((s) => (
            <button key={s.id} type="button" className={size === s.id ? "on" : ""} aria-pressed={size === s.id} aria-label={s.name} title={s.name}
              onClick={() => { applyTextSize(s.id); setSize(s.id); }}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
