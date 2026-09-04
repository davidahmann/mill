import { spawn } from "node:child_process";
import { cp, lstat, mkdtemp, realpath, rm } from "node:fs/promises";
import path from "node:path";

// Environment preparation only: the native package scripts remain the oracle.
const command = process.argv[2];
if (
  process.argv.length !== 3 ||
  !["check", "test:coverage", "test:package"].includes(command)
) {
  throw new Error(
    "Expected exactly one native command: check, test:coverage, or test:package",
  );
}
if (
  process.platform !== "linux" ||
  process.version !== "v24.20.0" ||
  process.getuid?.() === 0 ||
  (await realpath(process.cwd())) !== "/workspace"
) {
  throw new Error("Run only in the approved non-root maintainer OCI verifier");
}

const scratch = "/workspace/.mill-scratch";
const information = await lstat(scratch);
if (
  !information.isDirectory() ||
  information.isSymbolicLink() ||
  (await realpath(scratch)) !== scratch
) {
  throw new Error("Maintainer scratch must be the declared real directory");
}
const fixtureRoot = "/mill-fixtures";
const fixtureInformation = await lstat(fixtureRoot);
if (
  !fixtureInformation.isDirectory() ||
  fixtureInformation.isSymbolicLink() ||
  (await realpath(fixtureRoot)) !== fixtureRoot
) {
  throw new Error("Explicit executable fixture scratch is required");
}
const temporary = await mkdtemp(path.join(scratch, "native-"));
let tmp;
try {
  const cache = path.join(temporary, "npm-cache");
  tmp = await mkdtemp(path.join(fixtureRoot, "native-"));
  // npm mutates cache indexes even offline. Never make the seed writable.
  await cp("/opt/npm-cache", cache, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  const child = spawn("/usr/local/bin/npm", ["run", command], {
    cwd: "/workspace",
    env: {
      ...process.env,
      HOME: tmp,
      TMPDIR: tmp,
      npm_config_cache: cache,
      npm_config_offline: "true",
      npm_config_audit: "false",
      npm_config_fund: "false",
    },
    stdio: "inherit",
  });
  const outcome = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  if (outcome.signal !== null)
    throw new Error(`Native command terminated by ${outcome.signal}`);
  process.exitCode = outcome.code ?? 1;
} finally {
  // This exact child directory was created by this process in bounded scratch.
  await rm(temporary, { recursive: true, force: true });
  if (tmp !== undefined) await rm(tmp, { recursive: true, force: true });
}
