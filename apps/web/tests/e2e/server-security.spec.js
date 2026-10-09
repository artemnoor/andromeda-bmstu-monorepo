import { expect, test } from "./support.js";
import { mkdtemp, rm, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("static server serves app assets only and rejects project files, traversal, and writes", async ({ request }) => {
  for (const path of [
    "/package.json",
    "/package-lock.json",
    "/README.md",
    "/.gitignore",
    "/tools/server.mjs",
    "/tests/smoke.test.mjs",
    "/.build-info.json",
  ]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(404);
  }

  const traversal = await request.get("/%2e%2e%2fpackage.json");
  expect(traversal.status()).toBe(404);
  for (const path of ["/%2e%2e%5cpackage.json", "/%252e%252e%252fpackage.json"]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(404);
  }

  const allowed = await request.head("/index.html");
  expect(allowed.status()).toBe(200);

  const rejectedWrite = await request.post("/index.html");
  expect(rejectedWrite.status()).toBe(405);
  expect(rejectedWrite.headers().allow).toContain("GET");

  const rejectedProxyWrite = await request.post("/api/v1/health");
  expect(rejectedProxyWrite.status()).toBe(405);
  expect(rejectedProxyWrite.headers().allow).toContain("GET");
});

test("static server rejects an allowed-directory symlink that points outside its root", async ({ request }) => {
  test.skip(process.platform === "win32", "Windows does not guarantee symlink creation permissions in CI");
  const outside = await mkdtemp(path.join(os.tmpdir(), "andromeda-static-escape-"));
  const secretPath = path.join(outside, "secret.json");
  const linkName = `qa-static-escape-${randomUUID()}.json`;
  const linkPath = path.join(appRoot, "assets", linkName);
  try {
    await writeFile(secretPath, JSON.stringify({ secret: "must not be served" }), "utf8");
    await symlink(secretPath, linkPath, "file");
    const response = await request.get(`/assets/${linkName}`);
    expect(response.status()).toBe(404);
    expect(await response.text()).not.toContain("must not be served");
  } finally {
    await unlink(linkPath).catch(() => {});
    await rm(outside, { recursive: true, force: true });
  }
});
