import { loadProgramComparison } from "@/features/comparison/api";
import { comparisonReport } from "@/shared/sharing/report-model";
import { ACTIVITY_OPTIONS, NO_AVOID, UNKNOWN_INTEREST, type CareerTestAnswers, type RankedCareerProfile } from "./model";
import type { ProfTestData } from "./api";
import { categoryPresentation } from "./presentation";

export async function profTestReport(data: ProfTestData, answers: CareerTestAnswers, ranked: readonly RankedCareerProfile[], link: string) {
  const comparison = await loadProgramComparison(ranked.slice(0, 3).map(r => r.profile.program.external_key), new AbortController().signal);
  if (comparison.releaseKey !== data.releaseKey) throw new Error("Release changed while exporting result");
  const report = comparisonReport(comparison, link);
  const names = (codes: readonly string[]) => codes.flatMap(code => {
    const category = data.categories.find(c => c.code === code);
    return category ? [categoryPresentation(category).title] : [];
  }).join(", ");
  report.title = "Результат профориентационного теста";
  report.filename = "andromeda-prof-test.pdf";
  report.result = {
    preferences: [
      ["Что интересно", names(answers.interests.filter(c => c !== UNKNOWN_INTEREST)) || "Интересы уточнялись в сравнениях"],
      ["Как учиться", ACTIVITY_OPTIONS.find(o => o.key === answers.activity)?.title || "Без предпочтения"],
      ["Хотелось бы меньше", names(answers.avoid.filter(c => c !== NO_AVOID)) || "Без ограничений"],
    ],
    recommendations: ranked.slice(0, 5).map(r => ({ code: r.profile.program.code || "Код не указан", name: r.profile.program.name, score: r.score })),
  };
  return report;
}
