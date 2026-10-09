import type { ApiSchemas } from "@/shared/api/client";
import type { CatalogProgram } from "./model";
import { safeExternalUrl } from "./model";

type CampaignDto = ApiSchemas["AdmissionCampaignRecord"];
type OfferingDto = ApiSchemas["AdmissionOfferingRecord"];
type CalendarDto = ApiSchemas["CampaignCalendarEventRecord"];
type PoolDto = ApiSchemas["CompetitionPoolRecord"];
type QuotaDto = ApiSchemas["PlaceQuotaRecord"];
type RequirementDto = ApiSchemas["RequirementTreeRecord"];
type RequirementNode = ApiSchemas["RequirementLeaf"] | ApiSchemas["RequirementOperatorNode"];
type StatisticDto = ApiSchemas["OfficialAdmissionStatisticRecord"];
type TuitionDto = ApiSchemas["TuitionRecord"];

export interface ProgramAdmissionData {
  readonly releaseKey: string;
  readonly campaigns: readonly CampaignDto[];
  readonly offerings: readonly OfferingDto[];
  readonly calendar: readonly CalendarDto[];
  readonly pools: readonly PoolDto[];
  readonly quotas: readonly QuotaDto[];
  readonly requirements: readonly RequirementDto[];
  readonly history: readonly StatisticDto[];
  readonly campaignStatistics: readonly StatisticDto[];
  readonly tuition: readonly TuitionDto[];
}

export interface AdmissionMetric {
  readonly label: string;
  readonly value: string;
  readonly note: string | null;
  readonly sourceUrl: string | null;
}

export interface AdmissionPlaceGroup {
  readonly label: string;
  readonly value: string;
  readonly scope: string;
  readonly sourceUrl: string | null;
}

export interface AdmissionHistoryRow {
  readonly year: number;
  readonly funding: string;
  readonly minimum: string;
  readonly average: string;
  readonly maximum: string;
  readonly admitted: string;
  readonly sourceUrl: string | null;
}

export interface AdmissionCampaignResult {
  readonly year: number;
  readonly stage: string | null;
  readonly competitionType: string | null;
  readonly status: string | null;
  readonly funding: string | null;
  readonly score: number | null;
  readonly snapshotDate: string | null;
  readonly scopeType: string | null;
  readonly scopeLabel: string | null;
  readonly scopeNote: string;
  readonly sourceUrl: string | null;
}

export interface AdmissionRequirement {
  readonly category: string;
  readonly text: string;
  readonly sourceUrl: string | null;
}

export interface AdmissionSummary {
  readonly year: number | null;
  readonly directionCode: string | null;
  readonly seats: readonly AdmissionMetric[];
  readonly seatScope: string;
  readonly seatNote: string | null;
  readonly quotas: readonly AdmissionPlaceGroup[];
  readonly quotaNote: string | null;
  readonly historyScope: string;
  readonly history: readonly AdmissionHistoryRow[];
  readonly campaignResults: readonly AdmissionCampaignResult[];
  readonly requirements: readonly AdmissionRequirement[];
  readonly offers: readonly string[];
  readonly tuition: readonly string[];
  readonly dates: readonly { label: string; date: string; sourceUrl: string | null }[];
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberText(value: number | null): string {
  return value === null ? "—" : new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value);
}

function placeText(value: number | null): string {
  if (value === null) return "Количество не указано";
  const absolute = Math.abs(value) % 100;
  const last = absolute % 10;
  const word = absolute > 10 && absolute < 20 ? "мест"
    : last === 1 ? "место"
      : last > 1 && last < 5 ? "места"
        : "мест";
  return `${numberText(value)} ${word}`;
}

function sourceUrl(record: { sources?: Array<{ source_url?: string | null }> }): string | null {
  return record.sources?.map((item) => safeExternalUrl(item.source_url)).find(Boolean) ?? null;
}

function fundingLabel(value: string | null | undefined): string {
  if (value === "budget") return "Бюджет";
  if (value === "paid") return "Платное";
  return value || "Основа не указана";
}

const SUBJECT_LABELS: Readonly<Record<string, string>> = {
  russian_language: "Русский язык",
  mathematics: "Математика",
  physics: "Физика",
  informatics: "Информатика",
  computer_science: "Информатика",
  chemistry: "Химия",
  biology: "Биология",
  history: "История",
  social_studies: "Обществознание",
  foreign_language: "Иностранный язык",
};

