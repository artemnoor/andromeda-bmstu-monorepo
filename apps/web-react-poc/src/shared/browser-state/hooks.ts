import { useSyncExternalStore } from "react";
import {
  getComparisonSnapshot,
  getFavoritesSnapshot,
  subscribe,
  toggleListValue,
  writeList,
} from "./storage";

export function useComparisonSelection(): readonly string[] {
  return useSyncExternalStore(subscribe, getComparisonSnapshot, () => []);
}

export function useFavorites(): readonly string[] {
  return useSyncExternalStore(subscribe, getFavoritesSnapshot, () => []);
}

export const comparisonSelection = {
  set: (keys: readonly string[]) => writeList("compare", keys),
  toggle: (key: string, enabled: boolean) => toggleListValue("compare", key, enabled),
};

export const favoritesSelection = {
  set: (keys: readonly string[]) => writeList("favorites", keys),
  toggle: (key: string, enabled: boolean) => toggleListValue("favorites", key, enabled),
};
