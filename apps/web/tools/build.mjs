import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(appRoot, "dist");
const pages = (await readdir(appRoot)).filter((name) => name.endsWith(".html"));
const legacyApiPatterns = [/d5dh12nf73n2fcovnq82\.4kscn31j\.apigw\.yandexcloud\.net/i, /158\.160\.25\.16/];

if (pages.length !== 9) throw new Error(`Expected 9 original HTML pages, found ${pages.length}`);

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function localReference(reference) {
  return reference
    && !reference.startsWith("#")
    && !reference.startsWith("/")
    && !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(reference);
}

async function validateSource() {
  const runtimeFiles = [
    ...pages.map((name) => path.join(appRoot, name)),
    path.join(appRoot, "app.js"),
    ...await filesUnder(path.join(appRoot, "assets")),
  ];
  for (const runtimeFile of runtimeFiles) {
    const content = /\.(?:html|js|css|svg)$/i.test(runtimeFile)
      ? await readFile(runtimeFile, "utf8")
      : "";
    if (legacyApiPatterns.some((pattern) => pattern.test(content))) {
      throw new Error(`Legacy API gateway reference found in ${path.relative(appRoot, runtimeFile)}`);
    }
    if (runtimeFile.endsWith(".js")) new vm.Script(content, { filename: runtimeFile });
    if (runtimeFile.endsWith(".css")) {
      for (const [, reference] of content.matchAll(/url\(["']?([^"')]+)["']?\)/gi)) {
        const localPath = reference.split(/[?#]/, 1)[0];
        if (localReference(localPath) && !(await exists(path.resolve(path.dirname(runtimeFile), localPath)))) {
          throw new Error(`Missing CSS asset ${localPath} referenced by ${path.relative(appRoot, runtimeFile)}`);
        }
      }
    }
    if (runtimeFile.endsWith(".html")) {
      for (const [, reference] of content.matchAll(/(?:src|href)=["']([^"']+)["']/gi)) {
        const localPath = reference.split(/[?#]/, 1)[0];
        if (localReference(localPath) && !(await exists(path.resolve(appRoot, localPath)))) {
          throw new Error(`Missing page asset ${localPath} referenced by ${path.relative(appRoot, runtimeFile)}`);
        }
      }
      for (const [, script] of content.matchAll(/<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)) {
        new vm.Script(script, { filename: `${runtimeFile} inline script` });
      }
    }
  }

  for (const dataFile of (await filesUnder(path.join(appRoot, "data"))).filter((name) => name.endsWith(".json"))) {
    JSON.parse(await readFile(dataFile, "utf8"));
  }
}

async function exists(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

await validateSource();
if (path.dirname(outputRoot) !== appRoot || path.basename(outputRoot) !== "dist") {
  throw new Error("Refusing to write outside apps/web/dist");
}
await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
for (const page of pages) await cp(path.join(appRoot, page), path.join(outputRoot, page));
for (const entry of ["app.js", "app.css", "assets", "data"]) {
  await cp(path.join(appRoot, entry), path.join(outputRoot, entry), { recursive: true });
}
await writeFile(path.join(outputRoot, ".build-info.json"), JSON.stringify({ pages: pages.length, output: "static-vanilla" }, null, 2) + "\n");
process.stdout.write(`Validated ${pages.length} original pages and built static runtime into ${path.relative(appRoot, outputRoot)}.\n`);
