import { describe, expect, it } from "vitest";

import { projectRunOutcome } from "../src/runtime/outcome.js";
import type { RunRecord } from "../src/runtime/state.js";
import { projectRunTimeline } from "../src/runtime/timeline.js";

const digest = `sha256:${"a".repeat(64)}`;
const baseCommit = "b".repeat(40);
const candidateCommit = "c".repeat(40);
const candidateTree = "d".repeat(40);

function run(): RunRecord {
  return {
    id: "123e4567-e89b-42d3-a456-426614174000",
    repositoryId: "123e4567-e89b-42d3-a456-426614174001",
    taskId: "provider-migration",
    taskDigest: digest,
    configDigest: digest,
    status: "reviewed",
    baseCommit,
    candidateCommit,
    candidateTree,
    deadlineAt: "2026-09-12T12:00:00.000Z",
    cancelRequested: false,
    repairCount: 1,
    attemptCount: 2,
    createdAt: "2026-09-11T12:00:00.000Z",
    updatedAt: "2026-09-11T12:00:05.000Z",
    validationJson: JSON.stringify({
      schemaVersion: "1",
      candidateCommit,
      verifierImage: `node@${digest}`,
      network: "none",
      commands: [
        {
          commandId: "preservation",
          required: true,
          status: "passed",
          exitCode: 0,
          durationMs: 1,
          outputDigest: digest,
        },
        {
          commandId: "custom-owner",
          required: true,
          status: "passed",
          exitCode: 0,
          durationMs: 1,
          outputDigest: digest,
        },
      ],
      adaptation: {
        manifestDigest: digest,
        observedAt: "2026-09-11T12:00:04.000Z",
        assurance: "offline_fixture_execution",
        ownerAcceptance: "not_recorded",
        provider: {
          id: "synthetic-owner-api",
          from: "v1",
          to: "v2",
          notice: { path: "private-notice.md", digest },
        },
        workflows: ["onboard"],
        configurations: [
          {
            id: "custom",
            revision: "2",
            fixture: { path: "private-fixture.json", digest },
          },
        ],
        fixtures: {
          kind: "synthetic",
          capturedAt: "2026-09-11T11:00:00.000Z",
          expiresAt: "2026-09-12T11:00:00.000Z",
        },
        matrix: [
          {
            workflowId: "onboard",
            configurationId: "custom",
            status: "passed",
            commandId: "custom-owner",
            scenarioId: "SCN-CUSTOM",
            outputDigest: digest,
          },
        ],
      },
      passed: true,
    }),
    reviewJson: JSON.stringify({
      schemaVersion: "1",
      candidateCommit,
      scope: {
        baseCommit,
        candidateCommit,
        candidateTree,
        changedPaths: ["private/path.ts"],
        digest,
      },
      summary: "private review prose",
      findings: [],
    }),
  };
}

