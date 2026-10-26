import { useSyncExternalStore } from "react";
import { trackEvent } from "@/shared/analytics/analytics";
import {
  getComparisonSnapshot,
  getFavoritesSnapshot,
  subscribe,
  toggleListValue,
  writeList,
} from "./storage";

const emptySelection: readonly string[] = Object.freeze([]);
const subscribeToHydration = () => () => {};

/** Use the build-time URL state until hydration finishes, then apply the visitor's query. */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribeToHydration, () => true, () => false);
}

export function useComparisonSelection(): readonly string[] {
  return useSyncExternalStore(subscribe, getComparisonSnapshot, () => emptySelection);
}

/** Cards only redraw when their own membership changes. */
export function useIsCompared(programKey: string): boolean {
  return useSyncExternalStore(subscribe, () => getComparisonSnapshot().includes(programKey), () => false);
}

export function useFavorites(): readonly string[] {
  return useSyncExternalStore(subscribe, getFavoritesSnapshot, () => emptySelection);
}

export const comparisonSelection = {
  set: (keys: readonly string[], trackChanges = true) => {
    const before = getComparisonSnapshot();
    const status = writeList("compare", keys);
    const after = getComparisonSnapshot();
    if (status === "available" && trackChanges) {
      for (const key of after.filter((key) => !before.includes(key))) trackEvent("comparison_program_added", { program_key: key, program_count: after.length });
      for (const key of before.filter((key) => !after.includes(key))) trackEvent("comparison_program_removed", { program_key: key, program_count: after.length });
    }
    return status;
  },
  toggle: (key: string, enabled: boolean) => {
    const before = getComparisonSnapshot();
    const status = toggleListValue("compare", key, enabled);
    const after = getComparisonSnapshot();
    if (status === "available" && before.includes(key) !== after.includes(key)) {
      trackEvent(enabled ? "comparison_program_added" : "comparison_program_removed", { program_key: key, program_count: after.length });
    }
    return status;
  },
};

export const favoritesSelection = {
  set: (keys: readonly string[]) => writeList("favorites", keys),
  toggle: (key: string, enabled: boolean) => {
    const before = getFavoritesSnapshot();
    const status = toggleListValue("favorites", key, enabled);
    if (status === "available" && before.includes(key) !== getFavoritesSnapshot().includes(key)) trackEvent(enabled ? "favorite_program_added" : "favorite_program_removed", { program_key: key });
    return status;
  },
};
