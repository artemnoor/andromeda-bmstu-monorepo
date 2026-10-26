import { decodeSharedPayload, encodeSharedPayload } from "@/shared/sharing/links";
import type { CareerTestAnswers, SubjectCategory } from "./model";
import { validAnswers, type FlowSnapshot, type FlowState } from "./session";

export function profTestResultPath(releaseKey: string, answers: CareerTestAnswers): string {
  return `/discover?${new URLSearchParams({ result: encodeSharedPayload({ version: 1, releaseKey, answers }) })}`;
}

export function readSharedResult(raw: string, releaseKey: string, categories: readonly SubjectCategory[]): FlowState {
  let value: unknown;
  try { value = decodeSharedPayload(raw); }
  catch { throw new Error("Ссылка на результат повреждена. Можно пройти тест заново."); }
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1 || !("releaseKey" in value) || !("answers" in value)) throw new Error("Ссылка на результат повреждена. Можно пройти тест заново.");
  if (value.releaseKey !== releaseKey) throw new Error("Этот результат относится к прежней версии учебных планов. Пройди тест заново по текущим данным.");
  if (!validAnswers(value.answers, new Set(categories.map(c => c.code))) || !value.answers.interests.length || !value.answers.activity) throw new Error("Ссылка содержит некорректные ответы. Можно пройти тест заново.");
  const answers = value.answers;
  const base = { ...answers, comparisons: [] };
  const history: FlowSnapshot[] = ["interests", "activity", "avoid"].map(phase => ({ phase: phase as FlowSnapshot["phase"], answers: base, currentPair: null, draftComparison: null }));
  answers.comparisons.forEach((pair, index) => history.push({ phase: "compare", answers: { ...answers, comparisons: answers.comparisons.slice(0, index) }, currentPair: { left: pair.left, right: pair.right, separation: 0 }, draftComparison: pair.value }));
  return { phase: "results", answers, history, currentPair: null, draftComparison: null };
}
