// app/(admin)/CommandPalette.tsx
"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { buildPaletteEntries, rankPalette, type PaletteClient } from "@/lib/palette-search";
import { AGENTS } from "./agents/agents-manifest";

export function CommandPalette({ clients }: { clients: PaletteClient[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const entries = useMemo(
    () => buildPaletteEntries(clients, AGENTS.map((a) => ({ slug: a.slug, name: a.name, tagline: a.tagline, glyph: a.glyph }))),
    [clients],
  );
  const results = useMemo(() => rankPalette(query, entries), [query, entries]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    function onOpenEvent() { setOpen(true); }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("gb2g:open-palette", onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("gb2g:open-palette", onOpenEvent);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      // Focus after the overlay mounts.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => { setActiveIndex(0); }, [query]);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  function onInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { setOpen(false); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, results.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); return; }
    if (e.key === "Enter" && results[activeIndex]) { e.preventDefault(); go(results[activeIndex].href); }
  }

  if (!open) return null;

  return (
    <div className="palette-overlay" onClick={() => setOpen(false)}>
      <div className="palette" role="dialog" aria-label="Command palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Jump to a client, agent, or page…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKeyDown}
          aria-label="Search"
        />
        <div className="palette-list">
          {results.length === 0 && <div className="palette-empty">No matches</div>}
          {results.map((r, i) => (
            <div
              key={r.id}
              className={`palette-item${i === activeIndex ? " is-active" : ""}`}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => go(r.href)}
            >
              <span className="palette-item-glyph">{r.glyph}</span>
              <span className="palette-item-title">{r.title}</span>
              {r.subtitle && <span className="palette-item-sub">{r.subtitle}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
