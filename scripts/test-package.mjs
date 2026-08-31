import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(path.join(tmpdir(), "mill-package-"));
const npmCli = process.env.npm_execpath;

if (npmCli === undefined) {
  throw new Error("npm_execpath is required for package validation");
}

function npm(args, cwd) {
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_audit: "false",
      npm_config_fund: "false",
    },
    timeout: 120_000,
  });
  if (result.status !== 0) {
    throw new Error(
      `npm ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout;
}

try {
  const packOutput = npm(
    ["pack", "--ignore-scripts", "--json", "--pack-destination", temporary],
    root,
  );
  const packResult = JSON.parse(packOutput)[0];
  const files = packResult.files.map((entry) => entry.path);
  for (const required of [
    "dist/cli.js",
    "dist/index.js",
    "README.md",
    "LICENSE",
  ]) {
    if (!files.includes(required)) {
      throw new Error(`packed artifact is missing ${required}`);
    }
  }
  if (
    files.some((file) => file.startsWith("src/") || file.startsWith("test/"))
  ) {
    throw new Error("packed artifact contains source or test files");
  }

  const tarball = path.join(temporary, packResult.filename);
  const consumer = path.join(temporary, "consumer");
  await writeFile(
    path.join(temporary, "package.json"),
    `${JSON.stringify({ private: true, type: "module" }, undefined, 2)}\n`,
  );
  npm(["install", "--ignore-scripts", tarball], temporary);
  const bin = path.join(temporary, "node_modules", ".bin", "millctl");
  const version = spawnSync(bin, ["--version"], {
    cwd: temporary,
    encoding: "utf8",
    timeout: 10_000,
  });
  if (version.status !== 0 || version.stdout.trim() !== "0.0.0-development") {
    throw new Error(
      `packed millctl version smoke failed: ${version.stdout}${version.stderr}`,
    );
  }

  const packageJson = JSON.parse(
    await readFile(
      path.join(
        temporary,
        "node_modules",
        "@davidahmann",
        "mill",
        "package.json",
      ),
      "utf8",
    ),
  );
  if (packageJson.scripts?.postinstall !== undefined) {
    throw new Error("packed package must not define postinstall");
  }
  const schemaImport = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      'await import("@davidahmann/mill/schemas/mill-lock.schema.json", { with: { type: "json" } })',
    ],
    {
      cwd: temporary,
      encoding: "utf8",
      timeout: 10_000,
    },
  );
  if (schemaImport.status !== 0) {
    throw new Error(
      `packed schema import failed: ${schemaImport.stdout}${schemaImport.stderr}`,
    );
  }
  void consumer;
  process.stdout.write(`package smoke passed: ${packResult.filename}\n`);
} finally {
  await rm(temporary, { force: true, recursive: true });
}
