"use client";
// components/analytics/command-center/CcAmbient.tsx
//
// Always-on "signal constellation" ambient background for the Live Wire
// command center. Drifting particles in the neon palette, connected by
// faint lines when close together. Sits behind all panel content
// (`.cc-ambient` is positioned/z-indexed by command-center.css).
//
// Ported from the approved reference mockup's `initCanvasField` /
// `window.__concepts["5"]` canvas field (.superpowers/sdd/live-wire-reference-mockup.html).

import { useEffect, useRef } from "react";

type Particle = {
  x: number; // fraction of width, 0..1
  y: number; // fraction of height, 0..1
  vx: number; // fraction/frame
  vy: number; // fraction/frame
  r: number; // base radius (pre-DPR)
  hue: "cyan" | "magenta";
};

// JS fallbacks for when the CSS custom properties can't be read (e.g. before
// styles are attached, or in an environment without the `.cc-root` remap).
// Everywhere else in this file, colors come from `getComputedStyle`.
const FALLBACK_CYAN = "#22e0ff";
const FALLBACK_MAGENTA = "#ff3d81";

const MIN_PARTICLES = 60;
const MAX_PARTICLES = 90;
// One particle per ~9000 CSS px^2 of canvas, clamped to [MIN, MAX].
const PARTICLE_DENSITY = 1 / 9000;

function toRgbTriplet(color: string, fallback: string): string {
  // Accepts "#rrggbb" (and shorthand "#rgb") or an already-numeric
  // "r,g,b"/"rgb(...)" string; always returns "r,g,b" for use inside
  // `rgba(...)` template strings.
  const src = color && color.trim() ? color.trim() : fallback;
  if (src.startsWith("#")) {
    let hex = src.slice(1);
    if (hex.length === 3) {
      hex = hex.split("").map((c) => c + c).join("");
    }
    if (hex.length >= 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      if (![r, g, b].some(Number.isNaN)) return `${r},${g},${b}`;
    }
  }
  const rgbMatch = src.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (rgbMatch) return `${rgbMatch[1]},${rgbMatch[2]},${rgbMatch[3]}`;
  // Unparseable — fall back to the known-good literal.
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
    // getComputedStyle can throw in exotic environments (e.g. detached
    // nodes in some test harnesses) — fall through to fallbacks below.
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
    let width = 0; // backing-store px (post-DPR)
    let height = 0;
    let dpr = 1;
    let particles: Particle[] = [];
    const palette = readPalette(canvas);

    function fit() {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const cw = Math.max(1, rect.width || canvas.clientWidth || 1);
      const ch = Math.max(1, rect.height || canvas.clientHeight || 1);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, Math.floor(cw * dpr));
      height = Math.max(1, Math.floor(ch * dpr));
      canvas.width = width;
      canvas.height = height;

      const targetCount = Math.round(cw * ch * PARTICLE_DENSITY);
      const count = Math.min(MAX_PARTICLES, Math.max(MIN_PARTICLES, targetCount));
      if (particles.length !== count) {
        particles = makeParticles(count);
      }
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
      if (!canvas || canvas.offsetParent === null) {
        // Hidden (e.g. an inactive present slide, or display:none panel) —
        // skip drawing but keep the loop alive cheaply so it resumes the
        // instant the canvas is shown again.
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
      // Single static frame — no rAF loop at all.
      drawFrame();
    } else {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(step);
    }

    let resizeObserver: ResizeObserver | null = null;
    function handleResize() {
      fit();
      if (reducedMotion) drawFrame();
    }
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(handleResize);
      resizeObserver.observe(canvas);
    } else {
      window.addEventListener("resize", handleResize);
    }

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
      if (resizeObserver) {
        resizeObserver.disconnect();
      } else {
        window.removeEventListener("resize", handleResize);
      }
    };
  }, []);

  return <canvas ref={canvasRef} className="cc-ambient" aria-hidden="true" style={{ pointerEvents: "none" }} />;
}
