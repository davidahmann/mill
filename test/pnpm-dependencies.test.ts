import {
  chmod,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { stringify as yaml } from "yaml";

import { millConfigSchema } from "../src/contracts/schemas.js";
import type { TaskPacket } from "../src/runtime/inputs.js";
import {
  dependencySnapshotDirectory,
  prepareDependencySnapshot,
} from "../src/runtime/dependencies.js";
import { verifyDeclaredCommands } from "../src/runtime/verifier.js";
import { temporaryDirectory } from "./helpers.js";

const originalDocker = process.env.MILL_DOCKER_PATH;

afterEach(() => {
  if (originalDocker === undefined) delete process.env.MILL_DOCKER_PATH;
  else process.env.MILL_DOCKER_PATH = originalDocker;
});

async function pnpmFixture() {
  const repository = await temporaryDirectory("mill-pnpm-repository-");
  const state = await temporaryDirectory("mill-pnpm-state-");
  const tools = await temporaryDirectory("mill-pnpm-tools-");
  await mkdir(path.join(repository.path, "packages", "example"), {
    recursive: true,
  });
  await Promise.all([
    writeFile(
      path.join(repository.path, "package.json"),
      `${JSON.stringify({
        name: "pnpm-fixture",
        private: true,
        type: "module",
        packageManager: "pnpm@10.23.0",
        scripts: { test: "node --test" },
      })}\n`,
    ),
    writeFile(
      path.join(repository.path, "packages", "example", "package.json"),
      `${JSON.stringify({
        name: "@fixture/example",
        version: "1.0.0",
        type: "module",
      })}\n`,
    ),
    writeFile(
      path.join(repository.path, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n",
    ),
    writeFile(
      path.join(repository.path, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\nimporters:\n  .: {}\n  packages/example: {}\npackages: {}\n",
    ),
  ]);
  const config = millConfigSchema.parse({
    schemaVersion: "1",
    repositoryId: "123e4567-e89b-42d3-a456-426614174099",
    trustCeiling: "build",
    sensitivePaths: [],
    verifier: {
      image: `node@sha256:${"a".repeat(64)}`,
      network: "none",
      dependencies: {
        manager: "pnpm",
        version: "10.23.0",
        registry: "https://registry.npmjs.org",
        targetPath: "node_modules",
        lockPaths: ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"],
        workspacePaths: ["packages/*"],
      },
    },
    commands: {
      test: {
        argv: ["/usr/local/bin/pnpm", "run", "test"],
        cwd: ".",
        controlPaths: [
          "package.json",
          "pnpm-lock.yaml",
          "pnpm-workspace.yaml",
          "packages/**",
          "test/**",
        ],
        capability: "test",
        required: true,
        timeoutSeconds: 30,
        execution: "oci",
      },
    },
  });
  const executable = path.join(tools.path, "docker");
  const log = path.join(tools.path, "docker.log");
  await writeFile(
    executable,
    `#!${process.execPath}
const {appendFileSync,mkdirSync}=require("node:fs");
const path=require("node:path");
const args=process.argv.slice(2);
appendFileSync(${JSON.stringify(log)},JSON.stringify(args)+"\\n");
if(args[0]==="image"||args[0]==="rm")process.exit(0);
if(args[0]!=="run")process.exit(2);
const mount=args.find((value)=>value.startsWith("type=bind,")&&value.includes("target=/workspace"));
if(mount===undefined)process.exit(3);
const prefix="type=bind,source=";
const source=mount.slice(prefix.length,mount.indexOf(",target=/workspace"));
mkdirSync(path.join(source,"node_modules"),{recursive:true});
process.exit(0);
`,
    { mode: 0o755 },
  );
  await chmod(executable, 0o755);
  process.env.MILL_DOCKER_PATH = executable;
  return { repository, state, tools, config, log };
}

describe("generic pnpm dependency preparation", () => {
  it("mounts each prepared shallow-workspace dependency directory into the read-only candidate", async () => {
    const value = await pnpmFixture();
    try {
      const prepared = await prepareDependencySnapshot({
        root: value.repository.path,
        stateDirectory: value.state.path,
        config: value.config,
        attended: true,
      });
      await mkdir(
        path.join(prepared.directory, "packages", "example", "node_modules"),
        { recursive: true },
      );
      const evidence = await verifyDeclaredCommands({
        root: value.repository.path,
        dependencyRoot: prepared.directory,
        candidateCommit: "a".repeat(40),
        config: value.config,
        task: { commandIds: ["test"] } as TaskPacket,
        deadlineMs: Date.now() + 30_000,
        maxOutputBytes: 1024,
      });
      expect(evidence).toMatchObject({
        passed: true,
        commands: [{ commandId: "test", status: "passed" }],
      });
      const calls = (await readFile(value.log, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as string[]);
      const verify = calls.find(
        (call) =>
          call.includes("--network") &&
          call.includes("none") &&
          call.includes("/usr/local/bin/pnpm"),
      );
      expect(verify?.join(" ")).toContain(
        "target=/workspace/packages/example/node_modules,readonly",
      );
    } finally {
      await Promise.all([
        value.repository.cleanup(),
        value.state.cleanup(),
        value.tools.cleanup(),
      ]);
    }
  });

  it("binds the root, workspace manifests, lockfile, pnpm version, and disabled lifecycle scripts", async () => {
    const value = await pnpmFixture();
    try {
      const prepared = await prepareDependencySnapshot({
        root: value.repository.path,
        stateDirectory: value.state.path,
        config: value.config,
        attended: true,
      });
      expect(prepared.reused).toBe(false);
      expect(prepared.network).toContain("pnpm lifecycle scripts disabled");
      await expect(
        dependencySnapshotDirectory({
          root: value.repository.path,
          stateDirectory: value.state.path,
          config: value.config,
        }),
      ).resolves.toBe(prepared.directory);
      const calls = (await readFile(value.log, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as string[]);
      const install = calls.find(
        (call) =>
          call.includes("dev.mill.owner=dependency-preparation") &&
          call.includes("/bin/sh"),
      );
      expect(install).toContain("MILL_PNPM_VERSION=10.23.0");
      expect(install?.join(" ")).toContain("pnpm --version");
      expect(install?.join(" ")).toContain("--ignore-scripts");
    } finally {
      await Promise.all([
        value.repository.cleanup(),
        value.state.cleanup(),
        value.tools.cleanup(),
      ]);
    }
  });

  it("rejects pnpm native-build exceptions before registry access", async () => {
    const value = await pnpmFixture();
    try {
      await writeFile(
        path.join(value.repository.path, "pnpm-workspace.yaml"),
        `${yaml({ packages: ["packages/*"], onlyBuiltDependencies: ["esbuild"] })}\n`,
      );
      await expect(
        prepareDependencySnapshot({
          root: value.repository.path,
          stateDirectory: value.state.path,
          config: value.config,
          attended: true,
        }),
      ).rejects.toMatchObject({ code: "PNPM_LIFECYCLE_SCRIPT_UNSUPPORTED" });
      await expect(readFile(value.log, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await Promise.all([
        value.repository.cleanup(),
        value.state.cleanup(),
        value.tools.cleanup(),
      ]);
    }
  });

  it("rejects an invalid external package source with a stable error", async () => {
    const value = await pnpmFixture();
    try {
      await writeFile(
        path.join(value.repository.path, "pnpm-lock.yaml"),
        "lockfileVersion: '9.0'\nimporters:\n  .: {}\n  packages/example: {}\npackages:\n  example@1.0.0:\n    resolution:\n      integrity: sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==\n      tarball: not-a-url\n",
      );
      await expect(
        prepareDependencySnapshot({
          root: value.repository.path,
          stateDirectory: value.state.path,
          config: value.config,
          attended: true,
        }),
      ).rejects.toMatchObject({ code: "PNPM_LOCK_SOURCE_UNTRUSTED" });
      await expect(readFile(value.log, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await Promise.all([
        value.repository.cleanup(),
        value.state.cleanup(),
        value.tools.cleanup(),
      ]);
    }
  });

  it("rejects a workspace directory symlink before reading package manifests", async () => {
    const value = await pnpmFixture();
    try {
      const outside = path.join(value.tools.path, "outside");
      await mkdir(outside);
      await rm(path.join(value.repository.path, "packages"), {
        recursive: true,
      });
      await symlink(outside, path.join(value.repository.path, "packages"));
      await expect(
        prepareDependencySnapshot({
          root: value.repository.path,
          stateDirectory: value.state.path,
          config: value.config,
          attended: true,
        }),
      ).rejects.toMatchObject({ code: "PNPM_WORKSPACE_INVALID" });
      await expect(readFile(value.log, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await Promise.all([
        value.repository.cleanup(),
        value.state.cleanup(),
        value.tools.cleanup(),
      ]);
    }
  });
});
