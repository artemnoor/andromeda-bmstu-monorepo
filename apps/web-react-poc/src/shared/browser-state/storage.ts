export const STORAGE_KEYS = {
  favorites: "andromeda.favorites.v1",
  compare: "andromeda.compare.v1",
} as const;

export const LEGACY_STORAGE_KEYS = {
  favorites: "andromeda-favorite-programs-v1",
  compare: "andromeda-compare-programs-v1",
} as const;

export const COMPARE_OVERFLOW_KEY = "andromeda.compare.migration-overflow.v1";
export const MAX_COMPARE_PROGRAMS = 3;

export type ListKind = keyof typeof STORAGE_KEYS;
export type StorageStatus = "available" | "unavailable";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Listener = () => void;

const listeners = new Set<Listener>();
const emptySnapshot: readonly string[] = Object.freeze([]);
const snapshots: Record<ListKind, { signature: string | null; values: readonly string[] }> = {
  compare: { signature: null, values: emptySnapshot },
  favorites: { signature: null, values: emptySnapshot },
};

function notify(): void {
  listeners.forEach((listener) => listener());
}

function readJson(storage: StorageLike, key: string): unknown {
  try {
    const value = storage.getItem(key);
    return value === null ? null : JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string => (
    typeof entry === "string" && entry.trim().length > 0
  )).map((entry) => entry.trim()))];
}

function safeBrowserStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function writeJson(storage: StorageLike, key: string, value: unknown): boolean {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function remove(storage: StorageLike, key: string): boolean {
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function cap(kind: ListKind, values: string[]): string[] {
  return kind === "compare" ? values.slice(0, MAX_COMPARE_PROGRAMS) : values;
}

/**
 * Read one of the original app's persisted lists and migrate its legacy key.
 * Comparison overflow is kept in the original dedicated key before the legacy
 * key is removed, so a storage quota error never deletes the user's old data.
 */
export function readList(kind: ListKind, storage = safeBrowserStorage()): string[] {
  if (!storage) return [];

  const canonical = uniqueStrings(readJson(storage, STORAGE_KEYS[kind]));
  const legacy = uniqueStrings(readJson(storage, LEGACY_STORAGE_KEYS[kind]));
  const merged = uniqueStrings([...canonical, ...legacy]);
  const active = cap(kind, merged);
  const hasLegacy = legacy.length > 0;

  if (kind === "compare" && merged.length > MAX_COMPARE_PROGRAMS) {
    const existingOverflow = uniqueStrings(readJson(storage, COMPARE_OVERFLOW_KEY));
    const overflow = uniqueStrings([...existingOverflow, ...merged.slice(MAX_COMPARE_PROGRAMS)]);
    if (!writeJson(storage, COMPARE_OVERFLOW_KEY, overflow)) return active;
  }

  if (hasLegacy || canonical.length !== active.length) {
    if (writeJson(storage, STORAGE_KEYS[kind], active) && hasLegacy) {
      remove(storage, LEGACY_STORAGE_KEYS[kind]);
    }
  }

  return active;
}

export function writeList(kind: ListKind, values: readonly string[], storage = safeBrowserStorage()): StorageStatus {
  if (!storage) return "unavailable";
  const normalized = cap(kind, uniqueStrings(values));
  if (!writeJson(storage, STORAGE_KEYS[kind], normalized)) return "unavailable";
  remove(storage, LEGACY_STORAGE_KEYS[kind]);
  snapshots[kind] = { signature: null, values: Object.freeze(normalized) };
  notify();
  return "available";
}

export function toggleListValue(kind: ListKind, key: string, enabled: boolean): StorageStatus {
  if (!key.trim()) return "available";
  const current = readList(kind);
  const withoutKey = current.filter((entry) => entry !== key);
  if (enabled && kind === "compare" && withoutKey.length >= MAX_COMPARE_PROGRAMS) {
    return "available";
  }
  return writeList(kind, enabled ? [...withoutKey, key] : withoutKey);
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  if (typeof window === "undefined") return () => listeners.delete(listener);
  const onStorage = (event: StorageEvent) => {
    if (
      event.key === STORAGE_KEYS.compare
      || event.key === STORAGE_KEYS.favorites
      || event.key === LEGACY_STORAGE_KEYS.compare
      || event.key === LEGACY_STORAGE_KEYS.favorites
    ) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function getComparisonSnapshot(): readonly string[] {
  return getStableSnapshot("compare");
}

export function getFavoritesSnapshot(): readonly string[] {
  return getStableSnapshot("favorites");
}

function getStableSnapshot(kind: ListKind): readonly string[] {
  const storage = safeBrowserStorage();
  if (!storage) return emptySnapshot;
  let signature: string;
  try {
    signature = [
      storage.getItem(STORAGE_KEYS[kind]),
      storage.getItem(LEGACY_STORAGE_KEYS[kind]),
      kind === "compare" ? storage.getItem(COMPARE_OVERFLOW_KEY) : "",
    ].join("\u0000");
  } catch {
    return emptySnapshot;
  }
  const cached = snapshots[kind];
  if (cached.signature === signature) return cached.values;
  const values = Object.freeze(readList(kind, storage));
  snapshots[kind] = { signature: null, values };
  // readList may migrate the stored representation, so calculate its new signature.
  try {
    snapshots[kind].signature = [
      storage.getItem(STORAGE_KEYS[kind]),
      storage.getItem(LEGACY_STORAGE_KEYS[kind]),
      kind === "compare" ? storage.getItem(COMPARE_OVERFLOW_KEY) : "",
    ].join("\u0000");
  } catch {
    snapshots[kind].signature = null;
  }
  return values;
}

export function getStorageStatus(): StorageStatus {
  return safeBrowserStorage() ? "available" : "unavailable";
}

/** Test seam for storage migration without requiring a DOM. */
export const storageTestUtils = { uniqueStrings, cap };
