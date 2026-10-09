import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const useDist = process.argv.includes("--dist");
const staticRoot = path.resolve(process.env.APP_STATIC_ROOT || (useDist ? path.join(appRoot, "dist") : appRoot));
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

async function proxyApi(request, response, pathname, search) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" }).end("Method not allowed");
    return;
  }
  try {
    const target = new URL(`${pathname}${search}`, apiOrigin);
    const upstream = await fetch(target, { method: request.method, headers: { Accept: request.headers.accept || "application/json" } });
    response.writeHead(upstream.status, Object.fromEntries(upstream.headers.entries()));
    if (!upstream.body || request.method === "HEAD") response.end();
    else Readable.fromWeb(upstream.body).pipe(response);
  } catch (error) {
    response.writeHead(502, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ error: { code: "api_proxy_unavailable", message: "FastAPI is not reachable from the web dev server." } }));
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
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    response.writeHead(404).end("Not found");
    return;
  }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("Not a file");
    response.writeHead(200, {
      "Content-Type": contentTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(filePath).pipe(response);
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
