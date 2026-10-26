import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

const origin = "https://andromedabmstu.ru";
const paths = ["/", "/programs", "/discover", "/compare", "/feedback"];
const titles = new Set();
const live = process.argv.includes("--live");

async function htmlFor(path) {
  if (!live) return readFile(`build/client${path === "/" ? "" : path}/index.html`, "utf8");
  const response = await fetch(origin + path);
  assert.equal(response.status, 200, path);
  assert.match(response.headers.get("content-type"), /text\/html/);
  return response.text();
}

for (const path of paths) {
  const document = new JSDOM(await htmlFor(path)).window.document;
  assert.equal(document.documentElement.lang, "ru", path);
  assert.equal(document.querySelectorAll("title").length, 1, path);
  const title = document.title;
  assert.ok(title.includes("Андромеда") && title.length > 15, path);
  assert.ok(!titles.has(title), `Duplicate title: ${title}`);
  titles.add(title);
  assert.equal(document.querySelectorAll('meta[name="description"]').length, 1, path);
  assert.equal(document.querySelectorAll('meta[name="robots"]').length, 1, path);
  assert.ok(document.querySelector('meta[name="description"]').content.length > 80, path);
  assert.equal(document.querySelectorAll('link[rel="canonical"]').length, 1, path);
  assert.equal(document.querySelector('link[rel="canonical"]').getAttribute("href"), origin + path, path);
  assert.equal(document.querySelectorAll("h1").length, 1, `No real prerendered h1: ${path}`);
  // The test intentionally has a short opening after removal of the marketing
  // introduction. Its interactive questions load from the verified snapshot.
  assert.ok(document.querySelector("main").textContent.length > (path === "/discover" ? 60 : 150), `Empty document: ${path}`);
  if (path === "/discover") assert.ok(document.querySelector('main [role="status"][aria-label="Готовим профтест"]'), "Missing test loading state");
  assert.ok(!document.querySelector("main").textContent.includes("Открываем Андромеду…"), path);
  assert.equal(document.querySelector('meta[property="og:image"]').content, origin + "/social-preview.png", path);
  assert.ok(document.querySelector('link[rel="icon"][href="/favicon.ico"]'), path);
  assert.ok(document.querySelector('link[rel="icon"][href="/favicon-120x120.png"][sizes="120x120"][type="image/png"]'), path);
  const schemas = [...document.querySelectorAll('script[type="application/ld+json"]')].map(script => JSON.parse(script.textContent));
  assert.equal(schemas.length, 1, path);
  assert.ok(schemas[0]["@graph"].some(item => item["@type"] === "WebPage"), path);
  if (path === "/programs") assert.ok(document.querySelectorAll("article[data-program-key]").length >= 12, "Catalog is an empty loading screen");
  console.log(`${path}: real HTML, unique title, description, canonical, favicon, structured data`);
}

const sitemap = live ? await (await fetch(origin + "/sitemap.xml")).text() : await readFile("build/client/sitemap.xml", "utf8");
const xml = new JSDOM(sitemap, { contentType: "text/xml" }).window.document;
assert.equal(xml.querySelectorAll("parsererror").length, 0);
const sitemapUrls = [...xml.querySelectorAll("loc")].map(item => item.textContent);
assert.deepEqual(sitemapUrls.slice(0, paths.length), paths.map(path => origin + path));
assert.ok(sitemapUrls.slice(paths.length).every(url => /^https:\/\/andromedabmstu\.ru\/programs\/[\w.-]+$/.test(url)));

if (live) {
  for (const path of ["/this-page-does-not-exist-seo-check", "/assets/missing-seo-check.js"]) {
    assert.equal((await fetch(origin + path)).status, 404, path);
  }
  for (const path of ["/favicon.ico", "/favicon-96x96.png", "/favicon-120x120.png", "/apple-touch-icon.png", "/android-chrome-512x512.png", "/social-preview.png", "/site.webmanifest", "/robots.txt", "/programs.data"]) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200, path);
    assert.ok(!response.headers.get("content-type").includes("text/html"), `SPA fallback disguised as asset: ${path}`);
  }
  assert.match((await fetch(origin + "/programs?q=math")).headers.get("x-robots-tag"), /noindex/);
  assert.match((await fetch(origin + "/compare?shared=1")).headers.get("x-robots-tag"), /noindex/);
  for (const path of ["/programs/", "/programs/index.html"]) {
    const response = await fetch(origin + path, { redirect: "manual" });
    assert.equal(response.status, 301, path);
    assert.equal(response.headers.get("location"), origin + "/programs", path);
  }
  for (const page of ["programs", "compare", "discover", "feedback"]) {
    const response = await fetch(`${origin}/${page}.html?utm_source=legacy`, { redirect: "manual" });
    assert.equal(response.status, 301, page);
    assert.equal(response.headers.get("location"), `${origin}/${page}?utm_source=legacy`, page);
  }
  console.log("Live: correct 404, public assets, noindex for filtered/shared URLs, canonical redirects");
} else {
  const document = new JSDOM(await readFile("build/client/404/index.html", "utf8")).window.document;
  assert.match(document.querySelector('meta[name="robots"]').content, /noindex/);
}
console.log("SEO checks passed");
