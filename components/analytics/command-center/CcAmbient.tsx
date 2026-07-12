"use client";
// components/analytics/command-center/CcAmbient.tsx
//
// Always-on "signal constellation" ambient background for the Live Wire
// command center. Drifting particles in the neon palette, connected by
// faint lines when close together. Sits behind all panel content.
//
// The canvas is VIEWPORT-FIXED and sized from window dimensions (never from
// its own rect) so its backing store is always bounded by the screen and can
// never enter a resize feedback loop. Critical positioning is set via inline
// style so it holds even if the .cc-ambient CSS rule is unavailable.
//
// Ported from the approved reference mockup's canvas field
// (.superpowers/sdd/live-wire-reference-mockup.html).

import { useEffect, useRef, type CSSProperties } from "react";

type Particle = {
  x: number; // fraction of width, 0..1
  y: number; // fraction of height, 0..1
  vx: number; // fraction/frame
  vy: number; // fraction/frame
  r: number; // base radius (pre-DPR)
  hue: "cyan" | "magenta";
};

// JS fallbacks for when the CSS custom properties can't be read (e.g. before
// styles are attached). Everywhere else colors come from getComputedStyle.
const FALLBACK_CYAN = "#22e0ff";
const FALLBACK_MAGENTA = "#ff3d81";

const MIN_PARTICLES = 60;
const MAX_PARTICLES = 90;
const PARTICLE_DENSITY = 1 / 9000; // ~1 particle per 9000 CSS px^2, clamped
// Hard caps on the CSS size used for the backing store — bounds the canvas to
// a sane maximum regardless of window size (belt-and-suspenders vs. huge
// displays). The DPR is separately capped at 2.
const MAX_CSS_DIM = 2400;

// Guaranteed positioning: inline so a dropped/absent .cc-ambient CSS rule can
// never leave the canvas in normal flow (which is what allowed the old
// self-observing resize loop to blow the backing store up).
const CANVAS_STYLE: CSSProperties = {
  position: "fixed",
  inset: 0,
  width: "100%",
  height: "100%",
  display: "block",
  pointerEvents: "none",
  zIndex: 0,
};

function toRgbTriplet(color: string, fallback: string): string {
  const src = color && color.trim() ? color.trim() : fallback;
  if (src.startsWith("#")) {
    let hex = src.slice(1);
    if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
    if (hex.length >= 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      if (![r, g, b].some(Number.isNaN)) return `${r},${g},${b}`;
    }
  }
  const rgbMatch = src.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (rgbMatch) return `${rgbMatch[1]},${rgbMatch[2]},${rgbMatch[3]}`;
  return toRgbTriplet(fallback, fallback);
}

function readPalette(canvas: HTMLCanvasElement): { cyan: string; magenta: string } {
  const scope = canvas.closest(".cc-root") ?? document.documentElement;
  let cyanRaw = "";
  let magentaRaw = "";
  try {
    const styles = getComputedStyle(scope);
    cyanRaw = styles.getPropertyValue("--color-gold").trim();
    magentaRaw = styles.getPropertyValue("--color-blue").trim();
  } catch {
    // getComputedStyle can throw on detached nodes — fall through to fallbacks.
  }
  return {
    cyan: toRgbTriplet(cyanRaw, FALLBACK_CYAN),
    magenta: toRgbTriplet(magentaRaw, FALLBACK_MAGENTA),
  };
}

function makeParticles(count: number): Particle[] {
  const particles: Particle[] = [];
  for (let i = 0; i < count; i++) {
    particles.push({
      x: Math.random(),
      y: Math.random(),
      vx: (Math.random() - 0.5) * 0.00042,
      vy: (Math.random() - 0.5) * 0.00042,
      r: Math.random() * 1.5 + 0.7,
      hue: Math.random() < 0.5 ? "magenta" : "cyan",
    });
  }
  return particles;
}

export function CcAmbient() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let rafId: number | null = null;
    let resizeRaf: number | null = null;
    let width = 0; // backing-store px (post-DPR)
    let height = 0;
    let dpr = 1;
    let particles: Particle[] = [];
    const palette = readPalette(canvas);

    // Size from the WINDOW (bounded, independent of the canvas) so the backing
    // store can never feed back into its own size.
    function fit() {
      if (!canvas) return;
      const cw = Math.max(1, Math.min(window.innerWidth || 1, MAX_CSS_DIM));
      const ch = Math.max(1, Math.min(window.innerHeight || 1, MAX_CSS_DIM));
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const nextW = Math.max(1, Math.floor(cw * dpr));
      const nextH = Math.max(1, Math.floor(ch * dpr));
      if (nextW !== width) {
        width = nextW;
        canvas.width = width;
      }
      if (nextH !== height) {
        height = nextH;
        canvas.height = height;
      }
      const targetCount = Math.round(cw * ch * PARTICLE_DENSITY);
      const count = Math.min(MAX_PARTICLES, Math.max(MIN_PARTICLES, targetCount));
      if (particles.length !== count) particles = makeParticles(count);
    }

    function drawFrame() {
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      const maxDist = 0.16 * Math.min(width, height);
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        for (let j = i + 1; j < particles.length; j++) {
          const q = particles[j];
          const dx = (p.x - q.x) * width;
          const dy = (p.y - q.y) * height;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < maxDist) {
            const alpha = (1 - dist / maxDist) * 0.16;
            const rgb = p.hue === "magenta" ? palette.magenta : palette.cyan;
            ctx.strokeStyle = `rgba(${rgb},${alpha})`;
            ctx.lineWidth = dpr;
            ctx.beginPath();
            ctx.moveTo(p.x * width, p.y * height);
            ctx.lineTo(q.x * width, q.y * height);
            ctx.stroke();
          }
        }
      }
      for (const p of particles) {
        const rgb = p.hue === "magenta" ? palette.magenta : palette.cyan;
        ctx.beginPath();
        ctx.fillStyle = `rgba(${rgb},0.85)`;
        ctx.shadowColor = `rgba(${rgb},0.9)`;
        ctx.shadowBlur = 7 * dpr;
        ctx.arc(p.x * width, p.y * height, p.r * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    }

    function step() {
      // Pause cheaply while the tab is backgrounded; keep the loop alive so it
      // resumes instantly. (offsetParent is unusable here: fixed elements
      // report null, and this canvas is always on-screen when the tab is.)
      if (document.hidden) {
        rafId = requestAnimationFrame(step);
        return;
      }
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > 1) p.vx *= -1;
        if (p.y < 0 || p.y > 1) p.vy *= -1;
      }
      drawFrame();
      rafId = requestAnimationFrame(step);
    }

    fit();

    if (reducedMotion) {
      drawFrame(); // single static frame, no loop
    } else {
      rafId = requestAnimationFrame(step);
    }

    // Debounce resizes into a single rAF so a burst can't thrash the canvas.
    function onResize() {
      if (resizeRaf !== null) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = null;
        fit();
        if (reducedMotion) drawFrame();
      });
    }
    window.addEventListener("resize", onResize);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (resizeRaf !== null) cancelAnimationFrame(resizeRaf);
      rafId = null;
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return <canvas ref={canvasRef} className="cc-ambient" aria-hidden="true" style={CANVAS_STYLE} />;
}
