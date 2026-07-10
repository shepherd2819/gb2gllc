"use client";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { buildPresentSlides, type PresentSlide } from "@/lib/analytics/present";
import type { SnapshotPayload } from "@/lib/analytics/snapshot";

const ADVANCE_MS = 7000;

function fmtMoney(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function fmtPct(delta: number | null): string {
  if (delta === null) return "—";
  return `${delta >= 0 ? "+" : ""}${Math.round(delta * 100)}%`;
}

const wrap: CSSProperties = {
  position: "fixed", inset: 0, zIndex: 200,
  background: "var(--color-bg)", color: "var(--color-text)",
  display: "flex", flexDirection: "column",
};
const stage: CSSProperties = {
  flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
  textAlign: "center", padding: "6vh 8vw",
};
const eyebrow: CSSProperties = {
  fontSize: "1.4rem", letterSpacing: "0.18em", textTransform: "uppercase",
  color: "var(--color-text-mute)", marginBottom: "2rem",
};
const bigNum: CSSProperties = {
  fontSize: "clamp(3rem, 12vw, 9rem)", fontWeight: 600, color: "var(--color-gold)", lineHeight: 1,
};
const sub: CSSProperties = { fontSize: "1.6rem", color: "var(--color-text-soft)", marginTop: "1.5rem" };
const bar: CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "center", gap: 14,
  padding: "18px", borderTop: "1px solid var(--color-border)",
};
const btn: CSSProperties = {
  background: "var(--color-bg-raised)", color: "var(--color-text)",
  border: "1px solid var(--color-border)", borderRadius: 8, padding: "6px 14px",
  fontSize: 15, cursor: "pointer",
};

export function CcPresent({ payload, briefing }: { payload: SnapshotPayload; briefing: string }) {
  const router = useRouter();
  const slides = buildPresentSlides(payload, briefing);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduced = useRef(false);

  const go = useCallback(
    (dir: 1 | -1) => setIndex((i) => (i + dir + slides.length) % slides.length),
    [slides.length],
  );

  // Read the reduced-motion preference before the auto-advance effect runs.
  useEffect(() => {
    reduced.current =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") router.back();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === " ") { e.preventDefault(); setPaused((p) => !p); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, router]);

  useEffect(() => {
    if (paused || reduced.current || slides.length <= 1) return;
    const t = setTimeout(() => go(1), ADVANCE_MS);
    return () => clearTimeout(t);
  }, [index, paused, go, slides.length]);

  const slide = slides[index];

  return (
    <div className="cc-present" style={wrap} role="region" aria-roledescription="carousel" aria-label="Analytics presentation">
      <div style={stage} aria-live="polite">
        <Slide slide={slide} />
      </div>
      <div style={bar}>
        <button type="button" style={btn} onClick={() => go(-1)} aria-label="Previous slide">‹ Prev</button>
        <span aria-hidden="true" style={{ color: "var(--color-text-mute)", fontVariantNumeric: "tabular-nums" }}>
          {index + 1} / {slides.length}
        </span>
        <button type="button" style={btn} onClick={() => setPaused((p) => !p)} aria-label={paused ? "Resume auto-advance" : "Pause auto-advance"}>
          {paused ? "▶ Play" : "⏸ Pause"}
        </button>
        <button type="button" style={btn} onClick={() => go(1)} aria-label="Next slide">Next ›</button>
        <button type="button" style={btn} onClick={() => router.back()} aria-label="Exit presentation">Esc — Exit</button>
      </div>
    </div>
  );
}

function Slide({ slide }: { slide: PresentSlide }) {
  switch (slide.kind) {
    case "northstar":
      return (
        <div>
          <div style={eyebrow}>{slide.label}</div>
          <div style={bigNum}>{fmtMoney(slide.value)}</div>
          <div style={sub}>{slide.momLabel}</div>
        </div>
      );
    case "movers":
      return (
        <div style={{ minWidth: "min(560px, 80vw)" }}>
          <div style={eyebrow}>Top movers</div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "1.2rem" }}>
            {slide.items.map((it) => (
              <li key={it.label} style={{ display: "flex", justifyContent: "space-between", fontSize: "2rem" }}>
                <span style={{ color: "var(--color-text-soft)" }}>{it.label}</span>
                <strong style={{ color: it.delta === null ? "var(--color-text-mute)" : it.delta >= 0 ? "var(--color-sage)" : "var(--color-red)" }}>
                  {fmtPct(it.delta)}
                </strong>
              </li>
            ))}
          </ul>
        </div>
      );
    case "briefing":
      return (
        <div style={{ maxWidth: "min(900px, 82vw)" }}>
          <div style={eyebrow}>AI Briefing</div>
          <p style={{ fontSize: "clamp(1.4rem, 3.2vw, 2.4rem)", lineHeight: 1.5, color: "var(--color-text)" }}>{slide.text}</p>
        </div>
      );
    case "companies":
      return (
        <div style={{ minWidth: "min(560px, 80vw)" }}>
          <div style={eyebrow}>Top companies</div>
          <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "1rem" }}>
            {slide.rows.map((r, i) => (
              <li key={r.name} style={{ display: "flex", justifyContent: "space-between", fontSize: "1.9rem" }}>
                <span style={{ color: "var(--color-text-soft)" }}>{i + 1}. {r.name}</span>
                <strong style={{ color: "var(--color-gold)" }}>{fmtMoney(r.revenue)}</strong>
              </li>
            ))}
          </ol>
        </div>
      );
  }
}
