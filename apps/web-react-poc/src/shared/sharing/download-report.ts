import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import type { PdfReport, PdfSection } from "./report-model";

const INK = "#171b2e";
const MUTED = "#596273";
const PAPER = "#f5f7fb";
let fonts: Promise<readonly string[]> | undefined;
async function fontData(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("PDF font unavailable");
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
const number = (value: number | null, digits = 0) => value === null ? "—" : new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits }).format(value);

/** All charts are PDF vectors; text remains selectable and legible when zoomed. */
export async function downloadReport(report: PdfReport): Promise<void> {
  fonts ??= Promise.all([fontData("/assets/fonts/NotoSans-Regular.ttf"), fontData("/assets/fonts/NotoSans-Bold.ttf")]).catch(error => { fonts = undefined; throw error; });
  const [normal, bold] = await fonts;
  const doc = new jsPDF({ format: "a4", compress: true, putOnlyUsedFonts: true });
  doc.addFileToVFS("NotoSans-Regular.ttf", normal!); doc.addFont("NotoSans-Regular.ttf", "NotoSans", "normal");
  doc.addFileToVFS("NotoSans-Bold.ttf", bold!); doc.addFont("NotoSans-Bold.ttf", "NotoSans", "bold");
  doc.setProperties({ title: report.title, author: "Андромеда", subject: report.description });
  const date = new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeZone: "Europe/Moscow" }).format(new Date());
  let started = false;
  function lines(text: string, width: number, size = 9, bold = false): string[] {
    doc.setFont("NotoSans", bold ? "bold" : "normal").setFontSize(size);
    return doc.splitTextToSize(text, width) as string[];
  }
  function text(value: string | string[], x: number, y: number, size = 9, bold = false, color = INK) {
    doc.setFont("NotoSans", bold ? "bold" : "normal").setFontSize(size).setTextColor(color);
    doc.text(value, x, y);
  }
  function paragraph(value: string, x: number, y: number, width: number, size = 9, color = MUTED) {
    const wrapped = lines(value, width, size); text(wrapped, x, y, size, false, color);
    return y + wrapped.length * size * .42;
  }
  function page(title: string, kicker: string, hero = false) {
    if (started) doc.addPage(); started = true;
    if (hero) {
      doc.setFillColor(INK).rect(0, 0, 210, 52, "F");
      doc.setFillColor("#d9b8fe").circle(196, 7, 16, "F");
      doc.setFillColor("#8dedf9").circle(185, 31, 5, "F");
      text(kicker, 16, 12, 8, true, "#d9b8fe");
      text(title, 16, 27, 22, true, "#ffffff");
      text("МГТУ имени Баумана · " + date, 16, 39, 8, false, "#d7dbe6");
    } else {
      text(kicker, 16, 15, 8, true, MUTED);
      doc.setDrawColor("#dce2eb").setLineWidth(.3).line(16, 22, 194, 22);
      text(title, 16, 36, 20, true);
      doc.setDrawColor("#d9b8fe").setLineWidth(1.2).circle(189, 12, 3);
    }
  }
  function book(x: number, y: number, color: string) {
    doc.setDrawColor(color).setLineWidth(.5);
    doc.lines([[4, -1], [4, 1], [0, 7], [-4, -1], [-4, 1], [0, -7]], x, y, [1, 1], "S", true);
    doc.line(x + 4, y - 1, x + 4, y + 6);
  }
  function table(section: PdfSection, y: number, rowColors?: string[]) {
    autoTable(doc, {
      startY: y, head: [section.columns], body: section.rows,
      foot: section.note ? [[{ content: section.note, colSpan: section.columns.length }]] : [], showFoot: "lastPage",
      margin: { top: 22, bottom: 22, left: 16, right: 16 },
      styles: { font: "NotoSans", fontSize: 8.5, cellPadding: 3, overflow: "linebreak", textColor: [23, 27, 46], valign: "top" },
      headStyles: { fillColor: [23, 27, 46], textColor: [255, 255, 255], fontStyle: "bold" },
      footStyles: { fillColor: [255, 255, 255], textColor: [89, 98, 115], fontStyle: "normal", fontSize: 7.5 },
      alternateRowStyles: { fillColor: [245, 247, 251] }, rowPageBreak: "avoid",
      didParseCell: cell => {
        if (rowColors && cell.section === "body" && cell.column.index === 0) cell.cell.styles.cellPadding = { top: 3, bottom: 3, left: 6, right: 3 };
        if (section.links?.some(link => cell.section === "body" && link.row === cell.row.index && link.column === cell.column.index)) cell.cell.styles.textColor = [93, 65, 145];
      },
      didDrawCell: cell => {
        const color = rowColors?.[cell.row.index];
        if (color && cell.section === "body" && cell.column.index === 0) doc.setFillColor(color).roundedRect(cell.cell.x + 2, cell.cell.y + 3, 2, 3, .4, .4, "F");
        const link = section.links?.find(link => cell.section === "body" && link.row === cell.row.index && link.column === cell.column.index);
        if (link) { doc.link(cell.cell.x, cell.cell.y, cell.cell.width, cell.cell.height, { url: link.url }); }
      },
    });
    return (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
  }

  if (report.result) {
    page("Твой результат", "ПРОФОРИЕНТАЦИОННЫЙ ТЕСТ", true);
    let y = table({ title: "", columns: ["Предпочтение", "Твой выбор"], rows: report.result.preferences }, 61);
    text("Три основных варианта", 16, y + 1, 13, true); y += 9;
    for (const [index, recommendation] of report.result.recommendations.slice(0, 3).entries()) {
      const name = lines(recommendation.name, 132, 10, true);
      const h = 22 + name.length * 4.2;
      if (y + h > 269) { page("Рекомендации", "РЕЗУЛЬТАТ ТЕСТА"); y = 52; }
      doc.setFillColor(PAPER).roundedRect(16, y, 178, h, 3, 3, "F");
      text(`${index + 1}. ${recommendation.code}`, 22, y + 7, 8, true, MUTED);
      text(name, 22, y + 14, 10, true);
      text(String(Math.round(recommendation.score)), 175, y + 13, 17, true);
      text("из 100", 175, y + 19, 7, false, MUTED);
      doc.setFillColor("#e1e6ef").roundedRect(22, y + h - 6, 166, 2, 1, 1, "F");
      if (recommendation.score > 0) doc.setFillColor(report.programs[index]?.color ?? "#d9b8fe").roundedRect(22, y + h - 6, 166 * Math.min(100, recommendation.score) / 100, 2, 1, 1, "F");
      y += h + 5;
    }
    if (report.result.recommendations.length > 3) {
      if (y > 224) { page("Другие варианты", "РЕЗУЛЬТАТ ТЕСТА"); y = 52; }
      text("Ещё стоит посмотреть", 16, y + 2, 11, true); y += 9;
      for (const item of report.result.recommendations.slice(3)) {
        const label = lines(`${item.code} · ${item.name}`, 154, 8);
        text(label, 16, y, 8); text(`${Math.round(item.score)} / 100`, 176, y, 8, true);
        y += label.length * 3.5 + 4;
      }
    }
    if (y > 258) { page("Как читать результат", "РЕЗУЛЬТАТ ТЕСТА"); y = 52; }
    paragraph("Совпадение отражает близость учебного плана к твоим ответам. Оно не оценивает способности и не предсказывает поступление. Далее — наглядное сравнение трёх основных вариантов.", 16, y + 2, 178, 8);
  }

  page("Сравнение программ", "АНДРОМЕДА · ТВОЙ ВЫБОР", true);
  let y = 63;
  for (const [index, program] of report.programs.entries()) {
    const name = lines(program.name, 150, 11, true);
    const department = lines(program.department, 160, 8);
    const height = 32 + name.length * 4.8 + department.length * 3.6;
    if (y + height > 269) { page("Выбранные программы", "ТВОЙ ВЫБОР"); y = 52; }
    doc.setFillColor(PAPER).roundedRect(16, y, 178, height, 3, 3, "F");
    doc.setFillColor(program.color).roundedRect(16, y, 2.5, height, 1, 1, "F");
    text(`${String(index + 1).padStart(2, "0")}  ${program.code}`, 23, y + 9, 9, true, MUTED);
    book(181, y + 8, "#8b94a6");
    text(name, 23, y + 17, 11, true);
    text(department, 23, y + 18 + name.length * 4.8, 8, false, MUTED);
    text(`${number(program.hours)} ч.    ·    ${number(program.credits, 1)} з.е.    ·    ${number(program.subjects)} позиций плана`, 23, y + height - 12, 8, true);
    text(program.status, 23, y + height - 5, 7.5, false, MUTED);
    y += height + 5;
  }
  if (y < 234) {
    const items = [["01", "Содержание", "Посмотри, какие темы преобладают."], ["02", "Нагрузка", "Сравни часы по семестрам."], ["03", "Поступление", "Проверь баллы, экзамены и источники."]];
    for (const [i, item] of items.entries()) {
      const x = 16 + i * 60;
      text(item[0]!, x, y + 10, 15, true, "#7f6aab");
      text(item[1]!, x, y + 18, 9, true);
      paragraph(item[2]!, x, y + 24, 54, 8);
    }
  }

  page("Что ты будешь изучать", "СОДЕРЖАНИЕ ПРОГРАММ");
  paragraph("Одинаковый цвет — одна предметная категория во всех программах.", 16, 46, 178, 9);
  const activeCategories = report.categories.filter(category => category.values.some(value => value !== null && value > 0));
  const columnWidth = 178 / Math.max(1, report.programs.length);
  for (const [i, program] of report.programs.entries()) {
    const centerX = 16 + columnWidth * (i + .5);
    doc.setFillColor(program.color).roundedRect(centerX - 21, 56, 42, 7, 2, 2, "F");
    text(program.code, centerX - 18, 61, 8, true);
    const depCode = program.department.split(" · ")[0] ?? "";
    doc.setFont("NotoSans", "normal").setFontSize(8).setTextColor(MUTED).text(depCode, centerX, 70, { align: "center" });
    const centerY = 101, radius = 23, inner = 15;
    doc.setFillColor("#e5e9f0").circle(centerX, centerY, radius, "F");
    const sum = activeCategories.reduce((sum, c) => sum + Math.max(0, c.values[i] ?? 0), 0);
    const total = Math.max(program.hours ?? 0, sum);
    let angle = -Math.PI / 2;
    if (total > 0) for (const category of activeCategories) {
      const value = category.values[i] ?? 0;
      if (value <= 0) continue;
      const end = angle + value / total * 2 * Math.PI;
      const steps = Math.max(2, Math.ceil((end - angle) / .04));
      const points: number[][] = [];
      for (let step = 0; step <= steps; step++) { const a = angle + (end - angle) * step / steps; points.push([centerX + Math.cos(a) * radius, centerY + Math.sin(a) * radius]); }
      for (let step = steps; step >= 0; step--) { const a = angle + (end - angle) * step / steps; points.push([centerX + Math.cos(a) * inner, centerY + Math.sin(a) * inner]); }
      const first = points[0]!;
      const vectors = points.slice(1).map((point, index) => [point[0]! - points[index]![0]!, point[1]! - points[index]![1]!]);
      doc.setFillColor(category.color).lines(vectors, first[0]!, first[1]!, [1, 1], "F", true);
      angle = end;
    }
    doc.setFillColor("#ffffff").circle(centerX, centerY, inner - .1, "F");
    doc.setFont("NotoSans", "bold").setFontSize(12).setTextColor(INK).text(number(program.hours), centerX, centerY, { align: "center" });
    doc.setFont("NotoSans", "normal").setFontSize(7).setTextColor(MUTED).text("часов по плану", centerX, centerY + 6, { align: "center" });
    const leading = [...activeCategories].sort((a, b) => (b.values[i] ?? 0) - (a.values[i] ?? 0))[0];
    const caption = leading && (leading.values[i] ?? 0) > 0 ? `${leading.name}\n${Math.round((leading.values[i] ?? 0) / total * 100)}% часов` : "Нет подтверждённых данных";
    const captionLines = lines(caption, columnWidth - 7, 7.5);
    doc.setTextColor(MUTED).text(captionLines, centerX, 135, { align: "center" });
  }
  text("Предметные категории", 16, 155, 12, true);
  const half = Math.ceil(activeCategories.length / 2);
  let legendY = 166;
  for (let row = 0; row < half; row++) {
    let height = 8;
    for (let column = 0; column < 2; column++) {
      const category = activeCategories[column * half + row];
      if (!category) continue;
      const x = 16 + column * 91;
      const label = lines(category.name, 80, 7.5);
      doc.setFillColor(category.color).roundedRect(x, legendY - 2.5, 3, 3, .6, .6, "F");
      text(label, x + 6, legendY, 7.5);
      height = Math.max(height, label.length * 3.4 + 3);
    }
    legendY += height;
  }
  paragraph(activeCategories.length ? "Показаны опубликованные часы. Серым отмечены часы вне подтверждённых категорий. Нет данных — не значит ноль." : "Состав предметных категорий не подтверждён. Пустой круг не означает отсутствия учебной нагрузки.", 16, Math.max(254, legendY + 4), 178, 7.5);

  page("Часы по категориям", "СОДЕРЖАНИЕ ПРОГРАММ · В ЧИСЛАХ");
  paragraph("Основная программа в академических часах. Факультативы и физкультура без з.е. показаны отдельно на сайте и не включены в этот итог.", 16, 46, 178, 8.5);
  table({
    title: "Часы по категориям",
    columns: ["Предметная категория", ...report.programs.map(program => `${program.code}\n${program.department.split(" · ")[0] ?? ""}`)],
    rows: [
      ...report.categories.map(category => [category.name, ...category.values.map(value => number(value, 1))]),
      ["Всего по учебному плану", ...report.programs.map(program => number(program.hours, 1))],
    ],
    note: "Цвета соответствуют круговым диаграммам. 0 — в подтверждённом плане нет часов этой категории; прочерк — нет подтверждённых данных. Итог включает часы вне подтверждённых категорий, если они есть.",
  }, 57, report.categories.map(category => category.color));

  const semestersPerPage = 13;
  const chunks = Math.max(1, Math.ceil(report.semesters.length / semestersPerPage));
  for (let chunk = 0; chunk < chunks; chunk++) {
    page("Нагрузка по семестрам", "РИТМ УЧЁБЫ" + (chunks > 1 ? ` · ${chunk + 1}/${chunks}` : ""));
    paragraph("Длина полосы показывает число часов. Все программы используют одну шкалу.", 16, 46, 178, 8.5);
    report.programs.forEach((p, i) => { const x = 16 + i * columnWidth; doc.setFillColor(p.color).rect(x, 55, 3, 3, "F"); text(p.code, x + 5, 57.5, 8, true); });
    const maximum = Math.max(1, ...report.semesters.flatMap(s => s.values.filter((v): v is number => v !== null)));
    text("0", 45, 69, 7, false, MUTED); text(`${number(maximum)} ч.`, 158, 69, 7, false, MUTED);
    let rowY = 76;
    const barHeight = 2.6, barGap = 1.1;
    const rowHeight = Math.max(12, report.programs.length * (barHeight + barGap) + 3);
    for (const semester of report.semesters.slice(chunk * semestersPerPage, (chunk + 1) * semestersPerPage)) {
      text(semester.label, 16, rowY + 3, 8, true);
      semester.values.forEach((value, i) => {
        const top = rowY + i * (barHeight + barGap);
        doc.setFillColor(PAPER).roundedRect(45, top, 122, barHeight, .6, .6, "F");
        if (value !== null && value > 0) doc.setFillColor(report.programs[i]!.color).roundedRect(45, top, 122 * value / maximum, barHeight, .6, .6, "F");
        doc.setFont("NotoSans", "normal").setFontSize(7).setTextColor(MUTED).text(value === null ? "нет данных" : number(value), 194, top + 2.5, { align: "right" });
      });
      rowY += rowHeight;
    }
    if (!report.semesters.length) paragraph("Нет подтверждённых данных о часах по семестрам.", 16, 90, 178);
    if (chunk === chunks - 1 && rowY < 224) {
      text("Самый насыщенный семестр", 16, rowY + 13, 12, true);
      report.programs.forEach((p, i) => {
        const peak = [...report.semesters].filter(s => s.values[i] !== null).sort((a, b) => (b.values[i] ?? 0) - (a.values[i] ?? 0))[0];
        text(`${p.code}   ${peak ? `${peak.label} · ${number(peak.values[i] ?? null)} ч.` : "Нет данных"}`, 16, rowY + 24 + i * 7, 9);
      });
    }
    paragraph("Часы взяты из учебных планов, включая указанные в них виды работы. Это не расписание занятий. Полные дисциплины и источники доступны на сайте.", 16, 263, 178, 8);
  }

  page("Поступление и источники", "ПРОВЕРЬ ПЕРЕД РЕШЕНИЕМ");
  let sectionY = 51;
  for (const section of report.sections) {
    if (!section.rows.length) continue;
    if (sectionY > 236) { page(section.title, "УСЛОВИЯ И ИСТОЧНИКИ"); sectionY = 50; }
    else { text(section.title, 16, sectionY, 13, true); sectionY += 7; }
    sectionY = table(section, sectionY);
  }
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i).setDrawColor("#dce2eb").setLineWidth(.2).line(16, 280, 194, 280);
    text("Андромеда · МГТУ имени Баумана", 16, 287, 7, false, MUTED);
    doc.setFont("NotoSans", "normal").setFontSize(7).setTextColor("#6c4e99").textWithLink("Открыть на сайте", 107, 287, { url: report.link });
    doc.setTextColor(MUTED).text(`${i} / ${total}`, 194, 287, { align: "right" });
  }
  // Use a download attachment rather than the PDF MIME type: embedded browsers
  // can otherwise intercept the blob and navigate to their PDF viewer.
  const attachment = new Blob([doc.output("arraybuffer")], { type: "application/octet-stream" });
  const url = URL.createObjectURL(attachment);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = report.filename;
  anchor.hidden = true;
  document.body.append(anchor);
  try { anchor.click(); }
  finally {
    anchor.remove();
    // Keep the URL alive while the browser starts writing the file.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
