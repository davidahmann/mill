import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { stringify as yaml } from "yaml";
import {
  planNativeAdoption,
  applyNativeAdoption,
} from "../src/repository/native-adoption.js";
import { temporaryDirectory } from "./helpers.js";

const execute = promisify(execFile);
const original = process.env.MILL_STATE_HOME;
afterEach(() => {
  if (original === undefined) delete process.env.MILL_STATE_HOME;
  else process.env.MILL_STATE_HOME = original;
});
const git = (root: string, args: string[]) =>
  execute(
    "/usr/bin/git",
    [
      "-c",
      "user.name=Native Test",
      "-c",
      "user.email=test@example.invalid",
      ...args,
    ],
    { cwd: root },
  );

async function fixture(
  overrides: {
    execution?: string;
    script?: string;
    type?: string;
    manager?: "npm" | "pnpm";
    workspacePackages?: readonly string[];
  } = {},
) {
  const directory = await temporaryDirectory("mill-native-adoption-");
  const state = await temporaryDirectory("mill-native-state-");
  process.env.MILL_STATE_HOME = state.path;
  const pnpm = overrides.manager === "pnpm";
  const workspacePackages = overrides.workspacePackages ?? ["packages/*"];
  const lockPaths = pnpm
    ? ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"]
    : ["package.json", "package-lock.json"];
  const workspaceControls = pnpm
    ? workspacePackages.map((workspacePath) =>
        workspacePath.replace(/\*$/u, "**"),
      )
    : [];
  const config = {
    schemaVersion: "1",
    repositoryId: randomUUID(),
    trustCeiling: "build",
    sensitivePaths: [".env", ".npmrc"],
    verifier: {
      image: `node@sha256:${"a".repeat(64)}`,
      network: "none",
      dependencies: {
        manager: pnpm ? "pnpm" : "npm",
        ...(pnpm
          ? { version: "10.0.0", workspacePaths: workspacePackages }
          : {}),
        registry: "https://registry.npmjs.org",
        targetPath: "node_modules",
        lockPaths,
      },
    },
    commands: {
      test: {
        argv: [
          pnpm ? "/usr/local/bin/pnpm" : "/usr/local/bin/npm",
          "run",
          overrides.script ?? "test",
        ],
        cwd: ".",
        controlPaths: [...lockPaths, ...workspaceControls, "test/**"],
        capability: "test",
        execution: overrides.execution ?? "oci",
        required: true,
        timeoutSeconds: 60,
      },
    },
  };
  await writeFile(
    path.join(directory.path, "package.json"),
    JSON.stringify({
      name: "native-example",
      version: "1.0.0",
      type: overrides.type ?? "module",
      scripts: { test: "node --test" },
      ...(pnpm ? { packageManager: "pnpm@10.0.0" } : {}),
    }),
  );
  if (pnpm) {
    await mkdir(path.join(directory.path, "packages", "example"), {
      recursive: true,
    });
    await Promise.all([
      writeFile(
        path.join(directory.path, "pnpm-lock.yaml"),
        "lockfileVersion: '9.0'\nimporters:\n  .: {}\n  packages/example: {}\n",
      ),
      writeFile(
        path.join(directory.path, "pnpm-workspace.yaml"),
        `${yaml({ packages: workspacePackages })}\n`,
      ),
      writeFile(
        path.join(directory.path, "packages", "example", "package.json"),
        JSON.stringify({
          name: "@example/package",
          version: "1.0.0",
          type: "module",
        }),
      ),
    ]);
  } else {
    await writeFile(
      path.join(directory.path, "package-lock.json"),
      JSON.stringify({
        name: "native-example",
        version: "1.0.0",
        lockfileVersion: 3,
        packages: {},
      }),
    );
  }
  await writeFile(path.join(directory.path, "adoption.yaml"), yaml(config));
  await git(directory.path, ["init", "-b", "main"]);
  await git(directory.path, ["config", "user.name", "Native Test"]);
  await git(directory.path, [
    "config",
    "user.email",
    "123+native@users.noreply.github.com",
  ]);
  await git(directory.path, ["add", "."]);
  await git(directory.path, ["commit", "-m", "test: native adoption input"]);
  return {
    input: { root: directory.path, configPath: "adoption.yaml" },
    cleanup: async () => {
      await directory.cleanup();
      await state.cleanup();
    },
  };
}