function events(
  status: RunRecord["status"] = "reviewed",
): Record<string, unknown>[] {
  const recorded = [
    {
      sequence: 1,
      occurredAt: "2026-09-11T12:00:00.000Z",
      type: "run.created",
      data: { status: "approved" },
    },
    {
      sequence: 2,
      occurredAt: "2026-09-11T12:00:01.000Z",
      type: "run.ready",
      data: { from: "approved", to: "ready" },
    },
    {
      sequence: 3,
      occurredAt: "2026-09-11T12:00:02.000Z",
      type: "builder.started",
      data: { from: "ready", to: "running" },
    },
    {
      sequence: 4,
      occurredAt: "2026-09-11T12:00:03.000Z",
      type: "candidate.committed",
      data: { from: "running", to: "committed" },
    },
    {
      sequence: 5,
      occurredAt: "2026-09-11T12:00:04.000Z",
      type: "validation.passed",
      data: { from: "committed", to: "verified" },
    },
    {
      sequence: 6,
      occurredAt: "2026-09-11T12:00:05.000Z",
      type: "review.passed",
      data: { from: "verified", to: "reviewed" },
    },
  ];
  if (status !== "closed") return recorded;
  return [
    ...recorded,
    {
      sequence: 7,
      occurredAt: "2026-09-11T12:00:06.000Z",
      type: "delivery.awaiting_approval",
      data: { from: "reviewed", to: "proposing" },
    },
    {
      sequence: 8,
      occurredAt: "2026-09-11T12:00:07.000Z",
      type: "delivery.awaiting_ci",
      data: { from: "proposing", to: "awaiting_ci" },
    },
    {
      sequence: 9,
      occurredAt: "2026-09-11T12:00:08.000Z",
      type: "delivery.awaiting_human",
      data: { from: "awaiting_ci", to: "awaiting_human" },
    },
    {
      sequence: 10,
      occurredAt: "2026-09-11T12:00:09.000Z",
      type: "delivery.merged",
      data: { from: "awaiting_human", to: "merged" },
    },
    {
      sequence: 11,
      occurredAt: "2026-09-11T12:00:10.000Z",
      type: "delivery.post_merge_verified",
      data: { from: "merged", to: "post_merge_verified" },
    },
    {
      sequence: 12,
      occurredAt: "2026-09-11T12:00:11.000Z",
      type: "run.closed",
      data: { from: "post_merge_verified", to: "closed" },
    },
  ];
}

function deliveryRecord(state: string): Record<string, unknown> {
  return {
    schemaVersion: "1",
    runId: "123e4567-e89b-42d3-a456-426614174000",
    deliveryKey: digest,
    proposalDigest: digest,
    approvalExpiresAt: "2026-09-12T12:00:00.000Z",
    state,
    target: {
      forge: "github",
      host: "github.com",
      owner: "example",
      repository: "app",
      repositoryNodeId: "R_example",
      cloneUrl: "https://github.com/example/app.git",
      remoteName: "origin",
      baseBranch: "main",
      actorLogin: "operator",
      actorId: 1,
    },
    branchName: "mill/provider-migration",
    candidateCommit,
    candidateTree,
    requiredChecks: ["validate"],
    reviewPolicy: { mode: "local_only", requiredReviewerLogins: [] },
    allowedMergerLogins: ["operator"],
    allowedMergeMethods: ["merge"],
    effects: [],
    remoteHeadCommit: null,
    pullRequest: null,
    observation: null,
    merge: null,
    lastErrorCode: null,
    createdAt: "2026-09-11T12:00:00.000Z",
    updatedAt: "2026-09-11T12:00:05.000Z",
  };
}

function outcome(record = run()) {
  return projectRunOutcome({
    run: record,
    timeline: projectRunTimeline({
      run: record,
      events: events(record.status),
    }),
    usage: {
      source: "unavailable",
      admittedCalls: 1,
      completedCalls: 0,
      measuredCalls: 0,
      inputTokens: null,
      outputTokens: null,
      cacheInputTokens: null,
      cacheSource: "unavailable",
      cost: "unavailable",
      blockEvents: 0,
    },
  });
}

