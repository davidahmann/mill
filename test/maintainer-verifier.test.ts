import { spawnSync } from "node:child_process";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { temporaryDirectory } from "./helpers.js";

async function cleanupFixture(): Promise<
  Awaited<ReturnType<typeof temporaryDirectory>>
> {
  const temporary = await temporaryDirectory("mill-maintainer-clean-");
  await mkdir(path.join(temporary.path, "scripts"));
  await copyFile(
    "scripts/clean.mjs",
    path.join(temporary.path, "scripts/clean.mjs"),
  );
  return temporary;
}

function clean(root: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [path.join(root, "scripts/clean.mjs")], {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
  });
}

describe("maintainer output cleanup", () => {
  it("clears generated contents without deleting mount roots or source", async () => {
    const temporary = await cleanupFixture();
    try {
      for (const output of ["dist", "coverage"]) {
        await mkdir(path.join(temporary.path, output, "nested"), {
          recursive: true,
        });
        await writeFile(
          path.join(temporary.path, output, "nested/stale.js"),
          "stale",
        );
      }
      await writeFile(path.join(temporary.path, "source.ts"), "preserved");
      const result = clean(temporary.path);
      expect(result.status, String(result.stderr)).toBe(0);
      for (const output of ["dist", "coverage"]) {
        expect(
          (await lstat(path.join(temporary.path, output))).isDirectory(),
        ).toBe(true);
        expect(await readdir(path.join(temporary.path, output))).toEqual([]);
      }
      expect(
        await readFile(path.join(temporary.path, "source.ts"), "utf8"),
      ).toBe("preserved");
      expect(clean(temporary.path).status).toBe(0);
    } finally {
      await temporary.cleanup();
    }
  });

  it("rejects an output-root symlink without modifying its target", async () => {
    const temporary = await cleanupFixture();
    try {
      await mkdir(path.join(temporary.path, "outside"));
      await writeFile(path.join(temporary.path, "outside/keep.txt"), "keep");
      await symlink("outside", path.join(temporary.path, "dist"));
      const result = clean(temporary.path);
      expect(result.status).not.toBe(0);
      expect(
        (await lstat(path.join(temporary.path, "dist"))).isSymbolicLink(),
      ).toBe(true);
      expect(
        await readFile(path.join(temporary.path, "outside/keep.txt"), "utf8"),
      ).toBe("keep");
    } finally {
      await temporary.cleanup();
    }
  });

  it("accepts absent outputs and never follows a nested generated symlink", async () => {
    const temporary = await cleanupFixture();
    try {
      expect(clean(temporary.path).status).toBe(0);
      await mkdir(path.join(temporary.path, "dist"));
      await mkdir(path.join(temporary.path, "outside"));
      await writeFile(path.join(temporary.path, "outside/keep.txt"), "keep");
      await symlink("../outside", path.join(temporary.path, "dist/link"));
      expect(clean(temporary.path).status).toBe(0);
      expect(await readdir(path.join(temporary.path, "dist"))).toEqual([]);
      expect(
        await readFile(path.join(temporary.path, "outside/keep.txt"), "utf8"),
      ).toBe("keep");
    } finally {
      await temporary.cleanup();
    }
  });
});

describe("maintainer native environment", () => {
  it("rejects arbitrary commands and execution outside the OCI workspace", async () => {
    const temporary = await temporaryDirectory("mill-maintainer-runner-");
    try {
      const script = path.resolve("scripts/maintainer-verifier/run-native.mjs");
      for (const args of [["format"], ["check", "extra"], ["check"]]) {
        const result = spawnSync(process.execPath, [script, ...args], {
          cwd: temporary.path,
          encoding: "utf8",
          timeout: 10_000,
        });
        expect(result.status).not.toBe(0);
        expect(await readdir(temporary.path)).toEqual([]);
      }
    } finally {
      await temporary.cleanup();
    }
  });
});
