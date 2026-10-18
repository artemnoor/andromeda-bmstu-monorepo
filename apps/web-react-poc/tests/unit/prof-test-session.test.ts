import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  NO_ACTIVITY,
  NO_AVOID,
  UNKNOWN_INTEREST,
  emptyAnswers,
  type SubjectCategory,
} from "@/features/prof-test/model";
import {
  readProfTestSession,
  saveProfTestSession,
  type FlowSnapshot,
  type FlowState,
} from "@/features/prof-test/session";

const KEY = "andromeda.prof-test.session.v1";
const RELEASE = "release:2026";
const categories: readonly SubjectCategory[] = Array.from({ length: 10 }, (_, index) => ({
  code: String(index + 1).padStart(2, "0"), name: `Область ${index}`, definition: "", ordinal: index,
}));

function initial(): FlowState {
  return { phase: "interests", answers: emptyAnswers(), currentPair: null, draftComparison: null, history: [] };
}

function compareDraft(): FlowState {
  const interests = { ...emptyAnswers(), interests: ["01"] };
  const answers = { ...interests, activity: NO_ACTIVITY, avoid: [NO_AVOID] } as const;
  const history: FlowSnapshot[] = [
    { phase: "interests", answers: interests, currentPair: null, draftComparison: null },
    { phase: "activity", answers, currentPair: null, draftComparison: null },
    { phase: "avoid", answers, currentPair: null, draftComparison: null },
  ];
  return {
    phase: "compare", answers, history,
    currentPair: { left: "01", right: "02", separation: 0.25 }, draftComparison: -1,
  };
}

function result(): FlowState {
  let flow = compareDraft();
  for (let index = 0; index < 4; index += 1) {
    const currentPair = { left: categories[index * 2]!.code, right: categories[index * 2 + 1]!.code, separation: 0.25 };
    const step: FlowSnapshot = { ...flow, currentPair, draftComparison: index % 2 === 0 ? 0 : 2 };
    // History entries contain snapshots, without nesting the entire history.
    const completed: FlowSnapshot = {
      phase: step.phase, answers: step.answers, currentPair: step.currentPair, draftComparison: step.draftComparison,
    };
    flow = {
      ...flow,
      answers: { ...flow.answers, comparisons: [...flow.answers.comparisons, {
        left: currentPair.left, right: currentPair.right, value: completed.draftComparison!,
      }] },
      history: [...flow.history, completed],
      currentPair: index === 3 ? null : { left: categories[index * 2 + 2]!.code, right: categories[index * 2 + 3]!.code, separation: 0.25 },
      draftComparison: null,
      phase: index === 3 ? "results" : "compare",
    };
  }
  return flow;
}

function storeRaw(flow: unknown, overrides: Record<string, unknown> = {}) {
  sessionStorage.setItem(KEY, JSON.stringify({ version: 1, releaseKey: RELEASE, flow, ...overrides }));
}

beforeEach(() => sessionStorage.clear());

