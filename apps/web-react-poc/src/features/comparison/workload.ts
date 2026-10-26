import type { components } from "@/shared/api/schema";

type Item = components["schemas"]["CurriculumItemRecord"];

export function generalEducationCategory(item: Item): string | null {
  const title = (item.discipline_name ?? "").toLocaleLowerCase("ru");
  if (item.general_education_category === "physical_education" || (title.includes("физическ") && title.includes("культур"))) return "Физическая культура и спорт";
  if (item.general_education_category === "choice_unresolved") return "Дисциплины по выбору";
  return null;
}

export function isAdditionalWorkload(item: Item): boolean {
  return item.workload_scope === "optional" || item.workload_scope === "non_credit"
    || (generalEducationCategory(item) === "Физическая культура и спорт" && Number(item.credits ?? 0) === 0);
}

export function contributesToProfessionalProfile(item: Item): boolean {
  return !isAdditionalWorkload(item) && generalEducationCategory(item) === null;
}