describe("run outcome projection", () => {
  it("binds compact local evidence without inferring owner acceptance", () => {
    const value = outcome();

    expect(value).toMatchObject({
      run: {
        taskId: "provider-migration",
        baseCommit,
        candidateCommit,
        candidateTree,
        repairCount: 1,
        attemptCount: 2,
      },
      lifecycle: { timeline: "consistent", eventCount: 6 },
      validation: {
        status: "passed",
        candidateCommit,
        commands: { passed: 2, failed: 0, blocked: 0 },
        adaptation: {
          provider: { id: "synthetic-owner-api", from: "v1", to: "v2" },
          configurations: [{ id: "custom", revision: "2" }],
        },
      },
      review: { status: "clean", findingCounts: { P2: 0 } },
      ownerAcceptance: "not_recorded",
      integrity: { status: "consistent", reasons: [] },
    });
    const serialized = JSON.stringify(value);
    expect(serialized).not.toContain("private-notice.md");
    expect(serialized).not.toContain("private-fixture.json");
    expect(serialized).not.toContain("private review prose");
    expect(serialized).not.toContain("private body");
  });

  it("blocks invalid and cross-candidate evidence without leaking stored bytes", () => {
    const malformed = run();
    malformed.validationJson = JSON.stringify("private-invalid-validation");
    const malformedOutcome = outcome(malformed);
    expect(malformedOutcome.integrity).toMatchObject({
      status: "inconsistent",
      reasons: [{ code: "OUTCOME_VALIDATION_INVALID" }],
    });
    expect(JSON.stringify(malformedOutcome)).not.toContain(
      "private-invalid-validation",
    );

    const mismatched = run();
    mismatched.reviewJson = JSON.stringify({
      schemaVersion: "1",
      candidateCommit: "e".repeat(40),
      summary: "private mismatch",
      findings: [],
    });
    const mismatchedOutcome = outcome(mismatched);
    expect(mismatchedOutcome.integrity).toMatchObject({
      status: "inconsistent",
      reasons: [{ code: "OUTCOME_REVIEW_CANDIDATE_MISMATCH" }],
    });
    expect(JSON.stringify(mismatchedOutcome)).not.toContain("private mismatch");

    const missing = run();
    delete missing.validationJson;
    delete missing.reviewJson;
    expect(outcome(missing).integrity).toMatchObject({
      status: "inconsistent",
      reasons: [
        { code: "OUTCOME_VALIDATION_MISSING" },
        { code: "OUTCOME_REVIEW_MISSING" },
      ],
    });
  });

  it("blocks contradictory validation and review records", () => {
    const contradictoryValidation = run();
    const validation = JSON.parse(
      contradictoryValidation.validationJson ?? "null",
    ) as {
      commands: { status: string; exitCode: number | null }[];
    };
    const firstCommand = validation.commands[0];
    if (firstCommand === undefined)
      throw new Error("fixture lacks validation command evidence");
    firstCommand.exitCode = 1;
    contradictoryValidation.validationJson = JSON.stringify(validation);
    const contradictoryOutcome = outcome(contradictoryValidation);
    expect(contradictoryOutcome.integrity.status).toBe("inconsistent");
    expect(contradictoryOutcome.integrity.reasons).toContainEqual(
      expect.objectContaining({ code: "OUTCOME_VALIDATION_COMMAND_MISMATCH" }),
    );

    const refreshedScope = run();
    const refreshed = JSON.parse(refreshedScope.reviewJson ?? "null") as {
      scope: { baseCommit: string };
    };
    refreshed.scope.baseCommit = "e".repeat(40);
    refreshedScope.reviewJson = JSON.stringify(refreshed);
    expect(outcome(refreshedScope).integrity).toMatchObject({
      status: "consistent",
      reasons: [],
    });

    const mismatchedScope = run();
    const review = JSON.parse(mismatchedScope.reviewJson ?? "null") as {
      scope: { candidateCommit: string };
    };
    review.scope.candidateCommit = "e".repeat(40);
    mismatchedScope.reviewJson = JSON.stringify(review);
    expect(outcome(mismatchedScope).integrity).toMatchObject({
      status: "inconsistent",
      reasons: [{ code: "OUTCOME_REVIEW_CANDIDATE_MISMATCH" }],
    });

    const reviewedWithFindings = run();
    const reviewed = JSON.parse(reviewedWithFindings.reviewJson ?? "null") as {
      findings: unknown[];
    };
    reviewed.findings = [
      {
        id: "P2-1",
        severity: "P2",
        class: "maintainability",
        title: "private title",
        body: "private body",
        file: "private/path.ts",
        line: 1,
      },
    ];
    reviewedWithFindings.reviewJson = JSON.stringify(reviewed);
    expect(outcome(reviewedWithFindings).integrity).toMatchObject({
      status: "inconsistent",
      reasons: [{ code: "OUTCOME_REVIEW_RESULT_MISMATCH" }],
    });

    const incompleteSemantic = run();
    const semanticValidation = JSON.parse(
      incompleteSemantic.validationJson ?? "null",
    ) as { semantic?: unknown };
    semanticValidation.semantic = {
      impactManifestDigest: digest,
      items: [],
      newBehaviorPassed: true,
      preservationPassed: true,
      passed: true,
    };
    incompleteSemantic.validationJson = JSON.stringify(semanticValidation);
    expect(outcome(incompleteSemantic).integrity.reasons).toContainEqual(
      expect.objectContaining({
        code: "OUTCOME_VALIDATION_SEMANTIC_MISMATCH",
      }),
    );

    const unknownSemanticCommand = run();
    const unknownCommandValidation = JSON.parse(
      unknownSemanticCommand.validationJson ?? "null",
    ) as { semantic?: unknown };
    unknownCommandValidation.semantic = {
      impactManifestDigest: digest,
      items: [
        {
          kind: "acceptance",
          id: "ACC-CUSTOM",
          coverage: "new_behavior",
          status: "passed",
          evidenceRefs: ["command:missing"],
        },
      ],
      newBehaviorPassed: true,
      preservationPassed: true,
      passed: true,
    };
    unknownSemanticCommand.validationJson = JSON.stringify(
      unknownCommandValidation,
    );
    expect(outcome(unknownSemanticCommand).integrity.reasons).toContainEqual(
      expect.objectContaining({
        code: "OUTCOME_VALIDATION_SEMANTIC_MISMATCH",
      }),
    );

    const failedSemantic = run();
    failedSemantic.status = "blocked";
    const failedValidation = JSON.parse(
      failedSemantic.validationJson ?? "null",
    ) as {
      adaptation?: unknown;
      commands: { status: string; exitCode: number | null }[];
      semantic?: unknown;
      passed: boolean;
    };
    delete failedValidation.adaptation;
    const failedCommand = failedValidation.commands[0];
    if (failedCommand === undefined)
      throw new Error("fixture lacks validation command evidence");
    failedValidation.commands[0] = {
      ...failedCommand,
      status: "failed",
      exitCode: 1,
    };
    failedValidation.semantic = {
      impactManifestDigest: digest,
      items: [
        {
          kind: "acceptance",
          id: "ACC-BLOCKED",
          coverage: "new_behavior",
          status: "blocked",
          evidenceRefs: ["command:preservation"],
        },
        {
          kind: "scenario",
          id: "SCN-BLOCKED",
          coverage: "new_behavior",
          status: "blocked",
          evidenceRefs: ["acceptance:ACC-BLOCKED"],
        },
      ],
      newBehaviorPassed: false,
      preservationPassed: true,
      passed: false,
    };
    failedValidation.passed = false;
    failedSemantic.validationJson = JSON.stringify(failedValidation);
    const failedOutcome = outcome(failedSemantic);
    expect(failedOutcome.validation.status).toBe("failed");
    expect(failedOutcome.integrity.reasons).not.toContainEqual(
      expect.objectContaining({
        code: "OUTCOME_VALIDATION_SEMANTIC_MISMATCH",
      }),
    );

    const exceptionSemantic = run();
    const exceptionValidation = JSON.parse(
      exceptionSemantic.validationJson ?? "null",
    ) as { semantic?: unknown };
    exceptionValidation.semantic = {
      impactManifestDigest: digest,
      items: [
        {
          kind: "acceptance",
          id: "ACC-CUSTOM",
          coverage: "new_behavior",
          status: "passed",
          evidenceRefs: ["command:custom-owner"],
        },
        {
          kind: "invariant",
          id: "INV-EXCEPTION",
          coverage: "preservation",
          status: "attested",
          evidenceRefs: ["exception:EX-PRESERVATION"],
        },
      ],
      newBehaviorPassed: true,
      preservationPassed: true,
      passed: true,
    };
    exceptionSemantic.validationJson = JSON.stringify(exceptionValidation);
    expect(outcome(exceptionSemantic).integrity.status).toBe("consistent");
  });

  it("blocks evidence that lacks command or delivery receipts", () => {
    const unboundAdaptation = run();
    const validation = JSON.parse(
      unboundAdaptation.validationJson ?? "null",
    ) as { commands: unknown[] };
    validation.commands = [];
    unboundAdaptation.validationJson = JSON.stringify(validation);
    expect(outcome(unboundAdaptation).integrity.reasons).toContainEqual(
      expect.objectContaining({ code: "OUTCOME_ADAPTATION_COMMAND_MISMATCH" }),
    );

    const closedWithoutReceipts = run();
    closedWithoutReceipts.deliveryJson = JSON.stringify(
      deliveryRecord("closed"),
    );
    expect(outcome(closedWithoutReceipts).integrity.reasons).toContainEqual(
      expect.objectContaining({ code: "OUTCOME_DELIVERY_RECEIPT_MISMATCH" }),
    );

    const closedWithPlannedDelivery = run();
    closedWithPlannedDelivery.status = "closed";
    closedWithPlannedDelivery.deliveryJson = JSON.stringify(
      deliveryRecord("planned"),
    );
    const closedWithPlannedOutcome = outcome(closedWithPlannedDelivery);
    expect(closedWithPlannedOutcome.lifecycle.timeline).toBe("consistent");
    expect(closedWithPlannedOutcome.integrity.reasons).toContainEqual(
      expect.objectContaining({ code: "OUTCOME_DELIVERY_RECEIPT_MISMATCH" }),
    );

    const closedWithChecks = run();
    closedWithChecks.status = "closed";
    const closedDelivery = deliveryRecord("closed");
    closedDelivery.remoteHeadCommit = candidateCommit;
    closedDelivery.pullRequest = {
      number: 1,
      nodeId: "PR_example",
      url: "https://github.com/example/app/pull/1",
    };
    closedDelivery.merge = {
      commit: "e".repeat(40),
      tree: candidateTree,
      method: "merge",
      mergedByLogin: "operator",
      mergedAt: "2026-09-11T12:00:10.000Z",
      defaultBranchHead: "e".repeat(40),
    };
    closedDelivery.observation = {
      mergeChecks: [
        { name: "validate", status: "completed", conclusion: "success" },
      ],
    };
    closedWithChecks.deliveryJson = JSON.stringify(closedDelivery);
    expect(outcome(closedWithChecks).integrity.status).toBe("consistent");

    closedDelivery.observation = {
      mergeChecks: [
        { name: "validate", status: "completed", conclusion: "skipped" },
      ],
    };
    closedWithChecks.deliveryJson = JSON.stringify(closedDelivery);
    expect(outcome(closedWithChecks).integrity.reasons).toContainEqual(
      expect.objectContaining({ code: "OUTCOME_DELIVERY_RECEIPT_MISMATCH" }),
    );

    const unresolvedMerge = run();
    unresolvedMerge.status = "awaiting_human";
    const unresolvedDelivery = deliveryRecord("awaiting_human");
    unresolvedDelivery.remoteHeadCommit = candidateCommit;
    unresolvedDelivery.pullRequest = {
      number: 1,
      nodeId: "PR_example",
      url: "https://github.com/example/app/pull/1",
    };
    unresolvedDelivery.mergeApproval = {
      plan: {
        schemaVersion: "1",
        repositoryNodeId: "R_example",
        pullRequestNumber: 1,
        pullRequestNodeId: "PR_example",
        headCommit: candidateCommit,
        baseCommit,
        candidateTree,
        actorLogin: "operator",
        actorId: 1,
        policyDigest: digest,
        method: "merge",
        markReady: false,
        expiresAt: "2026-09-12T12:00:00.000Z",
      },
      digest,
      state: "effect_unknown",
      approvalSource: "attended_operator",
    };
    unresolvedMerge.deliveryJson = JSON.stringify(unresolvedDelivery);
    const unresolvedOutcome = outcome(unresolvedMerge);
    expect(unresolvedOutcome.delivery.status).toBe("effect_unknown");
    expect(unresolvedOutcome.integrity.reasons).toContainEqual(
      expect.objectContaining({ code: "OUTCOME_DELIVERY_EFFECT_UNRESOLVED" }),
    );
  });

  it("blocks stale adaptation evidence without relabeling the run accepted", () => {
    const stale = run();
    const parsed = JSON.parse(stale.validationJson ?? "null") as {
      adaptation: { fixtures: { expiresAt: string } };
    };
    parsed.adaptation.fixtures.expiresAt = "2026-09-10T00:00:00.000Z";
    stale.validationJson = JSON.stringify(parsed);

    expect(outcome(stale).integrity).toMatchObject({
      status: "inconsistent",
      reasons: [{ code: "OUTCOME_ADAPTATION_FIXTURE_STALE" }],
    });

    const future = run();
    const futureParsed = JSON.parse(future.validationJson ?? "null") as {
      adaptation: { fixtures: { capturedAt: string } };
    };
    futureParsed.adaptation.fixtures.capturedAt = "2026-09-12T00:00:00.000Z";
    future.validationJson = JSON.stringify(futureParsed);
    expect(outcome(future).integrity).toMatchObject({
      status: "inconsistent",
      reasons: [{ code: "OUTCOME_ADAPTATION_FIXTURE_FUTURE" }],
    });

    const legacy = run();
    const legacyValidation = JSON.parse(legacy.validationJson ?? "null") as {
      adaptation: { workflows?: unknown };
    };
    delete legacyValidation.adaptation.workflows;
    legacy.validationJson = JSON.stringify(legacyValidation);
    const legacyOutcome = outcome(legacy);
    expect(legacyOutcome.integrity.reasons).toContainEqual(
      expect.objectContaining({ code: "OUTCOME_ADAPTATION_COMMAND_MISMATCH" }),
    );
    expect(legacyOutcome.integrity.reasons).not.toContainEqual(
      expect.objectContaining({ code: "OUTCOME_VALIDATION_INVALID" }),
    );
  });

  it("blocks an incomplete configuration matrix", () => {
    const incomplete = run();
    const validation = JSON.parse(incomplete.validationJson ?? "null") as {
      adaptation: {
        configurations: Record<string, unknown>[];
        matrix: Record<string, unknown>[];
      };
    };
    validation.adaptation.configurations.push({
      id: "restricted",
      revision: "1",
      fixture: { path: "private-restricted.json", digest },
    });
    validation.adaptation.matrix.push({
      workflowId: "onboard",
      configurationId: "restricted",
      status: "passed",
      commandId: "preservation",
      scenarioId: "SCN-RESTRICTED",
      outputDigest: digest,
    });
    incomplete.validationJson = JSON.stringify(validation);
    expect(outcome(incomplete).integrity.status).toBe("consistent");

    validation.adaptation.matrix.pop();
    incomplete.validationJson = JSON.stringify(validation);
    expect(outcome(incomplete).integrity.reasons).toContainEqual(
      expect.objectContaining({ code: "OUTCOME_ADAPTATION_COMMAND_MISMATCH" }),
    );

    const reusedCommand = run();
    const reusedValidation = JSON.parse(
      reusedCommand.validationJson ?? "null",
    ) as {
      adaptation: {
        configurations: Record<string, unknown>[];
        matrix: Record<string, unknown>[];
      };
    };
    reusedValidation.adaptation.configurations.push({
      id: "restricted",
      revision: "1",
      fixture: { path: "private-restricted.json", digest },
    });
    reusedValidation.adaptation.matrix.push({
      workflowId: "onboard",
      configurationId: "restricted",
      status: "passed",
      commandId: "custom-owner",
      scenarioId: "SCN-RESTRICTED",
      outputDigest: digest,
    });
    reusedCommand.validationJson = JSON.stringify(reusedValidation);
    expect(outcome(reusedCommand).integrity.reasons).toContainEqual(
      expect.objectContaining({ code: "OUTCOME_ADAPTATION_COMMAND_MISMATCH" }),
    );
  });
});
