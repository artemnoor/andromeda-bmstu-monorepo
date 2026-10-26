import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogProgram } from "@/features/catalog/model";
import type { AdmissionSummary } from "@/features/catalog/admission-model";
import { AdmissionDetails } from "@/features/catalog/admission-details";
import { ProgramCard } from "@/features/catalog/program-card";
import { AdmissionPlacesTable } from "@/features/catalog/admission-facts";

const mocks = vi.hoisted(() => ({ load: vi.fn(), summary: vi.fn() }));
vi.mock("@/features/catalog/admission-api", () => ({ getProgramAdmission: mocks.load }));
vi.mock("@/features/catalog/admission-model", () => ({ buildAdmissionSummary: mocks.summary }));

const program: CatalogProgram = {
  code: "01.03.02-01", external_key: "program:one", name: "Программа",
  direction_key: "direction:one", campus_status: "not_stated",
  directionCode: "01.03.02", directionName: "Математика", departmentCode: null,
  departmentName: null, departments: [], departmentStatus: "not_stated", sourceUrl: null,
};

const summary: AdmissionSummary = {
  year: 2026, directionCode: "01.03.02", seatScope: "программа", seatNote: null,
  seats: [
    { label: "Бюджет · общий конкурс", value: "0 мест", note: null, sourceUrl: null },
    { label: "Платное · общий конкурс", value: "—", note: null, sourceUrl: null },
  ],
  relatedSeatFacts: [{ key: "offering:unresolved", fundingType: "paid", sourceProgramName: "Название в документе", departmentCode: "ФН3", value: "37 мест", note: null, sourceUrl: "https://bmstu.example/source" }],
  quotas: [], directionQuotas: [], quotaNote: null, historyScope: "направление", history: [], requirements: [], requirementsNote: null,
  campaignResults: [{ year: 2026, stage: "main", competitionType: "general", status: "numeric", funding: "budget", score: 288, admittedCount: null, snapshotDate: null, scopeType: "direction", scopeLabel: null, scopeNote: "Направление 01.03.02", sourceUrl: "https://bmstu.example/score" }],
  officialPassingScores: [{ year: 2026, funding: "budget", score: 288, scopeNote: "Направление 01.03.02", sourceUrl: "https://api.www.bmstu.ru/majors/card" }],
  historicalResults: [], offers: [], tuition: [], dates: [],
};

describe("catalog admission reliability", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.load.mockReset();
    mocks.summary.mockReset().mockReturnValue(summary);
  });
  afterEach(cleanup);

  it("cancels admission requests when the expanded details unmount", () => {
    mocks.load.mockImplementation(() => new Promise(() => undefined));
    const view = render(<AdmissionDetails program={program} expectedReleaseKey="release:one" />);
    const signal = mocks.load.mock.calls[0]?.[1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    view.unmount();
    expect(signal.aborted).toBe(true);
  });

  it("retries a transient failure with a fresh signal and shows the completed result", async () => {
    mocks.load.mockRejectedValueOnce(new Error("network failed")).mockResolvedValueOnce({ releaseKey: "release:one" });
    render(<AdmissionDetails program={program} expectedReleaseKey="release:one" />);
    fireEvent.click(await screen.findByRole("button", { name: "Повторить загрузку" }));
    expect(await screen.findByText("288 баллов")).toBeVisible();
    expect(mocks.load).toHaveBeenCalledTimes(2);
    const first = mocks.load.mock.calls[0]?.[1].signal as AbortSignal;
    const second = mocks.load.mock.calls[1]?.[1].signal as AbortSignal;
    expect(first.aborted).toBe(true);
    expect(second).not.toBe(first);
    expect(second.aborted).toBe(false);
  });

  it("shows scores by year without plan cards, admitted counts, or averages", async () => {
    mocks.load.mockResolvedValue({ releaseKey: "release:one" });
    render(<AdmissionDetails program={program} expectedReleaseKey="release:one" />);
    expect(await screen.findByText("288 баллов")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Проходные баллы · 2025" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Проходные баллы · 2026" })).toBeVisible();
    expect(screen.getByText(/Направление 01.03.02/)).toBeVisible();
    expect(screen.queryByText("0 мест")).not.toBeInTheDocument();
    expect(screen.queryByText("Иное название в приёмном плане")).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Средний" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Источник ↗" }).map((link) => link.getAttribute("href"))).toEqual([
      "https://bmstu.ru/bachelor/majors/card",
    ]);
  });

  it("does not invent a Moscow campus for an unverified program", () => {
    render(<MemoryRouter><ProgramCard program={program} expectedReleaseKey="release:one" onSelectionLimit={() => undefined} /></MemoryRouter>);
    expect(screen.getByText("МГТУ им. Н. Э. Баумана · кампус не подтверждён")).toBeVisible();
    expect(screen.queryByText("МГТУ им. Н. Э. Баумана · Москва")).not.toBeInTheDocument();
  });

  it("opens a separate program page instead of fetching an inline admission panel", () => {
    render(<MemoryRouter initialEntries={["/programs?department=ИУ7"]}><ProgramCard program={program} expectedReleaseKey="release:one" onSelectionLimit={() => undefined} /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Подробнее ↗" })).toHaveAttribute("href", expect.stringMatching(/^\/programs\/01\.03\.02-01-[a-z0-9]+$/));
    expect(screen.queryByRole("button", { name: "Подробнее" })).not.toBeInTheDocument();
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("shows verified zero separately from unknown seats and unrelated source rows", () => {
    render(<AdmissionPlacesTable columns={[{ key: program.external_key, label: program.code, program, summary }]} year={2026} />);
    const table = screen.getByRole("table");
    expect(within(table).getByText("0 мест")).toBeVisible();
    expect(within(table).getByText("Не подтверждено")).toBeVisible();
    expect(within(table).queryByText("37 мест")).not.toBeInTheDocument();
    const related = screen.getByRole("complementary", { name: "Связанные строки плана приёма" });
    expect(within(related).getByText(/37 мест/)).toBeVisible();
    expect(within(related).getByText(/Связь с выбранным профилем не подтверждена/)).toBeVisible();
    expect(within(related).getByRole("link", { name: "Источник ↗" })).toHaveAttribute("href", "https://bmstu.example/source");
  });
});
