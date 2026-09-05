import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
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
  overrides: { execution?: string; script?: string; type?: string } = {},
) {
  const directory = await temporaryDirectory("mill-native-adoption-");
  const state = await temporaryDirectory("mill-native-state-");
  process.env.MILL_STATE_HOME = state.path;
  const config = {
    schemaVersion: "1",
    repositoryId: randomUUID(),
    trustCeiling: "build",
    sensitivePaths: [".env", ".npmrc"],
    verifier: {
      image: `node@sha256:${"a".repeat(64)}`,
      network: "none",
      dependencies: {
        manager: "npm",
        registry: "https://registry.npmjs.org",
        targetPath: "node_modules",
        lockPaths: ["package.json", "package-lock.json"],
      },
    },
    commands: {
      test: {
        argv: ["/usr/local/bin/npm", "run", overrides.script ?? "test"],
        cwd: ".",
        controlPaths: ["package.json", "package-lock.json", "test/**"],
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
    }),
  );
  await writeFile(
    path.join(directory.path, "package-lock.json"),
    JSON.stringify({
      name: "native-example",
      version: "1.0.0",
      lockfileVersion: 3,
      packages: {},
    }),
  );
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
});
