export type Cadence = "monthly" | "one_time" | "hourly";

export function formatAmount(cents: number): string {
  const dollars = cents / 100;
  return dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function cadenceLabel(cadence: Cadence): string {
  switch (cadence) {
    case "monthly":   return "per month";
    case "one_time":  return "as a one-time fee";
    case "hourly":    return "per hour";
  }
}
