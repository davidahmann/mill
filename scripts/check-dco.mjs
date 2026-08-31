import { spawnSync } from "node:child_process";

const [base, head] = process.argv.slice(2);
if (base === undefined || head === undefined) {
  throw new Error("usage: check-dco.mjs <base-sha> <head-sha>");
}

const result = spawnSync(
  "/usr/bin/git",
  [
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "core.fsmonitor=false",
    "log",
    "--format=%H%x00%B%x00",
    `${base}..${head}`,
  ],
  {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_OPTIONAL_LOCKS: "0",
    },
    timeout: 10_000,
  },
);
if (result.status !== 0) {
  throw new Error(`unable to read PR commits: ${result.stderr}`);
}

const fields = result.stdout.split("\0").filter(Boolean);
const unsigned = [];
for (let index = 0; index < fields.length; index += 2) {
  const sha = fields[index] ?? "unknown";
  const message = fields[index + 1] ?? "";
  if (!/^Signed-off-by:\s+.+\s+<[^>]+>\s*$/imu.test(message)) {
    unsigned.push(sha);
  }
}
if (unsigned.length > 0) {
  throw new Error(`DCO sign-off missing from commits: ${unsigned.join(", ")}`);
}
process.stdout.write(`DCO check passed for ${fields.length / 2} commit(s)\n`);