function subjectLabel(value: string): string {
  return SUBJECT_LABELS[value.trim().toLocaleLowerCase("en-US")] ?? value;
}

function quotaLabel(value: string | null | undefined): string {
  const labels: Record<string, string> = {
    general_competition: "Общий конкурс",
    special: "Особая квота",
    separate: "Отдельная квота",
    targeted: "Целевой приём",
    special_quota: "Особая квота",
    separate_quota: "Отдельная квота",
  };
  return value ? labels[value] ?? value : "Квота не указана";
}

function scopeLabel(value: string | null | undefined): string {
  if (value === "department") return "кафедра";
  if (value === "offering") return "предложение приёма";
  if (value === "direction_and_target_organization") return "направление и организация";
  return "направление";
}

function poolSourceRows(pool: PoolDto): number[] {
  return (pool.places_by_source_row ?? []).flatMap((row) => {
    const places = toNumber(row.places);
    return places === null ? [] : [places];
  });
}

function verifiedDepartmentKeys(program: CatalogProgram): Set<string> {
  return new Set((program.department_relations ?? [])
    .filter((relation) => relation.verification_status === "verified")
    .map((relation) => relation.department_key));
}

function linkedOfferings(program: CatalogProgram, offerings: readonly OfferingDto[]): OfferingDto[] {
  return offerings.filter((offering) => (
    offering.program_link_status === "exact" && offering.program_key === program.external_key
  ));
}

function selectRelatedPools(
  program: CatalogProgram,
  pools: readonly PoolDto[],
  offerings: readonly OfferingDto[],
): { rows: PoolDto[]; label: string; unresolved: boolean } {
  const general = pools.filter((pool) => pool.quota_type === "general_competition");
  const offeringByKey = new Map(offerings.map((offering) => [offering.external_key, offering]));
  const exactOfferingKeys = new Set(linkedOfferings(program, offerings).map((offering) => offering.external_key));
  const exact = general.filter((pool) => {
    const linkedKeys = new Set([...(pool.offering_keys ?? []), ...(pool.offering_key ? [pool.offering_key] : [])]);
    return [...linkedKeys].some((key) => (
      exactOfferingKeys.has(key) && offeringByKey.get(key)?.program_key === program.external_key
    ));
  });
  if (exact.length) return { rows: exact, label: "предложение приёма, связанное с программой", unresolved: false };

  const departments = verifiedDepartmentKeys(program);
  const departmentRows = general.filter((pool) => (
    pool.scope_level === "department"
    && pool.department_status === "verified"
    && pool.department_key != null
    && departments.has(pool.department_key)
  ));
  if (departmentRows.length) return { rows: departmentRows, label: "кафедра", unresolved: false };

  const directionRows = general.filter((pool) => (
    pool.scope_level === "direction"
    && pool.direction_code != null
    && pool.direction_code === program.directionCode
  ));
  if (directionRows.length) return { rows: directionRows, label: "направление", unresolved: false };

  const relatedDepartmentCodes = new Set([program.departmentCode].filter((value): value is string => Boolean(value)));
  const unresolved = offerings.some((offering) => (
    offering.program_link_status !== "exact"
    && offering.program_key === program.external_key
  )) || general.some((pool) => (
    pool.scope_level === "offering"
    && pool.department_code != null
    && relatedDepartmentCodes.has(pool.department_code)
    && [...(pool.offering_keys ?? []), ...(pool.offering_key ? [pool.offering_key] : [])]
      .some((key) => offeringByKey.get(key)?.program_link_status === "manual_review")
  ));
  return {
    rows: [],
    label: unresolved ? "связь предложения уточняется" : "источник не содержит связь с программой",
    unresolved,
  };
}

function requirementExpression(
  node: RequirementNode,
  parentOperator?: "AND" | "OR" | "AT_LEAST",
): string {
  if (node.kind === "leaf") {
    const name = subjectLabel(node.subject_name || node.subject_code || "Предмет не указан");
    const score = toNumber(node.minimum_score);
    return score === null ? name : `${name} от ${numberText(score)}`;
  }
  const children = node.children.map((child) => requirementExpression(child, node.operator));
  let expression: string;
  if (node.operator === "AND") expression = children.join(" и ");
  else if (node.operator === "OR") expression = children.join(" или ");
  else {
    const threshold = node.threshold;
    expression = threshold == null
      ? `Выбрать из: ${children.join("; ")}`
      : `не менее ${threshold} из: ${children.join("; ")}`;
  }
  if (parentOperator && (node.operator === "AT_LEAST" || parentOperator !== node.operator)) {
    return `(${expression})`;
  }
  return expression;
}

