import type { ComparisonCurriculumItem, ProgramComparisonModel } from "./model";
import styles from "./comparison.module.css";

export function MatrixCourseEntry({ item }: { item: ComparisonCurriculumItem }) {
  const category = item.generalCategory ?? item.classification?.categoryName ?? "Категория не указана";
  const details = [
    item.semester === null ? "Семестр не указан" : `${item.semester} семестр`,
    item.credits === null ? null : `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(item.credits)} з.е.`,
    item.hours === null ? null : `${new Intl.NumberFormat("ru-RU").format(item.hours)} ч.`,
    item.assessmentType,
  ].filter((value): value is string => Boolean(value));
  return <div className={styles.courseEntry}><span className={styles.courseCategory}>{category}</span><span className={styles.courseMeta}>{details.join(" · ")}</span></div>;
}

export function MatrixMissingCell({ program }: { program: ProgramComparisonModel }) {
  const status = program.itemsStatus === "unavailable" ? "Состав плана недоступен"
    : program.planSelection.status === "ready" ? "Нет позиции с таким названием в подтверждённом плане"
      : program.planSelection.status === "ambiguous" ? "Версия учебного плана не сопоставлена"
        : program.planSelection.status === "needs-review" ? "Текущая версия требует проверки"
          : "Учебный план не опубликован";
  return <span className={styles.matrixMissing}>{status}</span>;
}
