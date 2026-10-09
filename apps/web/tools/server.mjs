import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const useDist = process.argv.includes("--dist");
const staticRoot = path.resolve(process.env.APP_STATIC_ROOT || (useDist ? path.join(appRoot, "dist") : appRoot));
const configuredApiTimeout = Number(process.env.API_PROXY_TIMEOUT_MS);
const apiProxyTimeoutMs = Number.isFinite(configuredApiTimeout) && configuredApiTimeout > 0 ? configuredApiTimeout : 20_000;
const publicPages = new Set([
  "index.html",
  "first-screen.html",
  "programs.html",
  "compare.html",
  "favorites.html",
  "profile.html",
  "admission.html",
  "discover.html",
  "workspace.html",
]);
const publicRootFiles = new Set([...publicPages, "app.js", "app.css"]);
const host = process.env.HOST || "127.0.0.1";
const portIndex = process.argv.indexOf("--port");
const numericArgument = process.argv.find((argument) => /^\d{1,5}$/.test(argument));
const port = Number((portIndex >= 0 && process.argv[portIndex + 1]) || numericArgument || process.env.PORT || 4173);
const apiOrigin = new URL(process.env.API_ORIGIN || "http://127.0.0.1:8000");
const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
]);

function isApiPath(pathname) {
  return pathname.startsWith("/api/") || ["/docs", "/openapi.json", "/redoc"].includes(pathname);
}

function isPublicStaticPath(relativePath) {
  const segments = relativePath.split(path.sep).filter(Boolean);
  if (!segments.length || segments.some((segment) => segment.startsWith("."))) return false;
  if (segments.length === 1) return publicRootFiles.has(segments[0]);
  return ["assets", "data"].includes(segments[0]);
}

async function proxyApi(request, response, pathname, search) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" }).end("Method not allowed");
    return;
  }
  try {
    const target = new URL(`${pathname}${search}`, apiOrigin);
    const upstream = await fetch(target, {
      method: request.method,
      headers: { Accept: request.headers.accept || "application/json" },
      signal: AbortSignal.timeout(apiProxyTimeoutMs),
    });
    response.writeHead(upstream.status, Object.fromEntries(upstream.headers.entries()));
    if (!upstream.body || request.method === "HEAD") response.end();
    else {
      try {
        await pipeline(Readable.fromWeb(upstream.body), response);
      } catch {
        if (response.headersSent) response.destroy();
        else {
          response.writeHead(502, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          response.end(JSON.stringify({ error: { code: "api_proxy_unavailable", message: "FastAPI response ended unexpectedly." } }));
        }
      }
    }
  } catch (error) {
    if (response.headersSent) response.destroy();
    else {
      response.writeHead(502, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ error: { code: "api_proxy_unavailable", message: "FastAPI is not reachable from the web dev server." } }));
    }
  }
}

const server = createServer(async (request, response) => {
  let url;
  try {
    url = new URL(request.url || "/", "http://localhost");
  } catch {
    response.writeHead(400).end("Bad request");
    return;
  }
  if (isApiPath(url.pathname)) {
    await proxyApi(request, response, url.pathname, url.search);
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end("Method not allowed");
    return;
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    response.writeHead(400).end("Bad path");
    return;
  }
  const requestedPath = decodedPath === "/" ? "/index.html" : decodedPath;
  const filePath = path.resolve(staticRoot, requestedPath.replace(/^\/+/, ""));
  const relativePath = path.relative(staticRoot, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath) || !isPublicStaticPath(relativePath)) {
    response.writeHead(404).end("Not found");
    return;
  }
  try {
    const canonicalRoot = await realpath(staticRoot);
    const canonicalPath = await realpath(filePath);
    const canonicalRelative = path.relative(canonicalRoot, canonicalPath);
    if (canonicalRelative.startsWith("..") || path.isAbsolute(canonicalRelative)) {
      response.writeHead(404).end("Not found");
      return;
    }
    const info = await stat(canonicalPath);
    if (!info.isFile()) throw new Error("Not a file");
    response.writeHead(200, {
      "Content-Type": contentTypes.get(path.extname(canonicalPath).toLowerCase()) || "application/octet-stream",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(canonicalPath).pipe(response);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
  }
});

server.listen(port, host, () => {
  process.stdout.write(`Andromeda web ${useDist ? "preview" : "dev"} server: http://${host}:${port}/ (API proxy: ${apiOrigin.origin})\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
