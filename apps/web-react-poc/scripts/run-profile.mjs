import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const playwrightCli = fileURLToPath(new URL("../node_modules/@playwright/test/cli.js", import.meta.url));
const profileEnvironment = {
  ...process.env,
  ANDROMEDA_REACT_PROFILE_BUILD: "1",
};

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: appRoot,
      stdio: "inherit",
      ...options,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) reject(new Error(`${command} exited on ${signal}`));
      else if (code !== 0) reject(new Error(`${command} exited with code ${code ?? 1}`));
      else resolve();
    });
  });
}

try {
  await run("npm", ["run", "build"], {
    env: profileEnvironment,
    shell: process.platform === "win32",
  });
  await run(process.execPath, [
    playwrightCli,
    "test",
    "--config=scripts/profile-playwright.config.ts",
    ...process.argv.slice(2),
  ], { env: profileEnvironment });
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