describe("release-bound career test session", () => {
  it("round trips initial state and the current unanswered draft", () => {
    expect(saveProfTestSession(RELEASE, initial())).toBe(true);
    expect(readProfTestSession(RELEASE, categories)).toEqual(initial());
    const flow = compareDraft();
    expect(saveProfTestSession(RELEASE, flow)).toBe(true);
    expect(readProfTestSession(RELEASE, categories)).toEqual(flow);
    expect(Object.keys(JSON.parse(sessionStorage.getItem(KEY)!))).toEqual(["version", "releaseKey", "flow"]);
  });

  it("round trips results with all four comparisons and bounded back history", () => {
    const flow = result();
    expect(flow.history).toHaveLength(7);
    expect(saveProfTestSession(RELEASE, flow)).toBe(true);
    expect(readProfTestSession(RELEASE, categories)).toEqual(flow);
  });

  it("preserves the unknown interest and no-preference sentinels", () => {
    const flow = initial();
    const unknown = { ...flow, answers: { ...flow.answers, interests: [UNKNOWN_INTEREST], activity: NO_ACTIVITY, avoid: [NO_AVOID] } } as const;
    expect(saveProfTestSession(RELEASE, unknown)).toBe(true);
    expect(readProfTestSession(RELEASE, categories)).toEqual(unknown);
  });

  it("does not restore a session belonging to another release or schema", () => {
    expect(saveProfTestSession(RELEASE, compareDraft())).toBe(true);
    expect(readProfTestSession("release:other", categories)).toBeNull();
    storeRaw(initial(), { version: 2 });
    expect(readProfTestSession(RELEASE, categories)).toBeNull();
  });

  it("rejects category identifiers absent from the current taxonomy", () => {
    expect(saveProfTestSession(RELEASE, compareDraft())).toBe(true);
    expect(readProfTestSession(RELEASE, categories.filter(({ code }) => code !== "02"))).toBeNull();
    storeRaw({ ...initial(), answers: { ...emptyAnswers(), interests: ["unknown-category"] } });
    expect(readProfTestSession(RELEASE, categories)).toBeNull();
  });

  it("ignores malformed JSON, extra fields and oversized persisted values", () => {
    sessionStorage.setItem(KEY, "{broken");
    expect(readProfTestSession(RELEASE, categories)).toBeNull();
    storeRaw(initial(), { ranking: [] });
    expect(readProfTestSession(RELEASE, categories)).toBeNull();
    sessionStorage.setItem(KEY, " ".repeat(32_769));
    expect(readProfTestSession(RELEASE, categories)).toBeNull();
  });

  it("keeps the test usable with explicitly disabled or inaccessible storage", () => {
    expect(readProfTestSession(RELEASE, categories, null)).toBeNull();
    expect(saveProfTestSession(RELEASE, initial(), null)).toBe(false);
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
    expect(readProfTestSession(RELEASE, categories)).toBeNull();
    expect(saveProfTestSession(RELEASE, initial())).toBe(false);
  });

  it("handles storage read errors and quota errors without throwing", () => {
    const broken = {
      getItem() { throw new Error("Read blocked"); },
      setItem() { throw new Error("Quota exceeded"); },
    } as unknown as Storage;
    expect(readProfTestSession(RELEASE, categories, broken)).toBeNull();
    expect(saveProfTestSession(RELEASE, initial(), broken)).toBe(false);
  });

  it.each([
    ["compare without pair", () => ({ ...compareDraft(), currentPair: null })],
    ["results with active pair", () => ({ ...result(), currentPair: compareDraft().currentPair })],
    ["out-of-range draft", () => ({ ...compareDraft(), draftComparison: 3 })],
    ["fractional draft", () => ({ ...compareDraft(), draftComparison: 0.5 })],
    ["invalid activity", () => ({ ...initial(), answers: { ...emptyAnswers(), activity: "unknown-format" } })],
    ["mixed sentinel", () => ({ ...initial(), answers: { ...emptyAnswers(), interests: [UNKNOWN_INTEREST, "01"] } })],
    ["too many interests", () => ({ ...initial(), answers: { ...emptyAnswers(), interests: categories.slice(0, 6).map(({ code }) => code) } })],
    ["too many avoided areas", () => ({ ...initial(), answers: { ...emptyAnswers(), avoid: categories.slice(0, 4).map(({ code }) => code) } })],
    ["duplicate selection", () => ({ ...initial(), answers: { ...emptyAnswers(), interests: ["01", "01"] } })],
    ["oversized identifier", () => ({ ...initial(), answers: { ...emptyAnswers(), interests: ["x".repeat(129)] } })],
    ["oversized history", () => ({ ...result(), history: [...result().history, initial()] })],
    ["missing back history", () => ({ ...compareDraft(), history: [] })],
    ["incoherent answered history", () => ({ ...result(), answers: { ...result().answers, comparisons: [{ left: "09", right: "10", value: 1 }] } })],
  ])("rejects %s on read and save", (_name, create) => {
    const flow = create();
    storeRaw(flow);
    expect(readProfTestSession(RELEASE, categories)).toBeNull();
    expect(saveProfTestSession(RELEASE, flow as FlowState)).toBe(false);
  });

  it("rejects repeated subject pairs even if they fit within comparison count bounds", () => {
    const flow = result();
    const first = flow.answers.comparisons[0]!;
    storeRaw({ ...flow, answers: { ...flow.answers, comparisons: [first, first] } });
    expect(readProfTestSession(RELEASE, categories)).toBeNull();
  });
});
