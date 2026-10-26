/** Convert a known data endpoint to its public page only when rendering links.
 * Keep the original API URL for provenance, hashes and identity comparisons.
 */
export function publicSourceUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const major = /^\/majors\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/.exec(url.pathname);
    if (url.origin === "https://api.www.bmstu.ru" && !url.username && !url.password && !url.search && major) {
      return `https://bmstu.ru/bachelor/majors/${major[1]}`;
    }
    return url.href;
  } catch {
    return null;
  }
}
