import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import { runCli } from "../src/cli-program.js";
import {
  publicAlphaQualificationSchema,
  supportTupleSchema,
} from "../src/contracts/schemas.js";
import { assessPublicAlphaQualification } from "../src/qualification/public-alpha.js";
import { loadNodeWebRecipe } from "../src/recipes/node-typescript-next-web.js";
import { temporaryDirectory } from "./helpers.js";

const auditCategories = [
  "product",
  "code",
  "ux",
  "accessibility",
  "security",
  "dependencies",
  "architecture",
  "operations",
  "release",
] as const;

function commit(character: string): string {
  return character.repeat(40);
}

function qualification() {
  const commits = ["1", "2", "3", "4", "5", "6"].map(commit);
  return publicAlphaQualificationSchema.parse({
    schemaVersion: "1",
    package: {
      name: "@davidahmann/mill",
      version: "0.1.0",
      artifactDigest: `sha256:${"a".repeat(64)}`,
      npmIntegrity: `sha512-${Buffer.alloc(64).toString("base64")}`,
    },
    supportTuple: {
      id: "linux-x64-node-24-codex",
      status: "qualified",
      testedAt: "2026-09-02T10:00:00.000Z",
      expiresAt: "2026-10-03T10:00:00.000Z",
      host: { os: "linux", architecture: "x64" },
      runtime: { node: "24.20.0", npm: "11.19.0" },
      container: {
        engine: "docker",
        version: "28.0.0",
        verifierImage: `image@sha256:${"b".repeat(64)}`,
      },
      worker: {
        adapter: "codex-cli",
        harnessVersion: "0.90.0",
        modelIdentity: "provider-mutable",
        authMode: "operator-session",
      },
      forge: { gitVersion: "2.51.0", ghVersion: "2.80.0", host: "github.com" },
      recipe: {
        id: "node-typescript-next-web",
        version: "1.0.0",
        digest: `sha256:${"c".repeat(64)}`,
      },
    },
    sequence: {
      steps: commits.slice(1).map((candidateCommit, index) => ({
        id: `step-${index + 1}`,
        dependsOn: index === 0 ? [] : [`step-${index}`],
        baseCommit: commits[index],
        candidateCommit,
        status: "accepted",
        newBehavior: {
          requiredIds: [`ACC-STEP-${index + 1}`],
          passedIds: [`ACC-STEP-${index + 1}`],
        },
        preservation: {
          requiredIds: ["INV-CONTINUITY"],
          passedIds: ["INV-CONTINUITY"],
        },
        scenarioIds: [`SCN-STEP-${index + 1}`],
        usage: {
          inputTokens: 10,
          outputTokens: 2,
          currencyCost: null,
          source: "provider-measured",
        },
      })),
      seededFault: {
        baseCommit: commits[2],
        candidateCommit: commit("f"),
        status: "failed",
        rejected: true,
        recovered: true,
        enteredAcceptedSequence: false,
        reason: "the preservation oracle rejected a zero value",
      },
    },
    canaries: {
      packedInstall: "passed",
      greenfield: "passed",
      adoption: "passed",
      downstreamWithoutMill: "passed",
      recovery: "passed",
      security: "passed",
    },
    auditCandidate: { commit: commits[5], tree: commit("a") },
    audits: auditCategories.map((category, index) => ({
      category,
      status: "passed",
      reportDigest: `sha256:${index.toString(16).repeat(64)}`,
    })),
    generatedAt: "2026-09-02T10:30:00.000Z",
  });
}

