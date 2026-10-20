import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AcademicApiContractError } from "@/shared/api/client";
import { loadProfTestData } from "@/features/prof-test/api";

vi.mock("@/shared/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/api/client")>();
  return {
    ...actual,
    loadCatalog: vi.fn(async () => ({
      release: { release_key: "release:test" },
      programs: { items: [] },
      directions: { items: [] },
      departments: { items: [] },
    })),
    listStudyPlans: vi.fn(async () => ({ releaseKey: "release:test", items: [] })),
  };
});

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function pendingUntilAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

describe("career test snapshot request boundaries", () => {
  it("times out a stalled snapshot fetch and permits a subsequent retry", async () => {
    fetchMock.mockImplementationOnce((_: unknown, init: RequestInit) => pendingUntilAborted(init.signal!));
    const outcome = expect(loadProfTestData()).rejects.toMatchObject({ code: "request_timeout", status: 0 });
    await vi.advanceTimersByTimeAsync(15_000);
    await outcome;
    expect(vi.getTimerCount()).toBe(0);

    fetchMock.mockResolvedValueOnce(new Response("null", { status: 200 }));
    await expect(loadProfTestData()).rejects.toBeInstanceOf(AcademicApiContractError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("also bounds reading a stalled response body", async () => {
    fetchMock.mockImplementationOnce(async (_: unknown, init: RequestInit) => ({
      ok: true,
      json: () => pendingUntilAborted(init.signal!),
    }));
    const outcome = expect(loadProfTestData()).rejects.toMatchObject({ code: "request_timeout" });
    await vi.advanceTimersByTimeAsync(15_000);
    await outcome;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves caller cancellation and removes the timeout and listener", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    fetchMock.mockImplementationOnce((_: unknown, init: RequestInit) => pendingUntilAborted(init.signal!));
    const reason = new DOMException("Navigation changed", "AbortError");
    const outcome = expect(loadProfTestData(controller.signal)).rejects.toBe(reason);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(reason);
    await outcome;
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not start a snapshot fetch when the caller has already cancelled", async () => {
    const controller = new AbortController();
    const reason = new DOMException("Navigation changed", "AbortError");
    controller.abort(reason);
    await expect(loadProfTestData(controller.signal)).rejects.toBe(reason);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps invalid JSON separate from network and timeout failures", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{broken", { status: 200 }));
    await expect(loadProfTestData()).rejects.toBeInstanceOf(AcademicApiContractError);
    expect(vi.getTimerCount()).toBe(0);
  });
});
