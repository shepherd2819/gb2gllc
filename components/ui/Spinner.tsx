import { cn } from "./cn";

export function Spinner({
  size = "md",
  className,
  label = "Loading",
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
  label?: string;
}) {
  return (
    <span
      className={cn("ds-spinner", size !== "md" && `ds-spinner--${size}`, className)}
      role="status"
      aria-label={label}
    />
  );
}
