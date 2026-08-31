import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { temporaryDirectory } from "./helpers.js";

const dcoScript = path.resolve("scripts/check-dco.mjs");
const workflowScript = path.resolve("scripts/check-workflows.mjs");

function run(
  executable: string,
  arguments_: readonly string[],
  cwd: string,
): { status: number | null; stderr: string; stdout: string } {
  const result = spawnSync(executable, arguments_, {
    cwd,
    encoding: "utf8",
    timeout: 10_000,
  });
  return {
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

function git(arguments_: readonly string[], cwd: string): string {
  const result = run("/usr/bin/git", arguments_, cwd);
  if (result.status !== 0) {
    throw new Error(`git ${arguments_.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

describe("repository policy scripts", () => {
  it("accepts an author-matching DCO sign-off and rejects a foreign one", async () => {
    const temporary = await temporaryDirectory("mill-dco-");
    try {
      git(["init", "--quiet"], temporary.path);
      git(["config", "user.name", "Alice"], temporary.path);
      git(["config", "user.email", "alice@example.com"], temporary.path);
      await writeFile(path.join(temporary.path, "fixture.txt"), "base\n");
      git(["add", "fixture.txt"], temporary.path);
      git(
        [
          "commit",
          "--quiet",
          "-m",
          "base",
          "-m",
          "Signed-off-by: Alice <alice@example.com>",
        ],
        temporary.path,
      );
      const base = git(["rev-parse", "HEAD"], temporary.path);

      await writeFile(path.join(temporary.path, "fixture.txt"), "signed\n");
      git(["add", "fixture.txt"], temporary.path);
      git(
        [
          "commit",
          "--quiet",
          "-m",
          "signed",
          "-m",
          "Signed-off-by: Alice <alice@example.com>",
        ],
        temporary.path,
      );
      const signedHead = git(["rev-parse", "HEAD"], temporary.path);
      const signed = run(
        process.execPath,
        [dcoScript, base, signedHead],
        temporary.path,
      );
      expect(signed.status, signed.stderr).toBe(0);
      expect(signed.stdout).toContain("DCO check passed for 1 commit(s)");

      await writeFile(path.join(temporary.path, "fixture.txt"), "foreign\n");
      git(["add", "fixture.txt"], temporary.path);
      git(
        [
          "commit",
          "--quiet",
          "-m",
          "foreign",
          "-m",
          "Signed-off-by: Mallory <mallory@example.com>",
        ],
        temporary.path,
      );
      const foreignHead = git(["rev-parse", "HEAD"], temporary.path);
      const foreign = run(
        process.execPath,
        [dcoScript, signedHead, foreignHead],
        temporary.path,
      );
      expect(foreign.status).toBe(1);
      expect(foreign.stderr).toContain("DCO sign-off missing");
    } finally {
      await temporary.cleanup();
    }
  });

  it("requires a timeout on every workflow job", async () => {
    const temporary = await temporaryDirectory("mill-workflow-policy-");
    try {
      await mkdir(path.join(temporary.path, ".github", "workflows"), {
        recursive: true,
      });
      await writeFile(
        path.join(temporary.path, ".github", "workflows", "ci.yml"),
        [
          "name: CI",
          "on: [push]",
          "permissions:",
          "  contents: read",
          "concurrency:",
          "  group: ci",
          "jobs:",
          "  bounded:",
          "    runs-on: ubuntu-24.04",
          "    timeout-minutes: 5",
          "    steps:",
          "      - run: echo bounded",
          "  unbounded:",
          "    runs-on: ubuntu-24.04",
          "    steps:",
          "      - run: echo unbounded",
          "",
        ].join("\n"),
      );
      const result = run(process.execPath, [workflowScript], temporary.path);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        "ci.yml: job unbounded must declare timeout-minutes",
      );
    } finally {
      await temporary.cleanup();
    }
  });
});
