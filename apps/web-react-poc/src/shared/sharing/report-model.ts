import type { LoadedProgramComparison } from "@/features/comparison/api";
import { colorFor, SERIES_COLORS } from "@/features/comparison/presentation";
import { programDepartment } from "@/features/catalog/program-identity";
import { ENROLLMENT_ROWS, SCORE_ROWS, enrollmentCell, scoreCell } from "@/features/catalog/admission-table-model";
import { publicSourceUrl } from "@/shared/links/public-source-url";

export interface PdfSection { title: string; columns: string[]; rows: string[][]; note?: string; links?: { row: number; column: number; url: string }[] }
export interface PdfProgram { code: string; name: string; department: string; color: string; status: string; hours: number | null; credits: number | null; subjects: number | null }
export interface PdfCategory { name: string; color: string; values: (number | null)[] }
export interface PdfSemester { label: string; values: (number | null)[] }
export interface PdfResult { preferences: string[][]; recommendations: { code: string; name: string; score: number }[] }
export interface PdfReport {
  title: string; description: string; link: string; releaseKey: string; sections: PdfSection[]; filename: string;
  programs: PdfProgram[]; categories: PdfCategory[]; semesters: PdfSemester[]; result?: PdfResult;
}

export function comparisonReport(data: LoadedProgramComparison, link: string): PdfReport {
  const labels = data.programs.map(p => p.code || p.name);
  const sections: PdfSection[] = [];
  const sources = new Map<string, string>();
  const addSource = (url: string | null | undefined, label?: string) => {
    const value = publicSourceUrl(url);
    if (!value) return;
    const parsed = new URL(value);
    const filename = parsed.pathname.split("/").at(-1) ?? "";
    sources.set(value, label ?? sources.get(value) ?? (filename.endsWith(".pdf") ? `Приказ о зачислении · ${filename}` : `Официальные данные · ${parsed.hostname}`));
  };
  const years = [...new Set([...data.admission.values()].flatMap(a => a.year === null ? [] : [a.year]))].sort();
  for (const year of years) {
    let orderFallback = false;
    sections.push({ title: `Поступление · ${year}`, columns: ["Показатель", ...labels], rows: [
      ...SCORE_ROWS.map(row => ["Проходной · " + row.label, ...data.programs.map(p => {
        const cell = scoreCell(data.admission.get(p.external_key), year, row);
        addSource(cell.sourceUrl); addSource(cell.bviSourceUrl);
        const fromOrder = cell.kind === "score" && /приказ/i.test(cell.note ?? "");
        orderFallback ||= fromOrder;
        return cell.value + (fromOrder ? " *" : "");
      })]),
      ...ENROLLMENT_ROWS.map(row => ["Зачислено · " + row.label, ...data.programs.map(p => {
        const cell = enrollmentCell(data.admission.get(p.external_key), year, row);
        cell.sourceUrls.forEach(url => addSource(url)); return cell.value;
      })]),
    ], note: "Баллы и зачисление относятся ко всему направлению, включая его профили. Квоты входят в бюджетный итог. БВИ — зачисление без вступительных испытаний; оно не является числовым проходным баллом." + (orderFallback ? " * Минимальная сумма баллов по подтверждённому основному приказу; проверь источник." : "") });
  }
  sections.push({ title: "Экзамены и стоимость", columns: ["Показатель", ...labels], rows: [
    ["Экзамены и минимумы", ...data.programs.map(p => {
      const a = data.admission.get(p.external_key);
      a?.requirements.forEach(r => r.sourceUrls.forEach(url => addSource(url)));
      return a ? a.requirements.map(r => `${r.category}: ${r.text}`).join("\n") || a.requirementsNote || "Не опубликовано" : "Не удалось загрузить";
    })],
    ["Места", ...data.programs.map(p => {
      const a = data.admission.get(p.external_key); a?.seats.forEach(s => addSource(s.sourceUrl));
      return a ? a.seats.map(s => `${s.label}: ${s.value}${s.note ? ` (${s.note})` : ""}`).join("\n") || a.seatNote || "Не опубликовано" : "Не удалось загрузить";
    })],
    ["Стоимость", ...data.programs.map(p => {
      const a = data.admission.get(p.external_key); a?.tuitionFacts?.forEach(f => addSource(f.sourceUrl));
      return a ? a.tuitionFacts?.map(f => [f.value, f.note].filter(Boolean).join(" · ")).join("\n") || "Не опубликовано" : "Не удалось загрузить";
    })],
  ], note: "Минимальный балл по экзамену нужен для допуска к конкурсу и не гарантирует поступление. Условия и стоимость сверяй по источникам университета." });
  const programs: PdfProgram[] = data.programs.map((p, index) => {
    const plan = data.curriculum.programs.find(c => c.programKey === p.external_key);
    const available = plan?.itemsStatus === "loaded" && plan.planSelection.status === "ready";
    return { code: p.code || "Код не указан", name: p.name, department: programDepartment(p), color: SERIES_COLORS[index % SERIES_COLORS.length]!,
      status: !plan || plan.itemsStatus === "unavailable" ? "Состав плана не загрузился" : plan.planSelection.status === "ready" ? "Подтверждённый учебный план" : plan.planSelection.status === "missing" ? "План не опубликован" : "Версия плана требует проверки",
      hours: available && plan.total.hours.count ? plan.total.hours.value : null,
      credits: available && plan.total.credits.count ? plan.total.credits.value : null,
      subjects: available ? plan.items.length : null,
    };
  });
  const categoryMap = new Map<string, { key: string; name: string; code: string | null }>([
    ...data.curriculum.taxonomyCategories.map(c => [`code:${c.category_code}`, { key: `code:${c.category_code}`, name: c.name, code: c.category_code }] as const),
    ...data.curriculum.programs.flatMap(p => p.categories.map(c => [c.key, { key: c.key, name: c.name, code: c.categoryCode }] as const)),
  ]);
  const ordered = [...categoryMap.values()].sort((a, b) => a.code === null ? (b.code === null ? a.name.localeCompare(b.name, "ru") : 1) : b.code === null ? -1 : Number(a.code) - Number(b.code));
  const categories: PdfCategory[] = data.taxonomyUnavailable ? [] : ordered.map((c, index) => ({ name: c.name, color: c.code === null ? "#b9c3cf" : colorFor(index), values: data.programs.map(p => {
    const plan = data.curriculum.programs.find(v => v.programKey === p.external_key);
    if (!plan || plan.itemsStatus !== "loaded" || plan.planSelection.status !== "ready") return null;
    const metric = plan.categories.find(v => v.key === c.key)?.hours;
    if (metric?.count) return metric.value;
    return !metric && plan.items.length > 0 && plan.items.every(item => item.classification !== null || Boolean(item.generalCategory)) && plan.total.hours.count > 0 ? 0 : null;
  }) }));
  const remainder = programs.map((p, i) => p.hours === null ? null : Math.max(0, p.hours - categories.reduce((sum, c) => sum + (c.values[i] ?? 0), 0)));
  if (!data.taxonomyUnavailable && remainder.some(v => v !== null && v > 0)) categories.push({ name: "Часы вне подтверждённых категорий", color: "#b9c3cf", values: remainder });
  const semesterMap = new Map(data.curriculum.programs.flatMap(p => p.semesters.map(s => [s.key, s] as const)));
  const semesters = [...semesterMap.values()].sort((a, b) => (a.semester ?? 999) - (b.semester ?? 999)).map(s => ({ label: s.semester === null ? "Не указан" : `${s.semester} семестр`, values: data.programs.map(p => {
    const plan = data.curriculum.programs.find(c => c.programKey === p.external_key);
    const metric = plan?.semesters.find(v => v.key === s.key)?.hours;
    return plan?.itemsStatus === "loaded" && plan.planSelection.status === "ready" && metric?.count ? metric.value : null;
  }) }));
  data.programs.forEach(p => { addSource(p.sourceUrl, `Карточка направления ${p.directionCode ?? p.code}`); addSource(p.study_plan_url, `Учебный план ${p.code}`); });
  data.curriculum.programs.forEach(p => p.planSelection.currentPlan?.sources?.forEach(s => addSource(s.source_url)));
  sections.push({ title: "Источники и полные планы", columns: ["№", "Нажми на документ, чтобы открыть источник"], rows: [...sources].map(([, label], i) => [String(i + 1), label]), links: [...sources.keys()].map((url, row) => ({ row, column: 1, url })), note: `Полные списки дисциплин и интерактивные диаграммы доступны по ссылке внизу каждой страницы. PDF сохраняет данные на дату скачивания. Академический выпуск: ${data.releaseKey}.` });
  return { title: "Сравнение образовательных программ", description: "МГТУ имени Н. Э. Баумана · Андромеда", link, releaseKey: data.releaseKey, sections, programs, categories, semesters, filename: "andromeda-comparison.pdf" };
}
