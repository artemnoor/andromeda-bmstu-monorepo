import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CatalogProgram } from "@/features/catalog/model";
import type { ProfTestData } from "@/features/prof-test/api";
import type { RankedCareerProfile } from "@/features/prof-test/model";
import { ProgramResults } from "@/features/prof-test/program-results";
import { categoryPresentation, matchesProgramSearch } from "@/features/prof-test/presentation";

afterEach(cleanup);

function program(index: number): CatalogProgram {
  return { external_key: `program:${index}`, code: `09.03.01-${index}`, name: `Программа ${index}`, directionCode: "09.03.01", directionName: "Информатика", departmentCode: "ИУ9", departments: [] } as unknown as CatalogProgram;
}
const ranked = Array.from({ length: 25 }, (_, index) => ({ profile: { program: program(index + 1) }, score: 100 - index })) as RankedCareerProfile[];
const unranked = { ...program(26), name: "Новая инженерная программа" };
const data: ProfTestData = { releaseKey: "fixture", programs: [...ranked.map(({ profile }) => profile.program), unranked], categories: [], profiles: ranked.map(({ profile }) => profile), totalCurriculumRows: 0, assignedRows: 0, classifiedRows: 0, reviewRows: 0, unavailableProgramCount: 1 };
function show(hasSignal = true) {
  const toggle = vi.fn();
  render(<MemoryRouter><ProgramResults data={data} ranked={ranked} hasSignal={hasSignal} comparisonKeys={[]} onToggleComparison={toggle} /></MemoryRouter>);
  return toggle;
}

describe("complete career-test results", () => {
  it("lets a user reach every ranked program beyond the initial recommendation cards", () => {
    show();
    const list = screen.getByRole("list", { name: "Все программы с учебными планами" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(12);
    fireEvent.click(screen.getByRole("button", { name: "Показать ещё 12 программ" }));
    expect(screen.getByRole("link", { name: "Программа 13" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Показать ещё 1 программу" }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(25);
    for (const { profile } of ranked) expect(within(list).getByRole("link", { name: profile.program.name! })).toBeVisible();
  });

  it("searches the whole ranking, resets paging, and preserves exact comparison identity", () => {
    const toggle = show();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "09.03.01-25" } });
    const list = screen.getByRole("list", { name: "Все программы с учебными планами" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "В сравнение: Программа 25" }));
    expect(toggle).toHaveBeenCalledWith("program:25", false);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    expect(within(list).getAllByRole("listitem")).toHaveLength(12);
  });

  it("offers catalog access without inventing a score for unavailable plans", () => {
    show();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "новая инженерная" } });
    expect(screen.getByText("Найдено: 1. С учебным планом: 0; без оценки: 1.")).toBeVisible();
    expect(screen.getByRole("link", { name: unranked.name! })).toHaveAttribute("href", "/programs?code=09.03.01-26");
    expect(screen.getByText("Без оценки")).toBeVisible();
    expect(screen.queryByRole("button", { name: /В сравнение/ })).not.toBeInTheDocument();
  });

  it("allows browsing without presenting neutral answers as a personalized fit", () => {
    show(false);
    const list = screen.getByRole("list", { name: "Все программы с учебными планами" });
    expect(within(list).getAllByText("Без оценки")).toHaveLength(12);
    expect(within(list).queryByText(/100/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "несуществующая" } });
    expect(screen.getByText(/Ничего не нашли/)).toBeVisible();
  });

  it("explains canonical categories without remapping unknown category identities", () => {
    expect(categoryPresentation({ code: "03", name: "Информатика, программирование и Computer Science", definition: "", ordinal: 3 }).title).toBe("Программировать");
    expect(categoryPresentation({ code: "03", name: "Другой классификатор", definition: "Его определение", ordinal: 3 })).toEqual({ title: "Другой классификатор", detail: "Его определение" });
    expect(matchesProgramSearch({ ...program(1), name: "Расчётные методы" }, "расчетные иу9")).toBe(true);
  });
});
