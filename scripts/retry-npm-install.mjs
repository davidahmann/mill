import { spawnSync } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const [workingDirectory = process.cwd(), specifier] = process.argv.slice(2);
if (specifier === undefined || specifier.length === 0) {
  throw new Error(
    "usage: retry-npm-install.mjs [working-directory] <package-specifier>",
  );
}

const attempts = parseBoundedInteger(
  process.env.MILL_NPM_INSTALL_ATTEMPTS,
  12,
  1,
  20,
  "MILL_NPM_INSTALL_ATTEMPTS",
);
const delayMs = parseBoundedInteger(
  process.env.MILL_NPM_INSTALL_DELAY_MS,
  10_000,
  0,
  60_000,
  "MILL_NPM_INSTALL_DELAY_MS",
);
const resolvedWorkingDirectory = path.resolve(workingDirectory);

function parseBoundedInteger(value, fallback, minimum, maximum, name) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

let lastFailure = "npm install failed without diagnostic output";
for (let attempt = 1; attempt <= attempts; attempt += 1) {
  const result = spawnSync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--prefer-online",
      specifier,
    ],
    {
      cwd: resolvedWorkingDirectory,
      encoding: "utf8",
      env: process.env,
      maxBuffer: 4 * 1024 * 1024,
      timeout: 60_000,
    },
  );
  if (result.status === 0) {
    process.stdout.write(result.stdout);
    process.exit(0);
  }
  lastFailure =
    result.error === undefined
      ? `${result.stderr}${result.stdout}`.trim().slice(-4_096)
      : String(result.error);
  if (attempt < attempts) {
    process.stderr.write(
      `npm package readback attempt ${attempt}/${attempts} failed; retrying in ${delayMs}ms\n`,
    );
    await delay(delayMs);
  }
}

throw new Error(
  `npm package readback did not settle after ${attempts} attempts: ${lastFailure}`,
);
