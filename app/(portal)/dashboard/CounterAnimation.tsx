"use client";
import { useEffect, useRef } from "react";

export function CounterAnimation() {
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    document.querySelectorAll<HTMLElement>(".stat-num[data-count]").forEach((el) => {
      const target = parseFloat(el.dataset.count!);
      const isFloat = el.dataset.count!.includes(".");
      const duration = 1800;
      const start = performance.now();
      function tick(now: number) {
        const p = Math.min((now - start) / duration, 1);
        const ease = 1 - Math.pow(1 - p, 3);
        el.textContent = isFloat
          ? (target * ease).toFixed(1)
          : Math.round(target * ease).toLocaleString();
        if (p < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }, []);
  return null;
}
