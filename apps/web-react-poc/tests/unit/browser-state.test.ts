import { describe, expect, it } from "vitest";
import {
  COMPARE_OVERFLOW_KEY,
  LEGACY_STORAGE_KEYS,
  STORAGE_KEYS,
  readList,
  writeList,
  type StorageStatus,
} from "../../src/shared/browser-state/storage";

class MemoryStorage {
  private readonly values = new Map<string, string>();
  failWrites = false;

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error("quota exceeded");
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("browser-state list compatibility", () => {
  it("merges canonical and legacy values once, deduplicating stable IDs", () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEYS.compare, JSON.stringify(["program:a", "program:b"]));
    storage.setItem(LEGACY_STORAGE_KEYS.compare, JSON.stringify(["program:b", "program:c"]));

    expect(readList("compare", storage)).toEqual(["program:a", "program:b", "program:c"]);
    expect(storage.getItem(STORAGE_KEYS.compare)).toBe(JSON.stringify(["program:a", "program:b", "program:c"]));
    expect(storage.getItem(LEGACY_STORAGE_KEYS.compare)).toBeNull();
  });

  it("keeps comparison overflow in the original overflow key before retiring legacy data", () => {
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_STORAGE_KEYS.compare, JSON.stringify([
      "program:a", "program:b", "program:c", "program:d", "program:e",
    ]));

    expect(readList("compare", storage)).toEqual(["program:a", "program:b", "program:c"]);
    expect(JSON.parse(storage.getItem(COMPARE_OVERFLOW_KEY) ?? "null")).toEqual(["program:d", "program:e"]);
    expect(storage.getItem(LEGACY_STORAGE_KEYS.compare)).toBeNull();
  });

  it("does not delete legacy comparison values when overflow cannot be persisted", () => {
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_STORAGE_KEYS.compare, JSON.stringify([
      "program:a", "program:b", "program:c", "program:d",
    ]));
    storage.failWrites = true;

    expect(readList("compare", storage)).toEqual(["program:a", "program:b", "program:c"]);
    expect(storage.getItem(LEGACY_STORAGE_KEYS.compare)).not.toBeNull();
  });

  it("preserves all unique favorites and ignores malformed/non-string list entries", () => {
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_STORAGE_KEYS.favorites, JSON.stringify([
      " program:a ", "program:a", "", 9, null, "program:b",
    ]));

    expect(readList("favorites", storage)).toEqual(["program:a", "program:b"]);
  });

  it("caps writes without storing server records or changing stable identifiers", () => {
    const storage = new MemoryStorage();
    const result: StorageStatus = writeList("compare", ["program:a", "program:b", "program:c", "program:d"], storage);

    expect(result).toBe("available");
    expect(storage.getItem(STORAGE_KEYS.compare)).toBe(JSON.stringify(["program:a", "program:b", "program:c"]));
  });

  it("leaves corrupt legacy JSON intact when there are no valid values to migrate", () => {
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_STORAGE_KEYS.compare, "{bad json");

    expect(readList("compare", storage)).toEqual([]);
    expect(storage.getItem(LEGACY_STORAGE_KEYS.compare)).toBe("{bad json");
  });
});
