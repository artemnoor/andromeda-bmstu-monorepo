import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = path.join(appRoot, "tools", "server.mjs");

async function reservePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

test("API proxy contains a broken upstream response stream and keeps serving requests", async (t) => {
  const upstream = createServer((request, response) => {
    if (request.url === "/api/v1/stalled") return;
    if (request.url === "/api/v1/broken") {
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.write("partial response");
      setImmediate(() => response.destroy(new Error("fixture upstream disconnect")));
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const upstreamPort = upstream.address().port;
  const webPort = await reservePort();
  const child = spawn(process.execPath, [serverPath, "--port", String(webPort)], {
    cwd: appRoot,
    env: { ...process.env, HOST: "127.0.0.1", API_ORIGIN: `http://127.0.0.1:${upstreamPort}`, API_PROXY_TIMEOUT_MS: "100" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    child.kill();
    if (child.exitCode === null) await once(child, "exit");
    await new Promise((resolve) => upstream.close(() => resolve()));
  });

  const ready = new Promise((resolve, reject) => {
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      if (output.includes(`http://127.0.0.1:${webPort}/`)) resolve();
    });
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`web server exited before readiness (${code}): ${output}`)));
  });
  await ready;

  await assert.rejects(fetch(`http://127.0.0.1:${webPort}/api/v1/broken`).then((response) => response.text()));
  const timedOut = await fetch(`http://127.0.0.1:${webPort}/api/v1/stalled`);
  assert.equal(timedOut.status, 502);
  assert.deepEqual(await timedOut.json(), {
    error: { code: "api_proxy_unavailable", message: "FastAPI is not reachable from the web dev server." },
  });
  const proxied = await fetch(`http://127.0.0.1:${webPort}/api/v1/healthy`);
  assert.equal(proxied.status, 200);
  assert.deepEqual(await proxied.json(), { ok: true });
  const staticPage = await fetch(`http://127.0.0.1:${webPort}/index.html`);
  assert.equal(staticPage.status, 200);
});
