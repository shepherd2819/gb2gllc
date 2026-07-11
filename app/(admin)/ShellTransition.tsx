// app/(admin)/ShellTransition.tsx
"use client";
import { ViewTransition } from "react";
import { usePathname } from "next/navigation";

// Keyed on pathname so every route change remounts the boundary, which is
// what activates enter/exit. Only navigations tagged 'nav-section' (sidebar
// links) animate; everything else maps to 'none'.
export function ShellTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <ViewTransition
      key={pathname}
      enter={{ "nav-section": "shell-section", default: "none" }}
      exit={{ "nav-section": "shell-section", default: "none" }}
      default="none"
    >
      {children}
    </ViewTransition>
  );
}
