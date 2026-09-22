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
function fixture(
  priority = "P2",
  malformed = false,
  attributes?: string,
  deletedDirectory = false,
  checklist = false,
) {
  const directory = mkdtempSync(path.join(tmpdir(), "maintainer-review-test-"));
  directories.push(directory);
  const root = path.join(directory, "repo");
  const bin = path.join(directory, "bin");
  mkdirSync(root);
  mkdirSync(bin);
  const git = (...args: string[]) => {
    const env = { ...process.env };
    delete env.GIT_NO_REPLACE_OBJECTS;
    const result = spawnSync(gitBinary, args, {
      cwd: root,
      encoding: "utf8",
      env,
    });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  git("init", "-q");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.test");
  writeFileSync(path.join(root, "file.txt"), "before\n");
  if (checklist) {
    mkdirSync(path.join(root, "policy"));
    writeFileSync(
      path.join(root, "policy", "review.md"),
      "# Fixture review\n\n- Check the changed file.\n",
    );
    writeFileSync(
      path.join(root, "mill.yaml"),
      'review:\n  checklists:\n    - id: fixture\n      path: policy/review.md\n      pathPatterns: ["file.txt"]\n',
    );
  }
  if (deletedDirectory) {
    mkdirSync(path.join(root, "removed"));
    writeFileSync(
      path.join(root, "removed", "old.js"),
      "export const retained = true;\n",
    );
  }
  if (attributes !== undefined)
    writeFileSync(path.join(root, ".gitattributes"), attributes);
  git("add", ".");
  git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD");
  if (deletedDirectory) rmSync(path.join(root, "removed", "old.js"));
  writeFileSync(path.join(root, "file.txt"), "after\n");
  git("commit", "-qam", "candidate");
  const head = git("rev-parse", "HEAD");
  const receipt = path.join(directory, "receipt.json");
  writeFileSync(
    path.join(bin, "codex"),
    `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[args.indexOf('--sandbox') + 1] !== 'read-only' || !args.includes('--ignore-user-config') || process.env.GH_TOKEN || process.env.MILL_GITHUB_TOKEN || process.env.GIT_NO_REPLACE_OBJECTS !== "1" || process.env.GIT_GRAFT_FILE !== "/dev/null") process.exit(9);
fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], ${JSON.stringify(malformed ? "{}" : JSON.stringify({ base, head, findings: [{ id: "R1", priority, subsystem: "fixture", description: "file.txt:1 concrete fixture finding" }] }))});
console.log(JSON.stringify({type:"turn.completed",usage:{input_tokens:12,output_tokens:3,cached_input_tokens:4}}));
`,
    { mode: 0o700 },
  );
  const invoke = (
    mode: string,
    extra: string[] = [],
    environment: NodeJS.ProcessEnv = {},
    validation = "console.log('validated')",
  ) =>
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
              JSON.stringify([process.execPath, "-e", validation]),
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
          ...environment,
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
      usage: { source: string; inputTokens: number | null };
      reviewFocus: { digest: string; changedPaths: string[] };
      [key: string]: unknown;
    };
    expect(evidence.review.findings[0]?.priority).toBe("P2");
    expect(evidence.ledger[0]?.disposition).toBe("advisory");
    expect(evidence.validation.argv).toContain("console.log('validated')");
    expect(evidence.usage).toMatchObject({
      source: "measured",
      inputTokens: 12,
    });
    expect(evidence.reviewFocus.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(evidence.reviewFocus.changedPaths).toEqual(["file.txt"]);
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
  it("binds matching repository-owned review guidance from the base", () => {
    const test = fixture("P2", false, undefined, false, true);
    expect(test.invoke("run").status).toBe(0);
    const evidence = JSON.parse(readFileSync(test.receipt, "utf8")) as {
      reviewFocus: {
        checklists: { id: string; path: string; digest: string }[];
      };
    };
    expect(evidence.reviewFocus.checklists).toHaveLength(1);
    expect(evidence.reviewFocus.checklists[0]).toMatchObject({
      id: "fixture",
      path: "policy/review.md",
    });
    expect(evidence.reviewFocus.checklists[0]?.digest).toMatch(
      /^sha256:[a-f0-9]{64}$/u,
    );
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
  it("rejects a replaced base before review and receipt reuse", () => {
    const test = fixture();
    test.git("replace", test.base, test.head);
    expect(test.git("diff", test.base, test.head)).toBe("");
    expect(test.invoke("run").stderr).toContain("replacement refs");
    test.git("replace", "-d", test.base);
    expect(test.invoke("run").status).toBe(0);
    test.git("replace", test.base, test.head);
    expect(test.invoke("check").stderr).toContain("replacement refs");
    test.git("replace", "-d", test.base);
    expect(test.invoke("check").status).toBe(0);
  });
  it("rejects graft metadata even when object interpretation is disabled", () => {
    const test = fixture();
    expect(test.invoke("run").status).toBe(0);
    const common = path.resolve(
      test.root,
      test.git("rev-parse", "--git-common-dir"),
    );
    writeFileSync(path.join(common, "info", "grafts"), test.head + "\n");
    expect(test.invoke("check").stderr).toContain("graft metadata");
  });
  it.each(["--assume-unchanged", "--skip-worktree"])(
    "rejects %s hiding modified source",
    (flag) => {
      const test = fixture();
      expect(test.invoke("run").status).toBe(0);
      test.git("update-index", flag, "file.txt");
      writeFileSync(path.join(test.root, "file.txt"), "unreviewed\n");
      expect(test.git("status", "--porcelain")).toBe("");
      expect(test.invoke("check").stderr).toContain("Hidden Git index");
    },
  );
  it.each([
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_CONFIG_COUNT",
    "GIT_CONFIG_GLOBAL",
    "GIT_REPLACE_REF_BASE",
    "GIT_GRAFT_FILE",
  ])("rejects ambient %s before executing validation", (key) => {
    const test = fixture();
    const result = test.invoke("run", [], {
      [key]: key === "GIT_CONFIG_COUNT" ? "0" : "/unused-overlay",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unsupported Git environment controls");
  });

  it("forces original-object interpretation during validation", () => {
    const test = fixture();
    expect(
      test.invoke(
        "run",
        [],
        { GIT_NO_REPLACE_OBJECTS: "0" },
        "if(process.env.GIT_NO_REPLACE_OBJECTS !== '1' || process.env.GIT_GRAFT_FILE !== '/dev/null') process.exit(7); console.log('validated')",
      ).status,
    ).toBe(0);
  });
  it.each([
    "diff.external",
    "diff.hidden.textconv",
    "diff.hidden.command",
    "filter.hidden.clean",
    "include.path",
    "core.fsmonitor",
    "core.attributesFile",
  ])("rejects local %s controls before validation", (key) => {
    const test = fixture();
    test.git(
      "config",
      key,
      key === "include.path" ? "/missing-include-fixture" : "/usr/bin/true",
    );
    expect(test.invoke("run").stderr).toContain(
      "Unsupported Git configuration",
    );
  });
  it("rejects harmless configuration drift after review", () => {
    const test = fixture();
    expect(test.invoke("run").status).toBe(0);
    test.git("config", "user.name", "Changed identity");
    expect(test.invoke("check").stderr).toContain("Receipt identity");
  });
  it("rejects configuration mutation during validation", () => {
    const test = fixture();
    const validation =
      "require('node:child_process').execFileSync(" +
      JSON.stringify(gitBinary) +
      ", ['config','user.name','Changed validation identity']);";
    expect(test.invoke("run", [], {}, validation).stderr).toContain(
      "Validation changed repository identity",
    );
  });
  it("rejects worktree-only executable configuration", () => {
    const test = fixture();
    test.git("config", "extensions.worktreeConfig", "true");
    test.git("config", "--worktree", "diff.external", "/usr/bin/true");
    expect(test.invoke("run").stderr).toContain(
      "Unsupported Git configuration",
    );
  });
  it("rejects untracked info attributes", () => {
    const test = fixture();
    expect(test.invoke("run").status).toBe(0);
    const common = path.resolve(
      test.root,
      test.git("rev-parse", "--git-common-dir"),
    );
    writeFileSync(path.join(common, "info", "attributes"), "* -diff\n");
    expect(test.invoke("check").stderr).toContain("info/global attributes");
  });
  it("rejects tracked diff-hiding attributes", () => {
    const test = fixture("P2", false, "*.txt -diff\n");
    expect(test.invoke("run").stderr).toContain("Transforming Git attributes");
  });
  it("rejects ignored diff-hiding attributes absent from the committed tree", () => {
    const test = fixture();
    writeFileSync(
      path.join(test.root, ".git", "info", "exclude"),
      ".gitattributes\n",
    );
    writeFileSync(path.join(test.root, ".gitattributes"), "* -diff\n");
    expect(test.git("status", "--porcelain")).toBe("");
    expect(test.invoke("run").stderr).toContain("Transforming Git attributes");
  });
  it("checks ignored attributes affecting files deleted from the base", () => {
    const test = fixture("P2", false, undefined, true);
    writeFileSync(
      path.join(test.root, ".git", "info", "exclude"),
      "removed/.gitattributes\n",
    );
    writeFileSync(
      path.join(test.root, "removed", ".gitattributes"),
      "* -diff\n",
    );
    expect(test.git("status", "--porcelain")).toBe("");
    expect(test.invoke("run").stderr).toContain("Transforming Git attributes");
  });
});
