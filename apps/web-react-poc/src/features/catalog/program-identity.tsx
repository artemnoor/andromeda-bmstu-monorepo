import type { CatalogProgram } from "./model";
import styles from "./program-identity.module.css";

export function programDepartment(program: CatalogProgram): string {
  const departments = program.departments.map((item) => [item.code, item.name].filter(Boolean).join(" · "));
  return departments.length ? departments.join("; ") : "Кафедра не подтверждена";
}

export function programIdentityText(program: CatalogProgram): string {
  return [program.code || "Код не указан", program.name || "Название не указано", programDepartment(program)].join("\n");
}

export function ProgramIdentity({ program }: { program: CatalogProgram }) {
  return <span className={styles.identity}>
    <span className={styles.code}>{program.code || "Код не указан"}</span>
    <span className={styles.name}>{program.name || "Название не указано"}</span>
    <span className={styles.department}>{programDepartment(program)}</span>
  </span>;
}
