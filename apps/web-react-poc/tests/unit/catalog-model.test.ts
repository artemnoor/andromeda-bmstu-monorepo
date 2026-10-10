import { describe, expect, it } from "vitest";
import type { components } from "@/shared/api/schema";
import {
  buildCatalogSearchIndex,
  filterPrograms,
  getCatalogOptions,
  normalizeCatalogProgram,
  safeExternalUrl,
  type CatalogProgram,
} from "@/features/catalog/model";

type ProgramDto = components["schemas"]["EducationalProgramRecord"];
type DirectionDto = components["schemas"]["DirectionRecord"];
type DepartmentDto = components["schemas"]["DepartmentRecord"];

function makeProgram(overrides: Partial<ProgramDto> = {}): ProgramDto {
  return {
    external_key: "program:infosec",
    code: "10.05.01",
    name: "Информационная безопасность",
    direction_key: "direction:infosec",
    campus_status: "not_stated",
    description: "Защита информации и кибербезопасность",
    department_relations: [{ department_key: "department:iu", verification_status: "verified" }],
    sources: [{ source_artifact_key: "source:one", source_url: "https://example.test/program" }],
    ...overrides,
  };
}

const direction: DirectionDto = {
  external_key: "direction:infosec",
  code: "10.05.01",
  name: "Информационная безопасность",
};

const department: DepartmentDto = {
  external_key: "department:iu",
  official_code: "ИУ10",
  name: "Информатика и системы управления",
  campus_status: "not_stated",
};

function normalize(program = makeProgram()): CatalogProgram {
  return normalizeCatalogProgram(
    program,
    new Map([[direction.external_key, direction]]),
    new Map([[department.external_key, department]]),
  );
}

describe("catalog model", () => {
  it("joins directions and only verified departments by exact external key", () => {
    const result = normalize(makeProgram({
      department_relations: [
        { department_key: "department:iu", verification_status: "manual_review" },
      ],
    }));
    expect(result.directionCode).toBe("10.05.01");
    expect(result.departmentStatus).toBe("unresolved");
    expect(result.departmentCode).toBeNull();
    expect(getCatalogOptions([result]).departments).toEqual([]);
  });

  it("uses a verified exact department relation and source-backed URL", () => {
    const result = normalize();
    expect(result.departmentCode).toBe("ИУ10");
    expect(result.departmentName).toBe("Информатика и системы управления");
    expect(result.sourceUrl).toBe("https://example.test/program");
    expect(getCatalogOptions([result]).departments).toEqual([{
      value: "ИУ10",
      label: "ИУ10 · Информатика и системы управления",
    }]);
  });

  it("keeps every verified department relation without choosing an implicit primary", () => {
    const secondDepartment: DepartmentDto = {
      external_key: "department:iu2",
      official_code: "ИУ2",
      name: "Информатика и системы управления",
      campus_status: "not_stated",
    };
    const result = normalizeCatalogProgram(
      makeProgram({
        department_relations: [
          { department_key: "department:iu", verification_status: "verified" },
          { department_key: secondDepartment.external_key, verification_status: "verified" },
        ],
      }),
      new Map([[direction.external_key, direction]]),
      new Map([[department.external_key, department], [secondDepartment.external_key, secondDepartment]]),
    );

    expect(result.departments.map(({ code }) => code)).toEqual(["ИУ10", "ИУ2"]);
    expect(result.departmentCode).toBeNull();
    expect(getCatalogOptions([result]).departments.map(({ value }) => value)).toEqual(["ИУ10", "ИУ2"]);
    expect(filterPrograms([result], { departmentCode: "ИУ2" })).toEqual([result]);
    expect(filterPrograms([result], { query: "ИУ2" })).toEqual([result]);
  });

  it("combines direction and department filters and searches Cyrillic without case sensitivity", () => {
    const first = normalize();
    const second = normalize(makeProgram({
      external_key: "program:mechanics",
      code: "24.05.01",
      name: "Ракетные комплексы",
      direction_key: "direction:mechanics",
      department_relations: [{ department_key: "department:iu", verification_status: "verified" }],
    }));
    expect(filterPrograms([first, second], { query: "КИБЕР", directionCode: "10.05.01", departmentCode: "ИУ10" }))
      .toEqual([first]);
    expect(filterPrograms([first, second], { directionCode: "24.05.01", departmentCode: "ИУ10" })).toEqual([]);
  });

  it("searches by code, partial name, description, direction and verified department", () => {
    const item = normalize();
    for (const query of ["10.05", "безопас", "кибер", "ИУ10", "информатика"]) {
      expect(filterPrograms([item], { query })).toEqual([item]);
    }
    expect(filterPrograms([item], { query: "   " })).toEqual([item]);
    expect(filterPrograms([item], { query: "не существует" })).toEqual([]);
  });

  it("keeps indexed search identical to the unindexed reference for Cyrillic, codes, and field boundaries", () => {
    const first = normalize();
    const mechanicsDirection: DirectionDto = {
      external_key: "direction:mechanics",
      code: "15.03.04",
      name: "Автоматизация технологических процессов",
    };
    const second = normalizeCatalogProgram(
      makeProgram({
        external_key: "program:mechanics",
        code: "24.05.01",
        name: "Ракетные комплексы",
        description: "Проектирование двигателей",
        direction_key: mechanicsDirection.external_key,
        department_relations: [],
      }),
      new Map([[mechanicsDirection.external_key, mechanicsDirection]]),
      new Map(),
    );
    const programs = [first, second];
    const index = buildCatalogSearchIndex(programs);

    for (const query of [
      "КИБЕР",
      "24.05",
      "ракетные",
      "двигателей",
      "технологических процессов",
      "15.03.04",
      "информатика",
      "ИУ10",
      "безопасности",
      "1инф",
      "не существует",
      "   ",
    ]) {
      expect(filterPrograms(programs, { query }, index)).toEqual(filterPrograms(programs, { query }));
    }
  });

  it("does not turn an unresolved department key into a display fact", () => {
    const program = normalizeCatalogProgram(
      makeProgram({ department_relations: [{ department_key: "department:missing", verification_status: "verified" }] }),
      new Map([[direction.external_key, direction]]),
      new Map(),
    );
    expect(program.departmentStatus).toBe("unresolved");
    expect(program.departmentCode).toBeNull();
    expect(program.departmentName).toBeNull();
  });

  it("rejects non-http URLs", () => {
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("data:text/html,hello")).toBeNull();
    expect(safeExternalUrl("https://example.test/a")).toBe("https://example.test/a");
  });
});
