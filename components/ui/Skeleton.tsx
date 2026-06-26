import { type HTMLAttributes } from "react";
import { cn } from "./cn";

/** Base shimmer block. Pass width/height via style or className. */
export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("skel", className)} aria-hidden {...rest} />;
}

export function SkeletonText({
  width = "100",
  className,
}: {
  width?: "40" | "60" | "80" | "100";
  className?: string;
}) {
  return <div className={cn("skel", "skel-text", `w-${width}`, className)} aria-hidden />;
}

export function SkeletonStat({ className }: { className?: string }) {
  return <div className={cn("skel", "skel-stat", className)} aria-hidden />;
}

export function SkeletonCard({ className }: { className?: string }) {
  return <div className={cn("skel", "skel-card", className)} aria-hidden />;
}

export function SkeletonRow({ className }: { className?: string }) {
  return <div className={cn("skel", "skel-row", className)} aria-hidden />;
}