describe("public-alpha longitudinal qualification", () => {
  it("keeps the candidate support tuple experimental and bound to the exact recipe", async () => {
    const tuple = supportTupleSchema.parse(
      parseYaml(
        await readFile(
          "quality/support-tuples/darwin-arm64-node24-candidate.yaml",
          "utf8",
        ),
      ),
    );
    const recipe = await loadNodeWebRecipe();
    expect(tuple.status).toBe("experimental");
    expect(tuple.recipe).toMatchObject({
      id: recipe.manifest.id,
      version: recipe.manifest.version,
      digest: recipe.digest,
    });
  });

  it("accepts a continuous five-step sequence and rejected seeded fault", () => {
    const result = assessPublicAlphaQualification(
      qualification(),
      new Date("2026-09-03T11:00:00.000Z"),
    );
    expect(result.passed).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.reportDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("blocks discontinuity, concealed preservation failure, and fault admission", () => {
    const report = qualification();
    const third = report.sequence.steps[2];
    const fourth = report.sequence.steps[3];
    if (third === undefined || fourth === undefined) {
      throw new Error("qualification fixture has fewer than four steps");
    }
    third.baseCommit = commit("e");
    fourth.preservation.passedIds = [];
    report.sequence.seededFault.enteredAcceptedSequence = true;
    const result = assessPublicAlphaQualification(
      report,
      new Date("2026-09-03T11:00:00.000Z"),
    );
    expect(result.passed).toBe(false);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        "step-3 does not start from the prior accepted output",
        "step-4 does not preserve every required prior item",
        "seeded fault was not rejected and recovered outside the accepted sequence",
      ]),
    );
  });

  it("blocks stale support, skipped canaries, incomplete audits, and invented usage", () => {
    const report = qualification();
    report.supportTuple.expiresAt = "2026-09-03T10:45:00.000Z";
    report.canaries.adoption = "skipped";
    report.audits.pop();
    const first = report.sequence.steps[0];
    if (first === undefined) {
      throw new Error("qualification fixture has no first step");
    }
    first.usage = {
      inputTokens: 1,
      outputTokens: null,
      currencyCost: null,
      source: "unavailable",
    };
    const result = assessPublicAlphaQualification(
      report,
      new Date("2026-09-03T11:00:00.000Z"),
    );
    expect(result.passed).toBe(false);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        "support tuple qualification is expired or has no valid window",
        "required canary did not pass: adoption",
        "qualification does not contain exactly one result for every audit category",
        "step-1 reports usage while declaring it unavailable",
      ]),
    );
  });

  it("blocks unsupported, future, duplicate, unresolved, and ungrounded sequence evidence", () => {
    const report = qualification();
    const [first, second, third] = report.sequence.steps;
    const firstAudit = report.audits[0];
    if (
      first === undefined ||
      second === undefined ||
      third === undefined ||
      firstAudit === undefined
    ) {
      throw new Error("qualification fixture is incomplete");
    }
    report.supportTuple.status = "experimental";
    report.supportTuple.testedAt = "2026-09-04T10:00:00.000Z";
    report.generatedAt = "2026-09-04T10:00:00.000Z";
    first.dependsOn = ["unexpected-parent"];
    second.id = first.id;
    second.candidateCommit = third.candidateCommit;
    first.candidateCommit = first.baseCommit;
    first.status = "rejected";
    first.newBehavior.passedIds = [];
    first.usage = {
      inputTokens: null,
      outputTokens: null,
      currencyCost: null,
      source: "operator-declared",
    };
    report.sequence.seededFault.baseCommit = commit("e");
    firstAudit.status = "failed";
    const result = assessPublicAlphaQualification(
      report,
      new Date("2026-09-03T11:00:00.000Z"),
    );
    expect(result.passed).toBe(false);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        "support tuple is not qualified",
        "qualification evidence is future-dated",
        "longitudinal step IDs are duplicated",
        "accepted sequence reuses a candidate commit",
        "step-1 must be the dependency-free sequence root",
        "step-1 did not produce a new candidate identity",
        "step-1 is not accepted",
        "step-1 does not close every new-behavior item",
        "step-1 has no operator-declared usage value",
        "seeded fault does not branch from an accepted identity",
        "required audit did not pass: product",
      ]),
    );
  });

  it("exposes the assessment through the stable CLI envelope", async () => {
    const temporary = await temporaryDirectory("mill-public-alpha-cli-");
    try {
      execFileSync("/usr/bin/git", ["init", "--quiet"], {
        cwd: temporary.path,
      });
      await writeFile(
        path.join(temporary.path, "qualification.json"),
        `${JSON.stringify(qualification())}\n`,
      );
      const stdout: string[] = [];
      const stderr: string[] = [];
      const exitCode = await runCli(
        [
          "--json",
          "--cwd",
          temporary.path,
          "qualify",
          "public-alpha",
          "--file",
          "qualification.json",
        ],
        {
          stdout: { write: (value) => void stdout.push(value) },
          stderr: { write: (value) => void stderr.push(value) },
        },
      );
      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);
      expect(JSON.parse(stdout.join(""))).toMatchObject({
        command: "qualify.public-alpha",
        ok: true,
        status: "ok",
        data: { passed: true, blockers: [] },
      });
    } finally {
      await temporary.cleanup();
    }
  });
});
