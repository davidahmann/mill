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

import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { canonicalDigest, type JsonValue } from "../src/contracts/canonical.js";
import { millConfigSchema } from "../src/contracts/schemas.js";
import { loadRuntimeInputs } from "../src/runtime/inputs.js";
import { verifyDeclaredCommands } from "../src/runtime/verifier.js";

import { temporaryDirectory } from "./helpers.js";
import { runtimeFixture } from "./runtime-fixture.js";

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

  it("binds executable fixture scratch to an explicit OCI test/package grant", async () => {
    const fixture = await runtimeFixture();
    try {
      const { config } = await loadRuntimeInputs(
        fixture.root,
        fixture.taskPath,
      );
      const command = config.commands.test;
      const schema: unknown = JSON.parse(
        await readFile("schemas/mill-config.schema.json", "utf8"),
      );
      const ajv = new Ajv2020({ strict: true });
      ajv.addFormat("uuid", /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu);
      const validate = ajv.compile(schema as object);
      const configured = (changes: Record<string, unknown>) => ({
        ...config,
        commands: { test: { ...command, ...changes } },
      });
      for (const capability of ["test", "package"]) {
        const approved = millConfigSchema.parse(
          configured({ capability, executableFixtureScratch: true }),
        );
        expect(canonicalDigest(approved as JsonValue)).not.toBe(
          canonicalDigest(config as JsonValue),
        );
        expect(validate(approved), JSON.stringify(validate.errors)).toBe(true);
      }
      for (const changes of [
        { executableFixtureScratch: false },
        { executableFixtureScratch: "/workspace" },
        { executableFixtureScratch: true, capability: "read" },
        { executableFixtureScratch: true, capability: "build" },
        { executableFixtureScratch: true, execution: "host" },
      ]) {
        expect(millConfigSchema.safeParse(configured(changes)).success).toBe(
          false,
        );
        expect(validate(configured(changes))).toBe(false);
      }
      expect(millConfigSchema.parse(config).commands.test).not.toHaveProperty(
        "executableFixtureScratch",
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("adds only a fixed bounded executable tmpfs when granted and retains default denial", async () => {
    const fixture = await runtimeFixture();
    const tools = await temporaryDirectory("mill-fixture-mount-tools-");
    const previous = process.env.MILL_DOCKER_PATH;
    try {
      const executable = path.join(tools.path, "docker.cjs");
      const log = path.join(tools.path, "calls.jsonl");
      await writeFile(
        executable,
        `#!${process.execPath}\nrequire("node:fs").appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2))+"\\n");\n`,
        { mode: 0o755 },
      );
      process.env.MILL_DOCKER_PATH = executable;
      const { config, task } = await loadRuntimeInputs(
        fixture.root,
        fixture.taskPath,
      );
      const testCommand = config.commands.test;
      if (testCommand === undefined)
        throw new Error("Fixture test command missing");
      for (const enabled of [false, true]) {
        const configured = millConfigSchema.parse({
          ...config,
          commands: {
            test: {
              ...config.commands.test,
              ...(enabled ? { executableFixtureScratch: true } : {}),
            },
          },
        });
        const evidence = await verifyDeclaredCommands({
          root: fixture.root,
          config: configured,
          task,
          candidateCommit: "a".repeat(40),
          deadlineMs: Date.now() + 30_000,
          maxOutputBytes: 1024 * 1024,
        });
        expect(evidence.passed).toBe(true);
      }
      const calls = (await readFile(log, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as string[]);
      const runs = calls.filter((args) => args[0] === "run");
      expect(runs).toHaveLength(2);
      expect(runs[0]).not.toContain("--init");
      expect(runs[1]).toContain("--init");
      expect(runs[0]).not.toContain(
        "/mill-fixtures:rw,exec,nosuid,nodev,size=256m",
      );
      expect(runs[1]).toContain(
        "/mill-fixtures:rw,exec,nosuid,nodev,size=256m",
      );
      for (const args of runs) {
        expect(args).toContain("/tmp:rw,noexec,nosuid,nodev,size=256m");
        expect(args).toContain("--read-only");
        expect(args[args.indexOf("--network") + 1]).toBe("none");
        expect(args).toContain("no-new-privileges");
        expect(args).not.toContain("--privileged");
      }
      expect(calls.filter((args) => args[0] === "rm")).toHaveLength(2);
      await expect(
        verifyDeclaredCommands({
          root: fixture.root,
          config: {
            ...config,
            commands: {
              test: {
                ...testCommand,
                capability: "read",
                executableFixtureScratch: true,
              },
            },
          },
          task,
          candidateCommit: "a".repeat(40),
          deadlineMs: Date.now() + 30_000,
          maxOutputBytes: 1024 * 1024,
        }),
      ).rejects.toMatchObject({ code: "VERIFIER_FIXTURE_SCRATCH_FORBIDDEN" });
    } finally {
      if (previous === undefined) delete process.env.MILL_DOCKER_PATH;
      else process.env.MILL_DOCKER_PATH = previous;
      await tools.cleanup();
      await fixture.cleanup();
    }
  });
});
