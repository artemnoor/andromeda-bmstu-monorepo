import { describe, expect, it } from "vitest";
import { buildDonutSegments } from "@/features/comparison/chart-data";

describe("comparison chart data", () => {
  it("keeps each category arc proportional to all known program hours", () => {
    const circumference = 2 * Math.PI * 75;
    const categories = [
      { code: "math", hours: { value: 25, count: 2 } },
      { code: "physics", hours: { value: 50, count: 3 } },
      { code: "unclassified", hours: undefined },
    ] as const;

    const segments = buildDonutSegments(categories, (category) => category.hours, 100, circumference);
    const mathematics = segments[0];
    const physics = segments[1];

    expect(segments.map(({ category }) => category.code)).toEqual(["math", "physics"]);
    if (!mathematics || !physics) throw new Error("Expected two classified chart segments.");
    expect(mathematics.length).toBeCloseTo(circumference * .25, 8);
    expect(mathematics.offset).toBe(0);
    expect(physics.length).toBeCloseTo(circumference * .5, 8);
    expect(physics.offset).toBeCloseTo(circumference * .25, 8);
    expect(physics.offset + physics.length).toBeCloseTo(circumference * .75, 8);
  });

  it("retains confirmed zero workload and ignores unknown or unusable chart totals", () => {
    const categories = [
      { code: "zero", hours: { value: 0, count: 1 } },
      { code: "unknown", hours: undefined },
    ] as const;
    const circumference = 2 * Math.PI * 75;

    expect(buildDonutSegments(categories, (category) => category.hours, 10, circumference)).toEqual([
      { category: categories[0], value: { value: 0, count: 1 }, length: 0, offset: 0 },
    ]);
    expect(buildDonutSegments(categories, (category) => category.hours, 0, circumference)).toEqual([]);
    expect(buildDonutSegments(categories, (category) => category.hours, 10, 0)).toEqual([]);
  });
});
