/** Stable, URL-safe identity, including programs whose official codes repeat. */
export function programPath(program: { code: string; external_key: string }): string {
  let hash = 2166136261;
  for (const character of program.external_key) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `/programs/${program.code.replace(/[^\w.-]/g, "-")}-${(hash >>> 0).toString(36)}`;
}
