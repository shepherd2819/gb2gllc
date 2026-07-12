"use client";
// components/analytics/command-center/CcAmbient.tsx
//
// Always-on "signal constellation" ambient background for the Live Wire
// command center. Drifting particles in the neon palette, connected by
// faint lines when close together. Sits behind all panel content.
//
// Positioned `absolute; inset:0` (inline, so it holds even if the .cc-ambient
// CSS rule is unavailable) — this CLIPS the field to the `.cc-root` box so it
// can never paint over the surrounding (light) portal chrome. The backing
// store is sized from the `.cc-root` element with hard caps on both dimensions
// AND total area; because the canvas is out of flow, sizing off .cc-root can
// never feed back into .cc-root's height. Draws one static frame under
// reduced-motion; pauses while the tab is hidden.
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
// Hard bounds on the backing store (belt-and-suspenders vs. huge/tall layouts).
const MAX_CSS_W = 2000;
const MAX_CSS_H = 2800;
const DPR_CAP = 1.75;
// Absolute ceiling on backing-store pixels; if width*height would exceed this,
// both are scaled down proportionally. Caps memory + per-frame clear cost.
const MAX_BACKING_PX = 14_000_000;

// Guaranteed positioning: inline so a dropped/absent .cc-ambient CSS rule can
// never leave the canvas in normal flow, and so it is always clipped to the
// .cc-root box (absolute) rather than covering the viewport (fixed).
const CANVAS_STYLE: CSSProperties = {
  position: "absolute",
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

function readPalette(scope: Element): { cyan: string; magenta: string } {
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

    // Size + palette come from the .cc-root box (fallback: documentElement).
    const scope: HTMLElement =
      (canvas.closest(".cc-root") as HTMLElement | null) ?? document.documentElement;

    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let rafId: number | null = null;
    let resizeRaf: number | null = null;
    let width = 0; // backing-store px (post-DPR)
    let height = 0;
    let dpr = 1;
    let particles: Particle[] = [];
    const palette = readPalette(scope);

    // Size from the .cc-root box (bounded + capped). The canvas is absolute /
    // out of flow, so writing its backing store can't change .cc-root's size —
    // no resize feedback is possible.
    function fit() {
      if (!canvas) return;
      const boxW = scope.clientWidth || window.innerWidth || 1;
      const boxH = scope.clientHeight || window.innerHeight || 1;
      let cw = Math.max(1, Math.min(boxW, MAX_CSS_W));
      let ch = Math.max(1, Math.min(boxH, MAX_CSS_H));
      dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
      let nextW = Math.max(1, Math.floor(cw * dpr));
      let nextH = Math.max(1, Math.floor(ch * dpr));
      // Proportionally scale down if the backing store would exceed the ceiling.
      const area = nextW * nextH;
      if (area > MAX_BACKING_PX) {
        const s = Math.sqrt(MAX_BACKING_PX / area);
        nextW = Math.max(1, Math.floor(nextW * s));
        nextH = Math.max(1, Math.floor(nextH * s));
      }
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
      // resumes instantly.
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

    // Re-fit on layout changes, debounced into one rAF. Observing .cc-root is
    // safe (the out-of-flow canvas can't change .cc-root's size); a window
    // listener covers viewport/DPR changes when there is no observer.
    function onResize() {
      if (resizeRaf !== null) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = null;
        fit();
        if (reducedMotion) drawFrame();
      });
    }
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(onResize);
      resizeObserver.observe(scope);
    }
    window.addEventListener("resize", onResize);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (resizeRaf !== null) cancelAnimationFrame(resizeRaf);
      rafId = null;
      if (resizeObserver) resizeObserver.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return <canvas ref={canvasRef} className="cc-ambient" aria-hidden="true" style={CANVAS_STYLE} />;
}