describe("experimental native adoption", () => {
  it("preserves the native package and installs only new controls in a disposable worktree", async () => {
    const value = await fixture();
    try {
      const planned = await planNativeAdoption(value.input);
      expect(planned.status).toBe("experimental");
      expect(planned.qualification).toBe("not_executed");
      expect(await planNativeAdoption(value.input)).toEqual(planned);
      await expect(
        applyNativeAdoption({
          ...value.input,
          approvalDigest: planned.approvalDigest,
          attended: false,
        }),
      ).rejects.toMatchObject({ code: "ATTENDANCE_REQUIRED" });
      await expect(
        applyNativeAdoption({
          ...value.input,
          approvalDigest: "wrong",
          attended: true,
        }),
      ).rejects.toMatchObject({ code: "NATIVE_ADOPTION_APPROVAL_MISMATCH" });
      const applied = await applyNativeAdoption({
        ...value.input,
        approvalDigest: planned.approvalDigest,
        attended: true,
      });
      expect(
        await readFile(path.join(applied.worktree, "package.json"), "utf8"),
      ).toBe(
        await readFile(path.join(value.input.root, "package.json"), "utf8"),
      );
      await expect(
        readFile(path.join(value.input.root, "mill.yaml")),
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        applyNativeAdoption({
          ...value.input,
          approvalDigest: planned.approvalDigest,
          attended: true,
        }),
      ).rejects.toMatchObject({
        code: "NATIVE_ADOPTION_RECONCILIATION_REQUIRED",
      });
    } finally {
      await value.cleanup();
    }
  });
  it.each([{ execution: "host" }, { script: "missing" }, { type: "commonjs" }])(
    "refuses an unqualified native command or stack %j",
    async (overrides) => {
      const value = await fixture(overrides);
      try {
        await expect(planNativeAdoption(value.input)).rejects.toThrow();
      } finally {
        await value.cleanup();
      }
    },
  );

  it("plans one declared shallow pnpm workspace shape", async () => {
    const value = await fixture({ manager: "pnpm" });
    try {
      const planned = await planNativeAdoption(value.input);
      expect(planned.status).toBe("experimental");
      expect(planned.nativeWorkspaceDigest).toMatch(/^sha256:/u);
    } finally {
      await value.cleanup();
    }
  });

  it("rejects pnpm workspace declarations that do not match the configuration", async () => {
    const value = await fixture({ manager: "pnpm" });
    try {
      await writeFile(
        path.join(value.input.root, "pnpm-workspace.yaml"),
        `${yaml({ packages: ["apps/*"] })}\n`,
      );
      await git(value.input.root, ["add", "pnpm-workspace.yaml"]);
      await git(value.input.root, ["commit", "-m", "test: change workspace"]);
      await expect(planNativeAdoption(value.input)).rejects.toMatchObject({
        code: "NATIVE_ADOPTION_WORKSPACE_UNSUPPORTED",
      });
    } finally {
      await value.cleanup();
    }
  });

  it("rejects a pnpm lockfile outside the declared generic shape", async () => {
    const value = await fixture({ manager: "pnpm" });
    try {
      await writeFile(
        path.join(value.input.root, "pnpm-lock.yaml"),
        "lockfileVersion: '8.0'\nimporters: {}\npackages: {}\n",
      );
      await git(value.input.root, ["add", "pnpm-lock.yaml"]);
      await git(value.input.root, ["commit", "-m", "test: change lock"]);
      await expect(planNativeAdoption(value.input)).rejects.toMatchObject({
        code: "NATIVE_ADOPTION_STACK_UNSUPPORTED",
      });
    } finally {
      await value.cleanup();
    }
  });
});
