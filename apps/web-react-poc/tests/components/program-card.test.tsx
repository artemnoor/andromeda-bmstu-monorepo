import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogProgram } from "@/features/catalog/model";
import { ProgramCard } from "@/features/catalog/program-card";
import { STORAGE_KEYS } from "@/shared/browser-state/storage";

vi.mock("@/features/catalog/admission-api", () => ({
  getProgramAdmission: vi.fn().mockResolvedValue({
    releaseKey: "release:test",
    campaigns: [],
    offerings: [],
    calendar: [],
    pools: [],
    quotas: [],
    requirements: [],
    history: [],
    campaignStatistics: [],
    tuition: [],
  }),
}));

const program: CatalogProgram = {
  code: "01.03.02",
  external_key: "program:bmstu:01.03.02:ИУ9",
  name: "Прикладная математика и информатика",
  direction_key: "direction:bmstu:01.03.02",
  campus_status: "not_stated",
  directionCode: "01.03.02",
  directionName: "Прикладная математика и информатика",
  departmentCode: null,
  departmentName: null,
  departments: [],
  departmentStatus: "not_stated",
  sourceUrl: null,
};

function CardHarness() {
  const [feedback, setFeedback] = useState("");
  return (
    <MemoryRouter>
      <ProgramCard program={program} expectedReleaseKey="release:test" onSelectionLimit={setFeedback} />
      <p role="status">{feedback}</p>
    </MemoryRouter>
  );
}

describe("program card browser state", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("persists comparison using stable external identity", () => {
    render(<CardHarness />);

    fireEvent.click(screen.getByRole("button", { name: /Сравнить/ }));

    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.compare) ?? "null")).toEqual([program.external_key]);
    expect(screen.getByRole("button", { name: /В сравнении/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("omits direction and department facts when the API does not state them", () => {
    const programWithoutFacts = {
      ...program,
      directionCode: null,
      directionName: null,
      departmentCode: null,
      departmentName: null,
      departmentStatus: "not_stated" as const,
    };
    render(
      <MemoryRouter>
        <ProgramCard program={programWithoutFacts} expectedReleaseKey="release:test" onSelectionLimit={() => undefined} />
      </MemoryRouter>,
    );

    expect(screen.queryByText("Направление")).not.toBeInTheDocument();
    expect(screen.queryByText("Кафедра")).not.toBeInTheDocument();
    expect(screen.queryByText("Не указано")).not.toBeInTheDocument();
  });

  it("persists a favorite from the expanded program details", async () => {
    render(<CardHarness />);

    fireEvent.click(screen.getByText("Прикладная математика и информатика", { selector: "summary h2" }));
    const favorite = await screen.findByRole("button", { name: "♡ Добавить в избранное" });
    fireEvent.click(favorite);

    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.favorites) ?? "null")).toEqual([program.external_key]);
    expect(screen.getByRole("button", { name: "♥ Убрать из избранного" })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows a visible message when browser storage rejects a user action", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    });
    render(<CardHarness />);

    fireEvent.click(screen.getByRole("button", { name: /Сравнить/ }));

    expect(screen.getByRole("status")).toHaveTextContent("Браузер не сохранил сравнение");
  });

  it("keeps the three-program comparison limit and explains a rejected fourth choice", () => {
    const existing = ["program:one", "program:two", "program:three"];
    localStorage.setItem(STORAGE_KEYS.compare, JSON.stringify(existing));
    render(<CardHarness />);

    fireEvent.click(screen.getByRole("button", { name: /Сравнить/ }));

    expect(screen.getByRole("status")).toHaveTextContent("Можно сравнить не более трёх программ");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.compare) ?? "null")).toEqual(existing);
    expect(screen.getByRole("button", { name: /Сравнить/ })).toHaveAttribute("aria-pressed", "false");
  });
});
