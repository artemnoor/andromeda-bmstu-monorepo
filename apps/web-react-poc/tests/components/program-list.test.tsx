import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogProgram } from "@/features/catalog/model";
import { ProgramList } from "@/features/catalog/program-list";

const programs: CatalogProgram[] = Array.from({ length: 152 }, (_, index) => ({
  external_key: `program:${index}`, code: `code:${index}`, name: `Программа ${index}`,
  direction_key: "direction:test", directionCode: "01.03.02", directionName: "Математика",
  campus_status: "not_stated", departments: [], departmentCode: null, departmentName: null,
  departmentStatus: "not_stated", sourceUrl: null,
}));
const onSelectionLimit = vi.fn();
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;

function advanceFrame() {
  const pending = [...frames.values()];
  frames.clear();
  act(() => pending.forEach((callback) => callback(performance.now())));
}
function list(items: readonly CatalogProgram[]) {
  return <MemoryRouter><ProgramList programs={items} expectedReleaseKey="release:test" onSelectionLimit={onSelectionLimit} /></MemoryRouter>;
}

describe("progressive catalog", () => {
  beforeEach(() => {
    frames = new Map(); nextFrame = 0; localStorage.clear();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { const id = ++nextFrame; frames.set(id, callback); return id; });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("yields between batches and eventually presents every verified result in its original order", () => {
    const { container } = render(list(programs));
    expect(screen.getAllByRole("article")).toHaveLength(12);
    for (let frame = 0; frame < 20 && frames.size; frame += 1) advanceFrame();
    expect([...container.querySelectorAll("article")].map((card) => card.getAttribute("data-program-key"))).toEqual(programs.map((program) => program.external_key));
    expect(container.querySelector('[aria-busy="false"]')).toBeInTheDocument();
  });

  it("cancels stale batches when filters change and restores the full result after clearing", () => {
    const { rerender } = render(list(programs));
    advanceFrame();
    const filtered = programs.slice(-5);
    rerender(list(filtered));
    expect(screen.getAllByRole("article")).toHaveLength(5);
    advanceFrame();
    expect(screen.getAllByRole("article")).toHaveLength(5);
    rerender(list(programs));
    for (let frame = 0; frame < 20 && frames.size; frame += 1) advanceFrame();
    expect(screen.getAllByRole("article")).toHaveLength(152);
  });
});
