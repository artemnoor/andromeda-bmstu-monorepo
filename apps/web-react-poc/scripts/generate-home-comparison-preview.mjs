import { createServer } from 'vite';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const origin = (process.env.ACADEMIC_DATA_API_ORIGIN ?? 'http://127.0.0.1:8000').replace(/\/$/, '');
process.env.VITE_API_BASE_URL = origin;
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => originalFetch(typeof input === 'string' && input.startsWith('/') ? new URL(input, origin) : input, init);
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const fromSnapshot = process.argv.includes('--from-snapshot');
  const path = resolve('src/features/home/data/comparison-preview.json');
  const data = fromSnapshot
    ? JSON.parse(await readFile(path, 'utf8'), (_key, value) => value?.$map ? new Map(value.$map) : value?.$set ? new Set(value.$set) : value).data
    : await (await server.ssrLoadModule('/src/features/comparison/api.ts')).loadProgramComparison(['01.03.02-01', '01.03.03-03']);
  if (!data) throw new Error('Offline conversion requires the original verified comparison snapshot.');
  if (data.programs.length !== 2 || data.admissionUnavailable.size || data.taxonomyUnavailable || data.curriculum.programs.some(program => program.itemsStatus !== 'loaded' || program.planSelection.status !== 'ready')) {
    throw new Error('The home preview must contain two complete, verified comparisons.');
  }
  const { buildComparisonCategories } = await server.ssrLoadModule('/src/features/comparison/category-chart.tsx');
  const { programDepartment } = await server.ssrLoadModule('/src/features/catalog/program-identity.tsx');
  const { ENROLLMENT_ROWS, SCORE_ROWS, enrollmentCell, scoreCell } = await server.ssrLoadModule('/src/features/catalog/admission-table-model.ts');
  const { publicSourceUrl } = await server.ssrLoadModule('/src/shared/links/public-source-url.ts');
  const { SERIES_COLORS } = await server.ssrLoadModule('/src/features/comparison/presentation.ts');
  const categories = buildComparisonCategories(data);
  const largest = [...categories].filter(category => category.categoryCode !== null).sort((a, b) => {
    const total = category => [...category.workloads.values()].reduce((sum, workload) => sum + workload.hours.value, 0);
    return total(b) - total(a);
  })[0]?.key ?? '';
  // Compute only what is displayed. No curriculum model, evidence graph,
  // Map/Set revival, chart library or API refresh runs in the browser.
  const format = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
  const arc = (start, end, outer) => {
    const point = (angle, radius) => [95 + Math.cos(angle) * radius, 95 - Math.sin(angle) * radius].map(value => Number(value.toFixed(3))).join(',');
    const large = end - start > Math.PI ? 1 : 0;
    return `M${point(start, outer)} A${outer},${outer} 0 ${large} 0 ${point(end, outer)} L${point(end, 52)} A52,52 0 ${large} 1 ${point(start, 52)} Z`;
  };
  const programs = data.programs.map((identity, index) => {
    const program = data.curriculum.programs.find(candidate => candidate.programKey === identity.external_key);
    const total = program.total.hours.value;
    let angle = 0;
    const classified = categories.reduce((sum, category) => sum + (category.workloads.get(program.programKey)?.hours.value ?? 0), 0);
    const segments = categories.flatMap(category => {
      const hours = category.workloads.get(program.programKey)?.hours.value ?? 0;
      if (hours <= 0) return [];
      const start = angle;
      angle += 2 * Math.PI * hours / Math.max(total, classified);
      return [{ key: category.key, name: category.name, hours, percent: `${Math.round(hours / total * 100) || '<1'}%`, color: category.color, path: arc(start, angle, 74), activePath: arc(start, angle, 78) }];
    });
    return { key: identity.external_key, code: identity.code, name: identity.name, department: programDepartment(identity), color: SERIES_COLORS[index], totalHours: total, segments };
  });
  const curriculum = data.curriculum.matrixRows.slice(0, 4).map(row => ({
    key: row.visualKey,
    title: row.title,
    cells: programs.map(program => (row.itemsByProgram.get(program.key) ?? []).map(item => ({
      category: item.classification?.categoryName ?? 'Категория не указана',
      details: [item.semester === null ? 'Семестр не указан' : `${item.semester} семестр`, item.credits === null ? null : `${format.format(item.credits)} з.е.`, item.hours === null ? null : `${format.format(item.hours)} ч.`, item.assessmentType].filter(Boolean).join(' · '),
    }))),
  }));
  const summaries = programs.map(program => data.admission.get(program.key));
  const years = [...new Set(summaries.flatMap(summary => summary?.year == null ? [] : [summary.year]))].sort((a, b) => b - a);
  const cell = result => ({
    value: result.value,
    note: result.note ?? '',
    kind: result.kind ?? '',
    sources: [...(result.sourceUrls ?? []), ...(result.sourceUrl ? [result.sourceUrl] : [])].flatMap(href => {
      const url = publicSourceUrl(href);
      return url ? [{ url, label: 'Источник' }] : [];
    }),
    ...(result.bviSourceUrl ? { bviSourceUrl: publicSourceUrl(result.bviSourceUrl) } : {}),
  });
  const admissions = years.map(year => ({ year,
    enrollment: ENROLLMENT_ROWS.map(row => ({ key: row.key, label: row.label, cells: summaries.map(summary => cell(enrollmentCell(summary, year, row))) })),
    scores: SCORE_ROWS.map(row => ({ key: row.key, label: row.label, cells: summaries.map(summary => cell(scoreCell(summary, year, row))) })),
  }));
  const snapshot = { schemaVersion: 2, generatedAt: new Date().toISOString(), releaseKey: data.releaseKey, activeCategory: largest, programs, curriculum, admissions };
  const json = JSON.stringify(snapshot);
  await mkdir(resolve('src/features/home/data'), { recursive: true });
  await writeFile(path, json + '\n');
  console.log(JSON.stringify({ path, release: data.releaseKey, bytes: Buffer.byteLength(json), gzipBytes: gzipSync(json).length }));
} finally {
  await server.close();
}
