import type { components } from "@/shared/api/schema";

export type ProgramDto = components["schemas"]["EducationalProgramRecord"];
export type DirectionDto = components["schemas"]["DirectionRecord"];
export type DepartmentDto = components["schemas"]["DepartmentRecord"];

export interface CatalogDepartment {
  readonly externalKey: string;
  readonly code: string | null;
  readonly name: string;
}

export type CatalogProgram = ProgramDto & {
  directionCode: string | null;
  directionName: string | null;
  departmentCode: string | null;
  departmentName: string | null;
  departments: readonly CatalogDepartment[];
  departmentStatus: "verified" | "unresolved" | "not_stated";
  sourceUrl: string | null;
};

export type FilterOption = { value: string; label: string };

function clean(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

export function safeExternalUrl(value: string | null | undefined): string | null {
  const candidate = clean(value);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function firstSourceUrl(value: { sources?: Array<{ source_url?: string | null }> }): string | null {
  return value.sources?.map((source) => safeExternalUrl(source.source_url)).find(Boolean) ?? null;
}

export function normalizeCatalogProgram(
  program: ProgramDto,
  directions: ReadonlyMap<string, DirectionDto>,
  departments: ReadonlyMap<string, DepartmentDto>,
): CatalogProgram {
  const direction = directions.get(program.direction_key);
  const relations = program.department_relations ?? [];
  const resolvedDepartments = new Map<string, CatalogDepartment>();
  for (const relation of relations) {
    if (relation.verification_status !== "verified") continue;
    const department = departments.get(relation.department_key);
    if (!department) continue;
    resolvedDepartments.set(relation.department_key, {
      externalKey: relation.department_key,
      code: department.official_code ?? null,
      name: department.name,
    });
  }
  const linkedDepartments = [...resolvedDepartments.values()];
  const singleDepartment = linkedDepartments.length === 1 ? linkedDepartments[0] : undefined;

  return {
    ...program,
    directionCode: direction?.code ?? null,
    directionName: direction?.name ?? null,
    departmentCode: singleDepartment?.code ?? null,
    departmentName: singleDepartment?.name ?? null,
    departments: linkedDepartments,
    departmentStatus: linkedDepartments.length > 0
      ? "verified"
      : relations.length > 0
        ? "unresolved"
        : "not_stated",
    sourceUrl: firstSourceUrl(program),
  };
}

export function getCatalogOptions(programs: readonly CatalogProgram[]): {
  directions: FilterOption[];
  departments: FilterOption[];
} {
  const directions = new Map<string, string>();
  const departments = new Map<string, string>();
  for (const program of programs) {
    if (program.directionCode) {
      directions.set(program.directionCode, program.directionName || program.directionCode);
    }
    for (const department of program.departments) {
      if (department.code) departments.set(department.code, department.name || department.code);
    }
  }
  const toOptions = (values: Map<string, string>) => [...values]
    .sort(([left], [right]) => left.localeCompare(right, "ru"))
    .map(([value, name]) => ({ value, label: `${value} · ${name}` }));
  return { directions: toOptions(directions), departments: toOptions(departments) };
}

export function filterPrograms(
  programs: readonly CatalogProgram[],
  filters: { query?: string; directionCode?: string; departmentCode?: string },
): CatalogProgram[] {
  const query = clean(filters.query).toLocaleLowerCase("ru-RU");
  return programs.filter((program) => {
    if (filters.directionCode && program.directionCode !== filters.directionCode) return false;
    if (filters.departmentCode && !program.departments.some((department) => department.code === filters.departmentCode)) return false;
    if (!query) return true;
    return [
      program.name,
      program.code,
      program.description,
      program.directionName,
      program.directionCode,
      ...program.departments.flatMap((department) => [department.name, department.code]),
    ].some((value) => clean(value).toLocaleLowerCase("ru-RU").includes(query));
  });
}

export function russianPlural(count: number, forms: readonly [string, string, string]): string {
  const absolute = Math.abs(count) % 100;
  const last = absolute % 10;
  if (absolute > 10 && absolute < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  return last === 1 ? forms[0] : forms[2];
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}
