// app/(admin)/CommandPalette.tsx
"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { buildPaletteEntries, rankPalette, type PaletteClient } from "@/lib/palette-search";
import { AGENTS } from "./agents/agents-manifest";

const LISTBOX_ID = "palette-listbox";
const optionId = (entryId: string) => `palette-option-${entryId}`;

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
  // Clamp at render time so a shrinking result set can never leave the
  // highlight (or Enter) pointing past the end of the list.
  const active = results.length === 0 ? -1 : Math.min(Math.max(activeIndex, 0), results.length - 1);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      // Global so Escape closes even when focus is outside the input.
      // Functional no-op when already closed (listener is mount-once).
      if (e.key === "Escape") setOpen((o) => (o ? false : o));
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

  function moveActive(next: number) {
    const target = results[next];
    if (!target) return;
    setActiveIndex(next);
    document.getElementById(optionId(target.id))?.scrollIntoView({ block: "nearest" });
  }

  function onInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); moveActive(Math.min(active + 1, results.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); moveActive(Math.max(active - 1, 0)); return; }
    if (e.key === "Enter" && results[active]) { e.preventDefault(); go(results[active].href); }
  }

  if (!open) return null;

  return (
    <div className="palette-overlay" onClick={() => setOpen(false)}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
        // The input is the dialog's only focusable element — trap Tab/Shift+Tab.
        onKeyDown={(e) => { if (e.key === "Tab") e.preventDefault(); }}
      >
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Jump to a client, agent, or page…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKeyDown}
          aria-label="Search"
          role="combobox"
          aria-expanded="true"
          aria-controls={LISTBOX_ID}
          aria-autocomplete="list"
          aria-activedescendant={results[active] ? optionId(results[active].id) : undefined}
        />
        <div className="palette-list" id={LISTBOX_ID} role="listbox" aria-label="Results">
          {results.length === 0 && <div className="palette-empty">No matches</div>}
          {results.map((r, i) => (
            <div
              key={r.id}
              id={optionId(r.id)}
              role="option"
              aria-selected={i === active}
              className={`palette-item${i === active ? " is-active" : ""}`}
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
