import {
  ACTIVITY_OPTIONS,
  MAX_AVOID,
  MAX_COMPARISONS,
  MAX_INTERESTS,
  NO_ACTIVITY,
  NO_AVOID,
  PAIR_CHOICES,
  UNKNOWN_INTEREST,
  type CareerTestAnswers,
  type CareerTestPhase,
  type CategoryPair,
  type SubjectCategory,
} from "./model";

export interface FlowSnapshot {
  readonly phase: CareerTestPhase;
  readonly answers: CareerTestAnswers;
  readonly currentPair: CategoryPair | null;
  readonly draftComparison: number | null;
}

export interface FlowState extends FlowSnapshot {
  readonly history: readonly FlowSnapshot[];
}

const SESSION_KEY = "andromeda.prof-test.session.v1";
const MAX_SERIALIZED_LENGTH = 32_768;
const MAX_HISTORY = 3 + MAX_COMPARISONS;
const choices = new Set<number>(PAIR_CHOICES.map(({ value }) => value));
const activities = new Set<string>(["", NO_ACTIVITY, ...ACTIVITY_OPTIONS.map(({ key }) => key)]);

function sessionStorageOrNull(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && value.trim() === value;
}

function category(value: unknown, codes?: ReadonlySet<string>): value is string {
  return identifier(value) && (!codes || codes.has(value));
}

function selection(value: unknown, maximum: number, sentinel: string, codes?: ReadonlySet<string>): boolean {
  return Array.isArray(value)
    && value.length <= maximum
    && new Set(value).size === value.length
    && value.every((code) => code === sentinel || category(code, codes))
    && (!value.includes(sentinel) || value.length === 1);
}

export function validAnswers(value: unknown, codes?: ReadonlySet<string>): value is CareerTestAnswers {
  if (!record(value) || !exactKeys(value, ["interests", "activity", "avoid", "comparisons"])) return false;
  if (!selection(value.interests, MAX_INTERESTS, UNKNOWN_INTEREST, codes)
    || !selection(value.avoid, MAX_AVOID, NO_AVOID, codes)
    || typeof value.activity !== "string" || !activities.has(value.activity)
    || !Array.isArray(value.comparisons) || value.comparisons.length > MAX_COMPARISONS) return false;
  const used = new Set<string>();
  for (const comparison of value.comparisons) {
    if (!record(comparison) || !exactKeys(comparison, ["left", "right", "value"])
      || !category(comparison.left, codes) || !category(comparison.right, codes)
      || comparison.left === comparison.right || used.has(comparison.left) || used.has(comparison.right)
      || typeof comparison.value !== "number" || !choices.has(comparison.value)) return false;
    used.add(comparison.left);
    used.add(comparison.right);
  }
  return true;
}

function validSnapshot(value: unknown, codes?: ReadonlySet<string>, withHistory = false): value is FlowSnapshot {
  if (!record(value) || !exactKeys(value, ["phase", "answers", "currentPair", "draftComparison", ...(withHistory ? ["history"] : [])])
    || !validAnswers(value.answers, codes)) return false;
  const { phase, answers, currentPair, draftComparison } = value;
  if (phase !== "interests" && phase !== "activity" && phase !== "avoid" && phase !== "compare" && phase !== "results") return false;
  if (phase !== "interests" && answers.interests.length === 0) return false;
  if ((phase === "avoid" || phase === "compare" || phase === "results") && !answers.activity) return false;
  if (phase === "compare") {
    if (answers.comparisons.length >= MAX_COMPARISONS
      || !record(currentPair) || !exactKeys(currentPair, ["left", "right", "separation"])
      || !category(currentPair.left, codes) || !category(currentPair.right, codes)
      || currentPair.left === currentPair.right
      || typeof currentPair.separation !== "number" || !Number.isFinite(currentPair.separation) || currentPair.separation < 0
      || answers.comparisons.some(({ left, right }) => [left, right].includes(currentPair.left as string) || [left, right].includes(currentPair.right as string))
      || (draftComparison !== null && (typeof draftComparison !== "number" || !choices.has(draftComparison)))) return false;
  } else if (currentPair !== null || draftComparison !== null) return false;
  if (phase !== "compare" && phase !== "results" && answers.comparisons.length !== 0) return false;
  return true;
}

function validFlow(value: unknown, codes?: ReadonlySet<string>): value is FlowState {
  if (!validSnapshot(value, codes, true) || !record(value)
    || !Array.isArray(value.history) || value.history.length > MAX_HISTORY) return false;
  const expectedHistory = value.phase === "interests" ? 0
    : value.phase === "activity" ? 1
      : value.phase === "avoid" ? 2
        : 3 + value.answers.comparisons.length;
  if (value.history.length !== expectedHistory) return false;
  for (let index = 0; index < value.history.length; index += 1) {
    const step: unknown = value.history[index];
    if (!validSnapshot(step, codes)) return false;
    const expectedPhase = index === 0 ? "interests" : index === 1 ? "activity" : index === 2 ? "avoid" : "compare";
    if (step.phase !== expectedPhase || (index === 0 && !step.answers.interests.length)
      || (index === 1 && !step.answers.activity)) return false;
    if (index >= 3) {
      const answered = value.answers.comparisons[index - 3];
      if (!answered || step.answers.comparisons.length !== index - 3
        || step.currentPair?.left !== answered.left || step.currentPair.right !== answered.right
        || step.draftComparison !== answered.value) return false;
      if (!step.answers.comparisons.every((comparison, comparisonIndex) => {
        const current = value.answers.comparisons[comparisonIndex];
        return current?.left === comparison.left && current.right === comparison.right && current.value === comparison.value;
      })) return false;
    }
  }
  return true;
}

function validRelease(releaseKey: unknown): releaseKey is string {
  return typeof releaseKey === "string" && releaseKey.length > 0 && releaseKey.length <= 1_024;
}

/** Restore only the current tab's bounded answers for exactly the loaded release. */
export function readProfTestSession(
  releaseKey: string,
  categories: readonly SubjectCategory[],
  storage?: Storage | null,
): FlowState | null {
  try {
    if (!validRelease(releaseKey)) return null;
    const target = storage === undefined ? sessionStorageOrNull() : storage;
    const raw = target?.getItem(SESSION_KEY);
    if (!raw || raw.length > MAX_SERIALIZED_LENGTH) return null;
    const value: unknown = JSON.parse(raw);
    if (!record(value) || !exactKeys(value, ["version", "releaseKey", "flow"])
      || value.version !== 1 || value.releaseKey !== releaseKey
      || !validFlow(value.flow, new Set(categories.map(({ code }) => code)))) return null;
    return value.flow;
  } catch {
    return null;
  }
}

/** Store answers, never academic records or a previously computed ranking. */
export function saveProfTestSession(releaseKey: string, flow: FlowState, storage?: Storage | null): boolean {
  try {
    if (!validRelease(releaseKey) || !validFlow(flow)) return false;
    const target = storage === undefined ? sessionStorageOrNull() : storage;
    if (!target) return false;
    const raw = JSON.stringify({ version: 1, releaseKey, flow });
    if (raw.length > MAX_SERIALIZED_LENGTH) return false;
    target.setItem(SESSION_KEY, raw);
    return true;
  } catch {
    return false;
  }
}
