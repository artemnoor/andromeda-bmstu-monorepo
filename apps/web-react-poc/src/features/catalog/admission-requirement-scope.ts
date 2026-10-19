import type { ApiSchemas } from "@/shared/api/client";
import type { CatalogProgram } from "./model";

type Requirement = ApiSchemas["RequirementTreeRecord"];
// Appendix 1, verified against the exact retained PDF. Table 1 continues
// from page 1 onto page 2; page 3 table 1 is Kaluga, table 2 is GUIMC.
const APPENDIX_1_SHA256 = "0d1820ede1e3ceaaab7109f3cb32ac723c9b5e3634d68100d74c87e514ed1afd";

export function requirementAdmissionScope(requirement: Requirement): string | null {
  for (const source of [...(requirement.sources ?? []), ...(requirement.root.sources ?? [])]) {
    if (source.sha256 !== APPENDIX_1_SHA256 || !source.locator || typeof source.locator !== "object") continue;
    const { page, table } = source.locator;
    if ((page === 1 || page === 2) && table === 1) return "head_moscow";
    if (page === 2 && table === 2) return "branch_mytishchi";
    if (page === 3 && table === 1) return "branch_kaluga";
    if (page === 3 && table === 2) return "guimc";
  }
  return null;
}

export function requirementMatchesProgramScope(requirement: Requirement, program: CatalogProgram): boolean {
  const scope = requirementAdmissionScope(requirement);
  if (scope === null) return true;
  return program.campus_status === "verified" && scope === program.campus_scope;
}
