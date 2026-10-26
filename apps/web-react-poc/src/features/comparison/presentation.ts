import type { NullableMetric } from "./model";

export const SERIES_COLORS = ["#8dedf9", "#d9b8fe", "#edcf96"] as const;
const CATEGORY_COLORS = [
  "#8dedf9", "#a5d6b2", "#edcf96", "#d9b8fe", "#e9a4b0", "#79b8ca", "#adb7cd", "#bdd58e",
  "#e8ae83", "#93adf0", "#dda2d3", "#c9cb91", "#90bfdc", "#d2b19b", "#b5a6cf", "#8ec5b7",
] as const;

export function colorFor(index: number): string {
  return CATEGORY_COLORS[index % CATEGORY_COLORS.length] ?? CATEGORY_COLORS[0];
}

export function formatMetric(metric: NullableMetric, unit: string): string {
  if (metric.count === 0) return "—";
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: unit === "з.е." ? 1 : 0 }).format(metric.value)} ${unit}`;
}
