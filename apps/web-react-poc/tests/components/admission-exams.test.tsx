import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { AdmissionExams } from "@/features/catalog/admission-facts";
import type { AdmissionSummary } from "@/features/catalog/admission-model";

it("keeps mandatory subjects, one-of alternatives, thresholds and unknown minima distinct", () => {
  const summary = {
    directionCode: "27.03.05",
    requirements: [{
      category: "Все условия", text: "fixture", sourceUrls: [], sourceRecordCount: 1, applicantCategory: null,
      root: { kind: "operator", node_key: "root", operator: "AND", children: [
        { kind: "leaf", node_key: "math", subject_name: "mathematics", minimum_score: "46" },
        { kind: "operator", node_key: "choice", operator: "OR", children: [
          { kind: "leaf", node_key: "physics", subject_name: "physics", minimum_score: "0" },
          { kind: "leaf", node_key: "cs", subject_name: "informatics_and_ict", minimum_score: null },
        ] },
        { kind: "operator", node_key: "threshold", operator: "AT_LEAST", threshold: 2, children: [
          { kind: "leaf", node_key: "rus", subject_name: "russian_language" },
          { kind: "leaf", node_key: "foreign", subject_name: "Иностранный язык" },
        ] },
      ] },
    }],
  } as unknown as AdmissionSummary;
  render(<AdmissionExams summary={summary} />);
  expect(screen.getByText("Все условия обязательны")).toBeVisible();
  const choice = screen.getByText("Один вариант на выбор").parentElement!;
  expect(within(choice).getByText("Физика")).toBeVisible();
  expect(within(choice).getByText("от 0")).toBeVisible();
  expect(within(choice).getByText("Минимум не указан")).toBeVisible();
  expect(screen.getByText("Математика")).toBeVisible();
  expect(screen.getByText("от 46")).toBeVisible();
  expect(screen.getByText("Не менее 2 из списка")).toBeVisible();
});
