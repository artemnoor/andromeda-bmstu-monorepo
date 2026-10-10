import type { NullableMetric } from "./model";

export interface DonutSegment<TCategory> {
  readonly category: TCategory;
  readonly value: NullableMetric;
  readonly length: number;
  readonly offset: number;
}

/**
 * Maps confirmed category-hour sums to SVG arc lengths against the program's
 * full known-hours total. Unclassified hours therefore remain visible as an
 * unfilled portion of the track instead of being renormalized into categories.
 */
export function buildDonutSegments<TCategory>(
  categories: readonly TCategory[],
  hoursFor: (category: TCategory) => NullableMetric | undefined,
  totalHours: number,
  circumference: number,
): readonly DonutSegment<TCategory>[] {
  if (!Number.isFinite(totalHours) || totalHours <= 0 || !Number.isFinite(circumference) || circumference <= 0) return [];

  const segments: DonutSegment<TCategory>[] = [];
  let offset = 0;
  for (const category of categories) {
    const value = hoursFor(category);
    if (!value || value.count <= 0) continue;
    const length = circumference * (value.value / totalHours);
    segments.push({ category, value, length, offset });
    offset += length;
  }
  return segments;
}
