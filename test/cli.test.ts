import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { createProgram, runCli } from "../src/cli-program.js";
import { canonicalDigest } from "../src/contracts/canonical.js";
import { textDigest } from "../src/runtime/inputs.js";
import { MILL_VERSION } from "../src/version.js";
import { temporaryDirectory } from "./helpers.js";

const execFileAsync = promisify(execFile);

function capture(): {
  io: {
    stdout: { write: (value: string) => void };
    stderr: { write: (value: string) => void };
  };
  stdout: string[];
  stderr: string[];
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: { write: (value) => void stdout.push(value) },
      stderr: { write: (value) => void stderr.push(value) },
    },
    stdout,
    stderr,
  };
}

describe("CLI contracts", () => {
  it("keeps published shell-example flags aligned with the CLI without executing examples", async () => {
    const root = path.resolve(import.meta.dirname, "..");
    const program = createProgram(capture().io);
    const files = [
      "README.md",
      "AGENTS.md",
      "WORKFLOW.md",
      ...(await readdir(path.join(root, "docs")))
        .filter((file) => file.endsWith(".md"))
        .map((file) => `docs/${file}`),
    ];
    const unknown: { file: string; command: string; flag: string }[] = [];
    let checked = 0;
    for (const file of files) {
      const source = (await readFile(path.join(root, file), "utf8")).replace(
        /\\\n\s*/gu,
        " ",
      );
      for (const match of source.matchAll(/^millctl\s+(.+)$/gmu)) {
        const command = match[1];
        if (command === undefined) continue;
        checked++;
        let current = program;
        const options = [...program.options];
        for (const token of command.split(/\s+/u)) {
          const child = current.commands.find((item) => item.name() === token);
          if (child !== undefined) {
            current = child;
            options.push(...child.options);
          }
        }
        for (const flag of command.matchAll(
          /(?<!\S)(--[a-z][a-z-]*)(?=\s|=|$)/gu,
        )) {
          if (
            flag[1] !== undefined &&
            !options.some((option) => option.long === flag[1])
          )
            unknown.push({ file, command, flag: flag[1] });
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
    expect(unknown).toEqual([]);
  });
  it("emits a stable JSON envelope for PRD inspection", async () => {
    const temporary = await temporaryDirectory("mill-cli-");
    try {
      await writeFile(path.join(temporary.path, "PRD.md"), "# A product\n");
      const output = capture();
      const exitCode = await runCli(
        ["--json", "--cwd", temporary.path, "inspect", "--prd", "PRD.md"],
        output.io,
      );
      expect(exitCode).toBe(0);
      expect(output.stderr).toEqual([]);
      expect(JSON.parse(output.stdout.join(""))).toMatchObject({
        schemaVersion: "1",
        command: "inspect",
        ok: true,
        status: "ok",
        data: { authority: "narrative_untrusted" },
      });
    } finally {
      await temporary.cleanup();
    }
  });

  it("returns a typed error when a lock requires another version", async () => {
    const temporary = await temporaryDirectory("mill-cli-lock-");
    try {
      await writeFile(path.join(temporary.path, "PRD.md"), "# A product\n");
      await writeFile(
        path.join(temporary.path, "mill.lock"),
        'schemaVersion: "1"\nmill:\n  package: "@davidahmann/mill"\n  version: "1.2.3"\n',
      );
      const output = capture();
      const exitCode = await runCli(
        ["--json", "--cwd", temporary.path, "inspect", "--prd", "PRD.md"],
        output.io,
      );
      expect(exitCode).toBe(78);
      expect(JSON.parse(output.stdout.join(""))).toMatchObject({
        ok: false,
        reasons: [
          {
            code: "MILL_VERSION_MISMATCH",
            details: {
              exactInvocation: "npx --yes @davidahmann/mill@1.2.3",
            },
          },
        ],
      });
    } finally {
      await temporary.cleanup();
    }
  });

  it("validates compact contracts and rejects unknown kinds", async () => {
    const temporary = await temporaryDirectory("mill-cli-contract-");
    try {
      await mkdir(path.join(temporary.path, "product"));
      await writeFile(
        path.join(temporary.path, "product", "contract.yaml"),
        'schemaVersion: "1"\nid: product\ntitle: Product\nprimaryUser: Founder\njobToBeDone: Ship safely\noutcomes:\n  - id: OUT-REVIEWED-PR\n    statement: Reviewed PR\nnonGoals: []\nassumptions: []\nunknowns: []\nsourceRefs: ["PRD.md"]\n',
      );
      const valid = capture();
      expect(
        await runCli(
          [
            "--json",
            "--cwd",
            temporary.path,
            "validate-contract",
            "--kind",
            "productContract",
            "--file",
            "product/contract.yaml",
          ],
          valid.io,
        ),
      ).toBe(0);
      const invalid = capture();
      expect(
        await runCli(
          [
            "--json",
            "--cwd",
            temporary.path,
            "validate-contract",
            "--kind",
            "madeUp",
            "--file",
            "product/contract.yaml",
          ],
          invalid.io,
        ),
      ).toBe(64);
      expect(JSON.parse(invalid.stdout.join(""))).toMatchObject({
        ok: false,
        reasons: [{ code: "UNKNOWN_CONTRACT_KIND" }],
      });

      await writeFile(
        path.join(temporary.path, "product", "bad.yaml"),
        'schemaVersion: "1"\n',
      );
      const badContract = capture();
      expect(
        await runCli(
          [
            "--json",
            "--cwd",
            temporary.path,
            "validate-contract",
            "--kind",
            "productContract",
            "--file",
            "product/bad.yaml",
          ],
          badContract.io,
        ),
      ).toBe(65);
      expect(JSON.parse(badContract.stdout.join(""))).toMatchObject({
        ok: false,
        reasons: [{ code: "INVALID_CONTRACT" }],
      });

      await writeFile(
        path.join(temporary.path, "product", "malformed.json"),
        "{not-json",
      );
      const malformed = capture();
      expect(
        await runCli(
          [
            "--json",
            "--cwd",
            temporary.path,
            "validate-contract",
            "--kind",
            "productContract",
            "--file",
            "product/malformed.json",
          ],
          malformed.io,
        ),
      ).toBe(65);
      expect(JSON.parse(malformed.stdout.join(""))).toMatchObject({
        reasons: [{ code: "INVALID_CONTRACT" }],
      });

      const inheritedKind = capture();
      expect(
        await runCli(
          [
            "--json",
            "--cwd",
            temporary.path,
            "validate-contract",
            "--kind",
            "constructor",
            "--file",
            "product/contract.yaml",
          ],
          inheritedKind.io,
        ),
      ).toBe(64);
      expect(JSON.parse(inheritedKind.stdout.join(""))).toMatchObject({
        reasons: [{ code: "UNKNOWN_CONTRACT_KIND" }],
      });
    } finally {
      await temporary.cleanup();
    }
  });

  it("assesses an exact source-backed specification without writing files", async () => {
    const temporary = await temporaryDirectory("mill-cli-planning-");
    try {
      const prd = "# Product\n\nA founder needs a reviewed draft PR.\n";
      const sourceManifest = {
        schemaVersion: "1",
        trigger: "bootstrap",
        providers: [
          {
            id: "operator",
            name: "Operator",
            queries: [{ id: "Q1", text: "product intent", purpose: "scope" }],
            networkDisclosure: "No network access",
          },
        ],
        sources: [
          {
            id: "SRC-PRD",
            class: "user_evidence",
            uri: "PRD.md",
            revision: textDigest(prd),
            observedAt: "2026-09-02T12:00:00.000Z",
            freshness: "current",
            authority: "constraint",
            claims: ["A founder needs a reviewed draft PR."],
          },
        ],
      };
      const product = {
        schemaVersion: "1",
        id: "product",
        title: "Product",
        primaryUser: "Founder",
        jobToBeDone: "Receive one reviewed draft PR.",
        outcomes: [
          { id: "OUT-REVIEWED-DRAFT", statement: "Reviewed draft PR" },
        ],
        nonGoals: [],
        assumptions: [],
        unknowns: [],
        sourceRefs: ["SRC-PRD"],
        acceptance: [
          {
            id: "ACC-PR",
            kind: "functional",
            statement: "A reviewed draft PR is produced.",
            sourceRefs: ["SRC-PRD"],
          },
        ],
        invariants: [
          {
            id: "INV-HUMAN-MERGE",
            statement: "Only the configured human authority merges.",
            owner: "maintainer",
            criticality: "critical",
            surfaceRefs: ["github"],
            verification: { mode: "command", ref: "test" },
            sourceRefs: ["SRC-PRD"],
            unknowns: [],
          },
        ],
        decisions: [],
      };
      const productDigest = canonicalDigest(product);
      const proposal = {
        schemaVersion: "1",
        prd: { path: "PRD.md", digest: textDigest(prd) },
        sourceManifestDigest: canonicalDigest(sourceManifest),
        productContract: product,
        blueprints: [
          {
            schemaVersion: "1",
            id: "service",
            productContractDigest: productDigest,
            recipe: "node-service",
            recipeVersion: "1",
            runtime: "node-24",
            architecture: ["modular monolith"],
            risks: [],
          },
        ],
        scenarioSet: {
          schemaVersion: "1",
          productContractDigest: productDigest,
          scenarios: [
            {
              id: "SCN-PR",
              kind: "normal",
              given: ["approved intent"],
              when: ["Mill runs"],
              then: ["a reviewed candidate exists"],
              oracleOwner: "repository",
              acceptanceRefs: ["ACC-PR"],
              invariantRefs: ["INV-HUMAN-MERGE"],
              coverage: "both",
              visibility: "builder_visible",
              executionRef: "test",
              forbidden: [],
            },
          ],
        },
        assumptions: [],
        contradictions: [],
        questions: [],
        status: "proposed",
      };
      const impactProposal = {
        schemaVersion: "1",
        id: "cli-planning",
        productContractDigest: productDigest,
        outcomeId: "OUT-REVIEWED-DRAFT",
        riskClass: "low",
        acceptanceIds: ["ACC-PR"],
        affectedInvariantIds: ["INV-HUMAN-MERGE"],
        uncertainInvariantIds: [],
        surfaces: [
          { id: "planning", kind: "system", change: "Assess planning." },
        ],
        scenarioIds: ["SCN-PR"],
        commandIds: ["test"],
        materialDecisions: [],
        unresolved: [],
        exceptions: [],
        approval: null,
      };
      const impact = {
        ...impactProposal,
        approval: {
          approvedBy: "operator",
          approvedAt: "2026-09-02T12:00:00.000Z",
          proposalDigest: canonicalDigest(impactProposal),
        },
      };
      await Promise.all([
        writeFile(path.join(temporary.path, "PRD.md"), prd),
        writeFile(
          path.join(temporary.path, "sources.json"),
          JSON.stringify(sourceManifest),
        ),
        writeFile(
          path.join(temporary.path, "proposal.json"),
          JSON.stringify(proposal),
        ),
        writeFile(
          path.join(temporary.path, "product.json"),
          JSON.stringify(product),
        ),
        writeFile(
          path.join(temporary.path, "scenarios.json"),
          JSON.stringify(proposal.scenarioSet),
        ),
        writeFile(
          path.join(temporary.path, "impact.json"),
          JSON.stringify(impact),
        ),
      ]);
      const before = (await readdir(temporary.path)).sort();
      const output = capture();
      expect(
        await runCli(
          [
            "--json",
            "--cwd",
            temporary.path,
            "plan",
            "specification",
            "--prd",
            "PRD.md",
            "--sources",
            "sources.json",
            "--proposal",
            "proposal.json",
          ],
          output.io,
        ),
      ).toBe(0);
      const assessment = JSON.parse(output.stdout.join("")) as {
        data: { proposalDigest: string };
      };
      expect(assessment).toMatchObject({
        command: "plan.specification",
        ok: true,
        status: "ok",
        data: { promotable: true, blockers: [] },
      });

      const promoted = capture();
      expect(
        await runCli(
          [
            "--json",
            "--cwd",
            temporary.path,
            "plan",
            "promote",
            "--prd",
            "PRD.md",
            "--sources",
            "sources.json",
            "--proposal",
            "proposal.json",
            "--approve",
            assessment.data.proposalDigest,
          ],
          promoted.io,
        ),
      ).toBe(0);
      expect(JSON.parse(promoted.stdout.join(""))).toMatchObject({
        command: "plan.promote",
        ok: true,
        data: { proposalDigest: assessment.data.proposalDigest },
      });

      const diff = capture();
      expect(
        await runCli(
          [
            "--json",
            "--cwd",
            temporary.path,
            "plan",
            "diff",
            "--approved",
            "proposal.json",
            "--proposal",
            "proposal.json",
          ],
          diff.io,
        ),
      ).toBe(0);
      expect(JSON.parse(diff.stdout.join(""))).toMatchObject({
        command: "plan.diff",
        data: { changedPaths: [] },
      });

      const impactOutput = capture();
      expect(
        await runCli(
          [
            "--json",
            "--cwd",
            temporary.path,
            "plan",
            "impact",
            "--product",
            "product.json",
            "--scenarios",
            "scenarios.json",
            "--manifest",
            "impact.json",
          ],
          impactOutput.io,
        ),
      ).toBe(0);
      expect(JSON.parse(impactOutput.stdout.join(""))).toMatchObject({
        command: "plan.impact",
        status: "ok",
        data: { approved: true, blockers: [] },
      });
      await writeFile(
        path.join(temporary.path, "proposal.json"),
        JSON.stringify({
          ...proposal,
          sourceManifestDigest: `sha256:${"0".repeat(64)}`,
        }),
      );
      const blockedSpecification = capture();
      expect(
        await runCli(
          [
            "--json",
            "--cwd",
            temporary.path,
            "plan",
            "specification",
            "--prd",
            "PRD.md",
            "--sources",
            "sources.json",
            "--proposal",
            "proposal.json",
          ],
          blockedSpecification.io,
        ),
      ).not.toBe(0);
      expect(JSON.parse(blockedSpecification.stdout.join(""))).toMatchObject({
        command: "plan.specification",
        ok: false,
        status: "blocked",
      });
      await writeFile(
        path.join(temporary.path, "impact.json"),
        JSON.stringify({ ...impact, commandIds: ["outside"] }),
      );
      const blockedImpact = capture();
      expect(
        await runCli(
          [
            "--json",
            "--cwd",
            temporary.path,
            "plan",
            "impact",
            "--product",
            "product.json",
            "--scenarios",
            "scenarios.json",
            "--manifest",
            "impact.json",
          ],
          blockedImpact.io,
        ),
      ).not.toBe(0);
      expect(JSON.parse(blockedImpact.stdout.join(""))).toMatchObject({
        command: "plan.impact",
        ok: false,
        status: "blocked",
      });
      expect((await readdir(temporary.path)).sort()).toEqual(before);
    } finally {
      await temporary.cleanup();
    }
  });

  it("emits human output and blocks hazardous adoption", async () => {
    const temporary = await temporaryDirectory("mill-cli-adopt-");
    try {
      await execFileAsync("/usr/bin/git", ["init", "--initial-branch=main"], {
        cwd: temporary.path,
      });
      await writeFile(
        path.join(temporary.path, ".git", "config"),
        "[core]\n  hooksPath = hooks\n",
      );
      const output = capture();
      expect(
        await runCli(
          ["--cwd", temporary.path, "adopt", "--scan-only"],
          output.io,
        ),
      ).toBe(78);
      expect(output.stdout.join("")).toContain("BLOCKED: adopt.scan");
      expect(output.stdout.join("")).toContain("UNSAFE_GIT_CONFIGURATION");
      await execFileAsync(
        "/usr/bin/git",
        ["config", "--unset", "core.hooksPath"],
        { cwd: temporary.path },
      );
      await writeFile(path.join(temporary.path, ".npmrc"), "//registry=:x\n");
      const sensitive = capture();
      expect(
        await runCli(
          ["--cwd", temporary.path, "adopt", "--scan-only"],
          sensitive.io,
        ),
      ).toBe(78);
      expect(sensitive.stdout.join("")).toContain("SENSITIVE_PATHS_PRESENT");
    } finally {
      await temporary.cleanup();
    }
  });

  it("keeps integration wrappers explicit and supports read-only local utilities", async () => {
    const temporary = await temporaryDirectory("mill-cli-integration-");
    try {
      const conflictingNew = capture();
      expect(
        await runCli(
          [
            "--json",
            "--cwd",
            temporary.path,
            "new",
            "app",
            "--dry-run",
            "--apply",
          ],
          conflictingNew.io,
        ),
      ).toBe(64);
      expect(JSON.parse(conflictingNew.stdout.join(""))).toMatchObject({
        reasons: [{ code: "USAGE_ERROR" }],
      });
      const incompleteNew = capture();
      expect(
        await runCli(
          ["--json", "--cwd", temporary.path, "new", "app", "--dry-run"],
          incompleteNew.io,
        ),
      ).toBe(64);
      expect(JSON.parse(incompleteNew.stdout.join(""))).toMatchObject({
        reasons: [{ code: "USAGE_ERROR" }],
      });

      const conflictingAdopt = capture();
      expect(
        await runCli(
          ["--json", "--cwd", temporary.path, "adopt", "--plan", "--apply"],
          conflictingAdopt.io,
        ),
      ).toBe(64);

      const safeScan = capture();
      const safeScanExit = await runCli(
        ["--json", "--cwd", temporary.path, "adopt", "--scan-only"],
        safeScan.io,
      );
      expect(safeScanExit, safeScan.stdout.join("")).toBe(0);
      expect(JSON.parse(safeScan.stdout.join(""))).toMatchObject({
        command: "adopt.scan",
        ok: true,
      });

      await mkdir(path.join(temporary.path, ".git"));
      await writeFile(
        path.join(temporary.path, "mill.yaml"),
        'schemaVersion: "1"\nrepositoryId: "123e4567-e89b-42d3-a456-426614174000"\ntrustCeiling: inspect\ncommands: {}\n',
      );
      const dependencies = capture();
      expect(
        await runCli(
          [
            "--json",
            "--cwd",
            temporary.path,
            "dependencies",
            "prepare",
            "--attended",
          ],
          dependencies.io,
        ),
      ).toBe(0);
      expect(JSON.parse(dependencies.stdout.join(""))).toMatchObject({
        command: "dependencies.prepare",
        data: { configured: false },
      });
      await writeFile(
        path.join(temporary.path, "mill.lock"),
        `schemaVersion: "1"\nmill:\n  package: "@davidahmann/mill"\n  version: "${MILL_VERSION}"\nintegration:\n  mode: greenfield\n  planDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"\n  baseCommit: null\n  files: []\n`,
      );
      const detach = capture();
      expect(
        await runCli(
          ["--json", "--cwd", temporary.path, "detach", "plan"],
          detach.io,
        ),
      ).toBe(0);
      expect(JSON.parse(detach.stdout.join(""))).toMatchObject({
        command: "detach.plan",
        data: { mode: "manual", remove: ["mill.lock"] },
      });
      await writeFile(
        path.join(temporary.path, "mill.lock"),
        `schemaVersion: "1"\nmill:\n  package: "@davidahmann/mill"\n  version: "${MILL_VERSION}"\n`,
      );
      const legacyDetach = capture();
      expect(
        await runCli(
          ["--json", "--cwd", temporary.path, "detach", "plan"],
          legacyDetach.io,
        ),
      ).toBe(78);
      expect(JSON.parse(legacyDetach.stdout.join(""))).toMatchObject({
        reasons: [{ code: "DETACH_METADATA_UNAVAILABLE" }],
      });
    } finally {
      await temporary.cleanup();
    }
  });

  it("returns usage errors without fabricating a command result", async () => {
    const output = capture();
    expect(await runCli(["doctor", "--mode", "invalid"], output.io)).toBe(64);
    expect(output.stderr.join("")).toContain(
      "mode must be inspect, build, or propose",
    );
  });

  it("treats the human help subcommand as a successful meta request", async () => {
    const output = capture();
    expect(await runCli(["help", "doctor"], output.io)).toBe(0);
    expect(output.stderr).toEqual([]);
    expect(output.stdout.join("")).toContain("Usage: millctl doctor");
  });

  it("keeps Commander usage failures machine-readable in JSON mode", async () => {
    const output = capture();
    expect(
      await runCli(["--json", "doctor", "--mode", "invalid"], output.io),
    ).toBe(64);
    expect(output.stderr).toEqual([]);
    expect(JSON.parse(output.stdout.join(""))).toMatchObject({
      ok: false,
      status: "error",
      reasons: [{ code: "USAGE_ERROR" }],
    });
  });

  it("keeps JSON meta requests machine-readable", async () => {
    const version = capture();
    expect(await runCli(["--json", "--version"], version.io)).toBe(0);
    expect(JSON.parse(version.stdout.join(""))).toMatchObject({
      command: "version",
      ok: true,
      data: { version: MILL_VERSION },
    });

    const help = capture();
    expect(await runCli(["--json", "--help"], help.io)).toBe(64);
    expect(help.stderr).toEqual([]);
    expect(JSON.parse(help.stdout.join(""))).toMatchObject({
      command: "millctl",
      ok: false,
      reasons: [{ code: "USAGE_ERROR" }],
    });

    const helpCommand = capture();
    expect(await runCli(["--json", "help", "doctor"], helpCommand.io)).toBe(64);
    expect(helpCommand.stderr).toEqual([]);
    expect(JSON.parse(helpCommand.stdout.join(""))).toMatchObject({
      ok: false,
      reasons: [{ code: "USAGE_ERROR" }],
    });
  });

  it("returns typed input errors without exposing absolute host paths", async () => {
    const temporary = await temporaryDirectory("mill-cli-missing-");
    try {
      const output = capture();
      expect(
        await runCli(
          ["--json", "--cwd", temporary.path, "inspect", "--prd", "missing.md"],
          output.io,
        ),
      ).toBe(65);
      const source = output.stdout.join("");
      expect(source).not.toContain(temporary.path);
      expect(JSON.parse(source)).toMatchObject({
        ok: false,
        reasons: [{ code: "FILE_NOT_FOUND" }],
      });
    } finally {
      await temporary.cleanup();
    }
  });
});
