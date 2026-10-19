import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { expect, it, vi } from "vitest";
import { AdmissionDetails } from "@/features/catalog/admission-details";
import type { CatalogProgram } from "@/features/catalog/model";
import type { ProgramAdmissionData } from "@/features/catalog/admission-model";

const { loadAdmission } = vi.hoisted(() => ({ loadAdmission: vi.fn() }));
vi.mock("@/features/catalog/admission-api", () => ({ getProgramAdmission: loadAdmission }));

it("shows an explicit BVI result as admission without exams, rather than an unpublished score", async () => {
  const program = {
    external_key: "program:bvi", code: "09.03.04-01", name: "Программная инженерия",
    direction_key: "direction:09.03.04", directionCode: "09.03.04",
    departments: [], departmentStatus: "not_stated", sources: [],
  } as unknown as CatalogProgram;
  const data: ProgramAdmissionData = {
    releaseKey: "release:bvi", campaigns: [{
      external_key: "campaign:2026", campaign_kind: "admission", year: 2026,
      university_key: "bmstu", title: "Приём 2026", campus_status: "verified",
    }], offerings: [], pools: [], quotas: [], calendar: [], history: [], tuition: [], requirements: [],
    campaignStatistics: [{
      external_key: "stat:bvi", statistic_kind: "admission_list", ingested_at: "2026-10-01T00:00:00Z",
      direction_code: "09.03.04", year: 2026, funding_type: "budget", admission_stage: "first",
      competition_type: "bvi", status: "bvi", score: null, scope_type: "direction",
    }],
  };
  loadAdmission.mockResolvedValue(data);
  render(<AdmissionDetails program={program} expectedReleaseKey="release:bvi" />);
  expect(await screen.findByText("БВИ — без вступительных испытаний")).toBeVisible();
  expect(screen.queryByText("Числовой балл не опубликован")).not.toBeInTheDocument();
});