function requirementCategory(node: RequirementNode): string {
  if (node.kind === "leaf") {
    if (node.is_choice === true) return "Предмет на выбор";
    if (node.is_choice === false) return "Обязательный предмет";
    return "Тип условия не указан";
  }
  return node.operator === "AND" ? "Все условия" : node.operator === "OR" ? "Альтернативные условия" : "Выбор по условию";
}

function statisticDepartmentMatch(statistic: StatisticDto, departmentCode: string | null): boolean {
  if (!departmentCode) return false;
  if (statistic.direction_code == null) return false;
  const label = statistic.scope_label?.toLocaleLowerCase("ru-RU") ?? "";
  return label.split(/[^0-9a-zа-я]+/iu).includes(departmentCode.toLocaleLowerCase("ru-RU"));
}

function metricValue(pools: readonly PoolDto[]): { value: string; note: string | null } {
  if (!pools.length) return { value: "—", note: null };
  const values = pools.map((pool) => toNumber(pool.places));
  const known = values.filter((value): value is number => value !== null);
  const conflicts = [...new Set(pools.flatMap(poolSourceRows))].sort((a, b) => a - b);
  if (known.length === values.length) {
    const total = known.reduce((sum, value) => sum + value, 0);
    return { value: placeText(total), note: null };
  }
  if (known.length === 0 && conflicts.length > 1) {
    return {
      value: "Конфликт в источнике",
      note: `В исходных строках указаны разные значения: ${conflicts.map(numberText).join(" и ")}. Полная сумма не подтверждена.`,
    };
  }
  if (known.length) {
    return { value: "Частичные данные", note: `Указано ${known.length} из ${values.length} значений; полная сумма не подтверждена.` };
  }
  return {
    value: "Не указано",
    note: conflicts.length > 1
      ? `В исходных строках указаны разные значения: ${conflicts.map(numberText).join(" и ")}.`
      : "Количество мест в источнике не указано.",
  };
}

function quotaMatchesProgram(
  pool: PoolDto,
  program: CatalogProgram,
  offerings: readonly OfferingDto[],
): boolean {
  // This broad scope is not a program association. The API currently exposes
  // pool-to-offering keys without the relationship evidence needed to tell an
  // exact offer link from a direction-wide relation, and it has no verified
  // campus identity for the pool. Do not attribute these quotas to a program.
  if (pool.scope_level === "direction_and_target_organization") return false;
  const offeringKeys = new Set(linkedOfferings(program, offerings).map((offering) => offering.external_key));
  const linkedKeys = [...(pool.offering_keys ?? []), ...(pool.offering_key ? [pool.offering_key] : [])];
  if (linkedKeys.some((key) => offeringKeys.has(key))) return true;
  if (pool.scope_level === "department" && pool.department_status === "verified" && pool.department_key) {
    return verifiedDepartmentKeys(program).has(pool.department_key);
  }
  // A target-organization pool may have a broader direction scope, but the
  // published DTO does not expose a normalized campus identity for the pool.
  // Keep it unattached unless its offering identity links it to this program.
  return pool.scope_level === "direction"
    && pool.direction_code != null
    && pool.direction_code === program.directionCode;
}

function normalizedScopeLabel(value: string | null | undefined): string {
  return (value ?? "").toLocaleLowerCase("ru-RU").replace(/[\s\p{P}\p{S}]+/gu, "");
}

function statisticScopeNote(statistic: StatisticDto, program: CatalogProgram): string {
  const scopeType = statistic.scope_type?.trim().toLocaleLowerCase("en-US") ?? "";
  const scopeLabel = statistic.scope_label?.trim();
  if (scopeType === "department" && scopeLabel) return "по кафедре " + scopeLabel;
  if (scopeType === "program" && scopeLabel) return "по программе " + scopeLabel;
  const directionCode = statistic.direction_code ?? program.directionCode;
  if (scopeType === "direction") {
    return "по направлению " + (directionCode ?? "не указано") + (scopeLabel ? " · " + scopeLabel : "");
  }
  return "по направлению " + (directionCode ?? "не указано") + "; область источника не уточнена";
}

