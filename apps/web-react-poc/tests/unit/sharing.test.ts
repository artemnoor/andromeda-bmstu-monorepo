import { describe, expect, it } from "vitest";
import { comparisonKeys, comparisonPath, decodeSharedPayload, encodeSharedPayload } from "@/shared/sharing/links";
import { profTestResultPath, readSharedResult } from "@/features/prof-test/shared-result";
import { NO_ACTIVITY, NO_AVOID, type CareerTestAnswers } from "@/features/prof-test/model";
import { readProfTestSession, saveProfTestSession } from "@/features/prof-test/session";

const categories = ["01", "02", "03", "04"].map((code, ordinal) => ({ code, name: `Область ${code}`, definition: "", ordinal }));
const answers: CareerTestAnswers = { interests: ["01"], activity: NO_ACTIVITY, avoid: [NO_AVOID], comparisons: [{ left: "01", right: "02", value: 2 }] };
const release = "bmstu:выпуск-2026";

describe("shared comparisons", () => {
  it("roundtrips three canonical program keys including Cyrillic without browser storage", () => {
    const keys = ["program:bmstu:ИУ9:1", "program:bmstu:ФН11:2", "program:bmstu:ИУ7:3"];
    expect(comparisonKeys(new URL(comparisonPath(keys), "https://andromeda.test").searchParams)).toEqual(keys);
  });
  it("distinguishes a shared empty selection from a local selection and rejects malformed input", () => {
    expect(comparisonKeys(new URLSearchParams())).toBeNull();
    expect(comparisonKeys(new URLSearchParams("shared=1"))).toEqual([]);
    expect(comparisonKeys(new URLSearchParams("program=bad"))).toBeNull();
    expect(comparisonKeys(new URLSearchParams("program=program:a&program=program:b&program=program:c&program=program:d"))).toBeNull();
    expect(comparisonKeys(new URLSearchParams("shared=wrong"))).toBeNull();
    expect(comparisonKeys(new URLSearchParams("shared=1&shared=wrong"))).toBeNull();
    expect(comparisonKeys(new URLSearchParams("program=program:"))).toBeNull();
  });
});

describe("shared prof-test results", () => {
  const raw = () => new URL(profTestResultPath(release, answers), "https://andromeda.test").searchParams.get("result")!;
  it("recreates a result and valid editable session from answers", () => {
    const result = readSharedResult(raw(), release, categories);
    expect(result.phase).toBe("results");
    expect(result.answers).toEqual(answers);
    expect(result.history).toHaveLength(4);
    const storage = new Map<string, string>();
    const target: Storage = { get length() { return storage.size; }, clear: () => storage.clear(), key: i => [...storage.keys()][i] ?? null, removeItem: k => { storage.delete(k); }, getItem: k => storage.get(k) ?? null, setItem: (k, v) => { storage.set(k, v); } };
    expect(saveProfTestSession(release, result, target)).toBe(true);
    expect(readProfTestSession(release, categories, target)?.answers).toEqual(answers);
  });
  it("does not recompute an old release as if it were the original result", () => {
    expect(() => readSharedResult(raw(), "new-release", categories)).toThrow("прежней версии");
  });
  it("rejects corrupted, oversized and unknown-category payloads", () => {
    expect(() => readSharedResult("bad!", release, categories)).toThrow("повреждена");
    expect(() => readSharedResult("a".repeat(8193), release, categories)).toThrow("повреждена");
    expect(() => readSharedResult(raw(), release, categories.slice(2))).toThrow("некорректные");
  });
  it("preserves Unicode in versioned payloads", () => {
    expect(decodeSharedPayload(encodeSharedPayload({ text: "МГТУ · ИУ9" }))).toEqual({ text: "МГТУ · ИУ9" });
  });
});
