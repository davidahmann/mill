import { describe, expect, it } from "vitest";
import {
  assertOutcomeDependencies,
  type OutcomePlan,
} from "../src/planning/outcomes.js";
import { validationRepairFindings } from "../src/runtime/repair.js";
import type { RunRecord } from "../src/runtime/state.js";
import { checkDecision } from "../src/runtime/delivery.js";

const outcome = (
  id: string,
  dependsOn: string[] = [],
  status: "ready" | "closed" | "approved" = "approved",
) => ({ id, title: id, acceptance: ["works"], dependsOn, status });
const plan = (outcomes: OutcomePlan["outcomes"]): OutcomePlan => ({
  schemaVersion: "1",
  productContractDigest: `sha256:${"a".repeat(64)}`,
  outcomes,
});

describe("dependency admission", () => {
  it("accepts closed predecessors and independent proposed work", () => {
    expect(() =>
      assertOutcomeDependencies(
        plan([outcome("one", [], "closed"), outcome("two", ["one"], "ready")]),
      ),
    ).not.toThrow();
    expect(() =>
      assertOutcomeDependencies(
        plan([outcome("one"), outcome("two", ["one"])]),
      ),
    ).not.toThrow();
  });
  it.each([
    [outcome("one"), outcome("one")],
    [outcome("one", ["absent"])],
    [outcome("one", ["one"])],
    [outcome("one", ["two"]), outcome("two", ["one"])],
    [outcome("one"), outcome("two", ["one", "one"])],
    [outcome("one"), outcome("two", ["one"], "ready")],
  ])("rejects invalid dependency graphs %#", (...outcomes) => {
    expect(() => assertOutcomeDependencies(plan(outcomes))).toThrow(
      expect.objectContaining({ code: "OUTCOME_DEPENDENCY_INVALID" }),
    );
  });
});

describe("native failure repair", () => {
  const evidence = {
    schemaVersion: "1",
    candidateCommit: "a".repeat(40),
    verifierImage: `local/test@sha256:${"b".repeat(64)}`,
    network: "none",
    passed: false,
    commands: [
      {
        commandId: "test",
        required: true,
        status: "failed",
        exitCode: 1,
        durationMs: 1,
        outputDigest: `sha256:${"c".repeat(64)}`,
        reason: "NONZERO_EXIT",
      },
    ],
  };
  const run = (value: unknown, code = "VALIDATION_FAILED") =>
    ({
      blockCode: code,
      candidateCommit: "a".repeat(40),
      validationJson: JSON.stringify(value),
    }) as RunRecord;
  it("uses exact failed command evidence without widening scope", () => {
    expect(validationRepairFindings(run(evidence))?.[0]).toMatchObject({
      id: "validation-test",
      severity: "P1",
      file: null,
    });
    expect(validationRepairFindings(run(evidence, "OTHER"))).toBeUndefined();
    expect(
      validationRepairFindings({ blockCode: "VALIDATION_FAILED" } as RunRecord),
    ).toBeUndefined();
  });
  it("rejects corrupt, successful, or wrong-candidate evidence", () => {
    for (const value of [
      null,
      { ...evidence, passed: true },
      { ...evidence, candidateCommit: "b".repeat(40) },
    ]) {
      expect(() => validationRepairFindings(run(value))).toThrow(
        expect.objectContaining({ code: "VALIDATION_EVIDENCE_INVALID" }),
      );
    }
    expect(() =>
      validationRepairFindings({ ...run(evidence), validationJson: "{" }),
    ).toThrow();
  });
  it("does not turn environment or semantic authority failures into builder repairs", () => {
    expect(
      validationRepairFindings(run({ ...evidence, commands: [] })),
    ).toBeUndefined();
    expect(
      validationRepairFindings(
        run({
          ...evidence,
          commands: [
            {
              ...evidence.commands[0],
              status: "blocked",
              reason: "HOST_EXECUTION_NOT_QUALIFIED",
            },
          ],
        }),
      ),
    ).toBeUndefined();
  });
});

describe("CI producer binding", () => {
  const sha = "a".repeat(40);
  const producers = {
    validate: {
      appId: 15368,
      workflowPath: ".github/workflows/ci.yml",
      pullRequestEvent: "pull_request" as const,
      postMergeEvent: "push" as const,
    },
  };
  const check = {
    name: "validate",
    status: "completed",
    conclusion: "success",
    appId: 15368,
    workflowPath: ".github/workflows/ci.yml",
    event: "pull_request",
    headSha: sha,
  };
  it("requires the configured producer, workflow, event and exact commit", () => {
    expect(
      checkDecision(["validate"], [check], producers, "pull_request", sha)
        .status,
    ).toBe("passed");
    for (const changes of [
      { appId: 1 },
      { workflowPath: ".github/workflows/other.yml" },
      { event: "push" },
      { headSha: "b".repeat(40) },
    ]) {
      expect(
        checkDecision(
          ["validate"],
          [{ ...check, ...changes }],
          producers,
          "pull_request",
          sha,
        ).status,
      ).toBe("pending");
    }
    expect(
      checkDecision(
        ["validate"],
        [{ ...check, event: "push" }],
        producers,
        "push",
        sha,
      ).status,
    ).toBe("passed");
    expect(checkDecision(["unknown"], [], producers, "push", sha).status).toBe(
      "pending",
    );
  });
  it("never substitutes a same-name foreign success for a failed authorized check", () => {
    expect(
      checkDecision(
        ["validate"],
        [
          { ...check, conclusion: "failure" },
          { ...check, appId: 7 },
        ],
        producers,
        "pull_request",
        sha,
      ).status,
    ).toBe("failed");
    expect(
      checkDecision(
        ["validate"],
        [{ ...check, conclusion: "skipped" }],
        producers,
        "pull_request",
        sha,
      ).status,
    ).toBe("failed");
  });
});
