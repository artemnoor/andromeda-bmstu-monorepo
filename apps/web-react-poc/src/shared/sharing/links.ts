export function comparisonPath(keys: readonly string[]): string {
  const params = new URLSearchParams({ shared: "1" });
  [...new Set(keys)].slice(0, 3).forEach(key => params.append("program", key));
  return `/compare?${params}`;
}

export function comparisonKeys(params: URLSearchParams): readonly string[] | null {
  if (!params.has("program") && !params.has("shared")) return null;
  const keys = params.getAll("program");
  // Invalid input must not be treated as an intentional empty shared selection:
  // the comparison route persists valid shared choices in browser storage.
  if ((params.has("shared") && (params.getAll("shared").length !== 1 || params.get("shared") !== "1"))
    || keys.length > 3 || keys.some(key => !key.startsWith("program:") || key.length <= 8 || key.length > 512 || key.trim() !== key)) return null;
  return [...new Set(keys)];
}

export function absoluteLink(path: string): string {
  return new URL(path, window.location.origin).href;
}

export function encodeSharedPayload(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join("")).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function decodeSharedPayload(raw: string): unknown {
  if (!raw || raw.length > 8192 || !/^[\w-]+$/.test(raw)) throw new Error("Invalid shared result");
  const bytes = Uint8Array.from(atob(raw.replaceAll("-", "+").replaceAll("_", "/")), c => c.charCodeAt(0));
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}
