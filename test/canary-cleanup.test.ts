import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { temporaryDirectory } from "./helpers.js";

const execute = promisify(execFile);
it.each(["qualify-pnpm-oci.mjs", "qualify-release-artifact.mjs"])(
  "failed %s retains its actual fixture directories",
  async (script) => {
    const temporary = await temporaryDirectory("mill-canary-caller-");
    try {
      const binaries = path.join(temporary.path, "bin");
      const fixtures = path.join(temporary.path, "fixtures");
      await mkdir(binaries);
      await mkdir(fixtures);
      for (const binary of ["docker", "npm"]) {
        const executable = path.join(binaries, binary);
        await writeFile(executable, "#!/bin/sh\nexit 71\n");
        await chmod(executable, 0o755);
      }
      const environment = { ...process.env };
      delete environment.npm_execpath;
      await expect(
        execute(
          process.execPath,
          [
            path.resolve("scripts", script),
            ...(script === "qualify-release-artifact.mjs"
              ? [path.join(temporary.path, "unused.tgz")]
              : []),
          ],
          {
            env: {
              ...environment,
              TMPDIR: fixtures,
              TMP: fixtures,
              TEMP: fixtures,
              PATH: `${binaries}${path.delimiter}${process.env.PATH ?? ""}`,
            },
          },
        ),
      ).rejects.toThrow("preserve these private fixtures for recovery:");
      const retained = await readdir(fixtures);
      expect(retained).toHaveLength(script === "qualify-pnpm-oci.mjs" ? 2 : 1);
      for (const directory of retained)
        expect((await stat(path.join(fixtures, directory))).isDirectory()).toBe(
          true,
        );
    } finally {
      await temporary.cleanup();
    }
  },
);

it.each([false, true])(
  "canary cleanup preserves failed fixtures and removes completed fixtures (%s)",
  async (completed) => {
    const temporary = await temporaryDirectory("mill-canary-cleanup-");
    try {
      const workspace = path.join(temporary.path, "workspace");
      const state = path.join(temporary.path, "state");
      for (const directory of [workspace, state]) {
        await mkdir(directory);
        await writeFile(
          path.join(directory, "ownership.json"),
          "retained evidence\n",
        );
      }
      await execute(process.execPath, [
        "--input-type=module",
        "-e",
        `import {cleanupCanaryDirectories} from ${JSON.stringify(pathToFileURL(path.resolve("scripts/canary-cleanup.mjs")).href)};
       try { if (!${completed}) throw new Error("OCI_RECONCILIATION_REQUIRED"); }
       catch { /* Qualification failure remains a failure; this probes its finally block. */ }
       finally { await cleanupCanaryDirectories(${JSON.stringify([workspace, state])}, ${completed}); }`,
      ]);
      for (const directory of [workspace, state]) {
        if (completed)
          await expect(stat(directory)).rejects.toMatchObject({
            code: "ENOENT",
          });
        else
          expect(
            await readFile(path.join(directory, "ownership.json"), "utf8"),
          ).toBe("retained evidence\n");
      }
    } finally {
      await temporary.cleanup();
    }
  },
);
