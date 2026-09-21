import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = path.resolve("scripts/maintainer-review.mjs");
const directories: string[] = [];
const gitBinary = process.env.MILL_GIT_PATH ?? "git";
function fixture(priority = "P2", malformed = false) {
  const directory = mkdtempSync(path.join(tmpdir(), "maintainer-review-test-"));
  directories.push(directory);
  const root = path.join(directory, "repo");
  const bin = path.join(directory, "bin");
  mkdirSync(root);
  mkdirSync(bin);
  const git = (...args: string[]) => {
    const result = spawnSync(gitBinary, args, { cwd: root, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  git("init", "-q");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.test");
  writeFileSync(path.join(root, "file.txt"), "before\n");
  git("add", ".");
  git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD");
  writeFileSync(path.join(root, "file.txt"), "after\n");
  git("commit", "-qam", "candidate");
  const head = git("rev-parse", "HEAD");
  const receipt = path.join(directory, "receipt.json");
  writeFileSync(
    path.join(bin, "codex"),
    `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[args.indexOf('--sandbox') + 1] !== 'read-only' || !args.includes('--ignore-user-config') || process.env.GH_TOKEN || process.env.MILL_GITHUB_TOKEN) process.exit(9);
fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], ${JSON.stringify(malformed ? "{}" : JSON.stringify({ base, head, findings: [{ id: "R1", priority, subsystem: "fixture", description: "file.txt:1 concrete fixture finding" }] }))});
`,
    { mode: 0o700 },
  );
  const invoke = (mode: string, extra: string[] = []) =>
    spawnSync(
      process.execPath,
      [
        script,
        mode,
        "--base",
        base,
        "--head",
        head,
        "--receipt",
        receipt,
        ...(mode === "run"
          ? [
              "--validation",
              JSON.stringify([
                process.execPath,
                "-e",
                "console.log('validated')",
              ]),
            ]
          : []),
        ...extra,
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${bin}${path.delimiter}${process.env.PATH}`,
          GH_TOKEN: "test-not-a-secret",
          MILL_GITHUB_TOKEN: "test-not-a-secret",
        },
      },
    );
  return { root, git, invoke, receipt, base, head };
}
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("standalone maintainer review evidence", () => {
  it("runs validation and a separate read-only review, retaining advisory findings", () => {
    const test = fixture();
    expect(test.invoke("run").status).toBe(0);
    expect(test.invoke("check").status).toBe(0);
    const evidence = JSON.parse(readFileSync(test.receipt, "utf8")) as {
      review: { findings: { priority: string }[] };
      ledger: { disposition: string }[];
      validation: { argv: string[] };
      [key: string]: unknown;
    };
    expect(evidence.review.findings[0]?.priority).toBe("P2");
    expect(evidence.ledger[0]?.disposition).toBe("advisory");
    expect(evidence.validation.argv).toContain("console.log('validated')");
    expect(test.invoke("run").status).not.toBe(0); // immutable path
  });
  it.each(["P0", "P1"])("records but blocks %s findings", (priority) => {
    const test = fixture(priority);
    expect(test.invoke("run").status).toBe(1);
    expect(test.invoke("check").status).toBe(1);
    expect(
      (
        JSON.parse(readFileSync(test.receipt, "utf8")) as {
          ledger: { disposition: string }[];
        }
      ).ledger[0]?.disposition,
    ).toBe("blocking");
  });
  it("rejects malformed model output", () => {
    const test = fixture("P2", true);
    const result = test.invoke("run");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Malformed");
  });
  it("rejects missing evidence, dirty worktrees and moved candidate", () => {
    const test = fixture();
    expect(test.invoke("check").status).toBe(1);
    expect(test.invoke("run").status).toBe(0);
    writeFileSync(path.join(test.root, "file.txt"), "drift\n");
    expect(test.invoke("check").stderr).toContain("clean");
    test.git("commit", "-qam", "drift");
    expect(test.invoke("check").stderr).toContain("HEAD changed");
  });
  it.each(["review", "validation", "identity", "ledger"])(
    "rejects malformed %s evidence",
    (field) => {
      const test = fixture();
      expect(test.invoke("run").status).toBe(0);
      const evidence = JSON.parse(readFileSync(test.receipt, "utf8")) as {
        review: { findings: { priority: string }[] };
        ledger: { disposition: string }[];
        validation: { argv: string[] };
        [key: string]: unknown;
      };
      evidence[field] = {};
      writeFileSync(test.receipt, JSON.stringify(evidence));
      expect(test.invoke("check").status).toBe(1);
    },
  );
  it("rejects validation that changes tracked files", () => {
    const test = fixture();
    const result = spawnSync(
      process.execPath,
      [
        script,
        "run",
        "--base",
        test.base,
        "--head",
        test.head,
        "--receipt",
        test.receipt,
        "--validation",
        JSON.stringify([
          process.execPath,
          "-e",
          "require('node:fs').writeFileSync('file.txt', 'changed')",
        ]),
      ],
      { cwd: test.root, encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("clean");
  });
  it("rejects an unknown severity instead of treating it as advisory", () => {
    const test = fixture("P9");
    expect(test.invoke("run").stderr).toContain("Malformed finding");
  });
  it("rejects a changed supplied base and untracked source", () => {
    const test = fixture();
    expect(test.invoke("run").status).toBe(0);
    const changedBase = spawnSync(
      process.execPath,
      [
        script,
        "check",
        "--base",
        test.head,
        "--head",
        test.head,
        "--receipt",
        test.receipt,
      ],
      { cwd: test.root, encoding: "utf8" },
    );
    expect(changedBase.status).toBe(1);
    expect(changedBase.stderr).toContain("Receipt identity");
    writeFileSync(path.join(test.root, "extra.txt"), "untracked");
    expect(test.invoke("check").stderr).toContain("clean");
  });
  it("does not produce evidence from a failed validation command", () => {
    const test = fixture();
    const result = spawnSync(
      process.execPath,
      [
        script,
        "run",
        "--base",
        test.base,
        "--head",
        test.head,
        "--receipt",
        test.receipt,
        "--validation",
        JSON.stringify([process.execPath, "-e", "process.exit(1)"]),
      ],
      { cwd: test.root, encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(test.invoke("check").status).toBe(1);
  });
});