function campaignStatisticMatchesProgram(statistic: StatisticDto, program: CatalogProgram): boolean {
  if (!program.directionCode || statistic.direction_code !== program.directionCode) return false;
  const scopeType = statistic.scope_type?.trim().toLocaleLowerCase("en-US") ?? "";
  const scopeLabel = normalizedScopeLabel(statistic.scope_label);
  if (scopeType === "direction" || !scopeType) return true;

  const programLabels = new Set([
    normalizedScopeLabel(program.code),
    normalizedScopeLabel(program.external_key),
  ].filter(Boolean));
  if (scopeType === "program") return Boolean(scopeLabel && programLabels.has(scopeLabel));

  if (scopeType === "department" && scopeLabel) {
    const departmentLabels = [
      program.departmentCode,
      program.departmentName,
      ...program.departments.flatMap((department) => [department.code, department.name]),
    ].map(normalizedScopeLabel).filter(Boolean);
    return departmentLabels.includes(scopeLabel);
  }

  // A subgroup or unknown scope has no stable key in this API contract. Do not
  // attach it to a program based on a partial or similar-looking label.
  return false;
}

export function buildAdmissionSummary(program: CatalogProgram, data: ProgramAdmissionData): AdmissionSummary {
  const campaign = data.campaigns
    .filter((item) => item.campaign_kind === "admission")
    .sort((left, right) => right.year - left.year)[0];
  const year = campaign?.year ?? null;
  const campaignPools = data.pools.filter((pool) => !campaign || pool.campaign_key === campaign.external_key);
  const selectedPools = selectRelatedPools(program, campaignPools, data.offerings);
  const seats = ([
    ["budget", "Бюджет · общий конкурс"],
    ["paid", "Платное · общий конкурс"],
  ] as const).map(([funding, label]) => {
    const rows = selectedPools.rows.filter((pool) => pool.funding_type === funding);
    const metric = metricValue(rows);
    return {
      label,
      value: metric.value,
      note: metric.note,
      sourceUrl: rows.map(sourceUrl).find(Boolean) ?? null,
    };
  });

  const historyRows = data.history.filter((statistic) => (
    statistic.year < (year ?? Number.POSITIVE_INFINITY)
    && statistic.direction_code === program.directionCode
    && statistic.funding_type === "paid"
    && toNumber(statistic.minimum_score ?? statistic.score) !== null
  ));
  const exactHistory = historyRows.filter((statistic) => (
    statistic.scope_type === "department"
    && statisticDepartmentMatch(statistic, program.departmentCode)
  ));
  const selectedHistory = (exactHistory.length
    ? exactHistory
    : historyRows.filter((statistic) => statistic.scope_type === "direction"))
    .sort((left, right) => right.year - left.year)
    .slice(0, 6);

  const requirements = data.requirements
    .filter((requirement) => requirement.direction_key === program.direction_key)
    .map((requirement) => ({
      category: requirementCategory(requirement.root),
      text: requirementExpression(requirement.root),
      sourceUrl: sourceUrl(requirement),
    }));

  const exactOffers = linkedOfferings(program, data.offerings);
  const offers = [...new Set(exactOffers.flatMap((offering) => [
    offering.study_form ? `Форма обучения: ${offering.study_form}` : "Форма обучения: не указана",
    offering.study_duration_label ? `Срок обучения: ${offering.study_duration_label}` : "",
    offering.language ? `Язык обучения: ${offering.language}` : "",
    offering.places_total != null ? `Мест по предложению: ${numberText(offering.places_total)}` : "",
  ]).filter(Boolean))];

  const tuition = data.tuition
    .filter((item) => (
      item.program_key === program.external_key
      || (program.directionCode !== null && item.direction_code === program.directionCode)
    ))
    .map((item) => {
      const scope = item.program_key === program.external_key ? "по программе" : `по направлению ${program.directionCode ?? ""}`;
      const amount = item.amount == null ? "стоимость не указана" : `${item.amount} ${item.currency || "валюта не указана"}`;
      return `${item.academic_year || "Год не указан"} · ${scope}: ${amount}`;
    });

  const dates = campaign
    ? data.calendar.filter((event) => event.campaign_key === campaign.external_key).map((event) => ({
      label: event.context ? `${event.label} · ${event.context}` : event.label,
      date: event.date_text || event.date_value || event.starts_at || "Дата не указана",
      sourceUrl: sourceUrl(event),
    }))
    : [];

  const relatedPools = campaignPools.filter((pool) => quotaMatchesProgram(pool, program, data.offerings));
  const hasUnassignedTargetQuota = campaignPools.some((pool) => (
    pool.quota_type === "targeted"
    && pool.scope_level === "direction_and_target_organization"
    && (pool.direction_key != null
      ? pool.direction_key === program.direction_key
      : pool.direction_code != null && pool.direction_code === program.directionCode)
  ));
  const relatedPoolKeys = new Set(relatedPools.map((pool) => pool.external_key));
  const quotaRows: AdmissionPlaceGroup[] = [];
  const quotaRecordsByPool = new Map<string, QuotaDto[]>();
  for (const quota of data.quotas) {
    if (!quota.pool_key || !relatedPoolKeys.has(quota.pool_key)) continue;
    quotaRecordsByPool.set(quota.pool_key, [...(quotaRecordsByPool.get(quota.pool_key) ?? []), quota]);
  }
  for (const [poolKey, records] of quotaRecordsByPool) {
    const pool = relatedPools.find((candidate) => candidate.external_key === poolKey);
    if (!pool) continue;
    for (const quota of records) {
      quotaRows.push({
        label: `${quotaLabel(quota.quota_type)} · ${fundingLabel(quota.funding_type)}`,
        value: placeText(toNumber(quota.places)),
        scope: [scopeLabel(quota.scope_level ?? pool.scope_level), pool.campus_label_in_document?.trim()]
          .filter(Boolean).join(" · "),
        sourceUrl: sourceUrl(quota),
      });
    }
  }
  for (const pool of relatedPools) {
    if (pool.quota_type === "general_competition" || quotaRecordsByPool.has(pool.external_key)) continue;
    const places = metricValue([pool]);
    const organization = pool.target_organization?.trim();
    quotaRows.push({
      label: `${quotaLabel(pool.quota_type)} · ${fundingLabel(pool.funding_type)}${organization ? ` · ${organization}` : ""}`,
      value: places.value,
      scope: [scopeLabel(pool.scope_level), pool.campus_label_in_document?.trim()]
        .filter(Boolean).join(" · "),
      sourceUrl: sourceUrl(pool),
    });
  }

  return {
    year,
    directionCode: program.directionCode,
    seats,
    seatScope: selectedPools.label,
    seatNote: selectedPools.rows.length
      ? null
      : selectedPools.unresolved
        ? "Связь предложения с программой проверяется. Значения других программ не используются."
        : "Данные общего конкурса не привязаны к этой программе. Значения других программ не используются.",
    quotas: quotaRows,
    quotaNote: hasUnassignedTargetQuota
      ? "На этом направлении есть целевые квоты уровня «направление и организация», но их кампус и связь с программой не подтверждены. Эти места не приписываются программе."
      : null,
    historyScope: exactHistory.length > 0 ? "подтверждённая кафедра" : "направление",
    history: selectedHistory.map((statistic) => ({
      year: statistic.year,
      funding: fundingLabel(statistic.funding_type),
      minimum: numberText(toNumber(statistic.minimum_score ?? statistic.score)),
      average: numberText(toNumber(statistic.average_score)),
      maximum: numberText(toNumber(statistic.maximum_score)),
      admitted: numberText(toNumber(statistic.admitted_count)),
      sourceUrl: sourceUrl(statistic),
    })),
    campaignResults: data.campaignStatistics
      .filter((statistic) => (year === null || statistic.year === year)
        && campaignStatisticMatchesProgram(statistic, program))
      .map((statistic) => ({
        year: statistic.year,
        stage: statistic.admission_stage ?? null,
        competitionType: statistic.competition_type ?? null,
        status: statistic.status ?? null,
        funding: statistic.funding_type ?? null,
        score: toNumber(statistic.score ?? statistic.minimum_score),
        snapshotDate: statistic.snapshot_date ?? null,
        scopeType: statistic.scope_type ?? null,
        scopeLabel: statistic.scope_label ?? null,
        scopeNote: statisticScopeNote(statistic, program),
        sourceUrl: sourceUrl(statistic),
      })),
    requirements,
    offers,
    tuition: [...new Set(tuition)],
    dates,
  };
}
