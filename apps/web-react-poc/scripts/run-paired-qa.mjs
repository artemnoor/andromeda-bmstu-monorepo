import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const modes = new Map([
  ["visual", "@visual"],
  ["benchmark", "@benchmark"],
  ["all", "@paired"],
]);
const mode = process.argv[2] ?? "all";
const grep = modes.get(mode);

if (!grep) {
  process.stderr.write("Usage: node scripts/run-paired-qa.mjs [visual|benchmark|all]\n");
  process.exit(2);
}

const playwrightCli = fileURLToPath(new URL("../node_modules/@playwright/test/cli.js", import.meta.url));
const appRoot = fileURLToPath(new URL("..", import.meta.url));

const build = spawn("npm", ["run", "build"], {
  cwd: appRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
});
const buildResult = await new Promise((resolve) => {
  build.on("error", (error) => resolve({ error }));
  build.on("exit", (code, signal) => resolve({ code, signal }));
});
if ("error" in buildResult) {
  process.stderr.write(`Could not build the React prototype: ${buildResult.error.message}\n`);
  process.exit(1);
}
if (buildResult.signal || buildResult.code !== 0) {
  process.stderr.write(`React prototype build failed (${buildResult.signal ?? buildResult.code}).\n`);
  process.exit(buildResult.signal ? 1 : buildResult.code ?? 1);
}

const child = spawn(process.execPath, [
  playwrightCli,
  "test",
  "--config=scripts/paired-playwright.config.ts",
  "--grep",
  grep,
], {
  stdio: "inherit",
  cwd: appRoot,
  env: { ...process.env, ANDROMEDA_PAIRED_QA: "1" },
});

child.on("error", (error) => {
  process.stderr.write(`Could not start Playwright: ${error.message}\n`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = signal ? 1 : code ?? 1;
});
