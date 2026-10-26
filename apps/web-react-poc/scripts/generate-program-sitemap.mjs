import { readdir, writeFile } from "node:fs/promises";

const origin = "https://andromedabmstu.ru";
const programs = (await readdir("build/client/programs", { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && /^[\w.-]+$/.test(entry.name))
  .map((entry) => `/programs/${entry.name}`).sort();
if (!programs.length) throw new Error("No prerendered program pages found");
const paths = ["/", "/programs", "/discover", "/compare", "/feedback", ...programs];
await writeFile("build/client/sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths.map((path) => `  <url><loc>${origin}${path}</loc></url>`).join("\n")}\n</urlset>\n`);
console.log(`Sitemap: ${programs.length} program pages and 5 main pages`);
