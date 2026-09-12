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
      semantic: {
        impactManifestDigest: digest,
        items: [
          {
            kind: "scenario",
            id: "SCN-CUSTOM",
            coverage: "new_behavior",
            status: "passed",
            evidenceRefs: ["command:custom-owner"],
          },
          {
            kind: "scenario",
            id: "SCN-RESTRICTED",
            coverage: "preservation",
            status: "passed",
            evidenceRefs: ["command:preservation"],
          },
          {
            kind: "invariant",
            id: "INV-PRESERVATION",
            coverage: "preservation",
            status: "passed",
            evidenceRefs: ["command:preservation"],
          },
        ],
        newBehaviorPassed: true,
        preservationPassed: true,
        passed: true,
      },
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
  if (status === "reviewed") return recorded;
  const deliveryEvents = [
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
  ];
  if (status === "awaiting_human") return deliveryEvents;
  const mergeEvents = [
    ...deliveryEvents,
    {
      sequence: 10,
      occurredAt: "2026-09-11T12:00:09.000Z",
      type: "delivery.merged",
      data: { from: "awaiting_human", to: "merged" },
    },
  ];
  if (status === "merged") return mergeEvents;
  const postMergeEvents = [
    ...mergeEvents,
    {
      sequence: 11,
      occurredAt: "2026-09-11T12:00:10.000Z",
      type: "delivery.post_merge_verified",
      data: { from: "merged", to: "post_merge_verified" },
    },
  ];
  if (status === "post_merge_verified") return postMergeEvents;
  if (status === "blocked")
    return [
      ...deliveryEvents,
      {
        sequence: 10,
        occurredAt: "2026-09-11T12:00:09.000Z",
        type: "run.blocked",
        data: { from: "awaiting_human", to: "blocked" },
      },
    ];
  if (status === "cancelled")
    return [
      ...recorded,
      {
        sequence: 7,
        occurredAt: "2026-09-11T12:00:06.000Z",
        type: "run.cancelled",
        data: { from: "reviewed", to: "cancelled" },
      },
    ];
  return [
    ...postMergeEvents,
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

function awaitingHumanDelivery(): Record<string, unknown> {
  const delivery = deliveryRecord("awaiting_human");
  delivery.remoteHeadCommit = candidateCommit;
  delivery.pullRequest = {
    number: 1,
    nodeId: "PR_example",
    url: "https://github.com/example/app/pull/1",
  };
  delivery.observation = {
    headSha: candidateCommit,
    branchSha: candidateCommit,
    checks: [
      {
        name: "validate",
        status: "completed",
        conclusion: "success",
        headSha: candidateCommit,
      },
    ],
    reviews: [],
    feedback: [],
  };
  return delivery;
}

function outcome(
  record = run(),
  recordedEvents: Record<string, unknown>[] = events(record.status),
) {
  return projectRunOutcome({
    run: record,
    timeline: projectRunTimeline({
      run: record,
      events: recordedEvents,
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
          kind: "scenario",
          id: "SCN-CUSTOM",
          coverage: "new_behavior",
          status: "passed",
          evidenceRefs: ["command:custom-owner"],
        },
        {
          kind: "invariant",
          id: "INV-EXCEPTION",
          coverage: "preservation",
          status: "attested",
          evidenceRefs: ["exception:risk:provider-v2"],
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

    closedDelivery.observation = {
      mergeChecks: [
        {
          name: "validate",
          status: "completed",
          conclusion: "success",
          headSha: "f".repeat(40),
        },
      ],
    };
    closedWithChecks.deliveryJson = JSON.stringify(closedDelivery);
    expect(outcome(closedWithChecks).integrity.reasons).toContainEqual(
      expect.objectContaining({ code: "OUTCOME_DELIVERY_RECEIPT_MISMATCH" }),
    );

    const unresolvedMerge = run();
    unresolvedMerge.status = "awaiting_human";
    const unresolvedDelivery = awaitingHumanDelivery();
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

  it("requires current PR, CI and review evidence before human merge readiness", () => {
    const legacyStatus = run();
    legacyStatus.status = "awaiting_human";
    const legacyDelivery = awaitingHumanDelivery();
    legacyDelivery.observation = {
      headSha: candidateCommit,
      branchSha: candidateCommit,
      checks: [
        { name: "validate", status: "completed", conclusion: "success" },
      ],
      reviews: [],
      feedback: [],
    };
    legacyStatus.deliveryJson = JSON.stringify(legacyDelivery);
    expect(outcome(legacyStatus).integrity.status).toBe("consistent");

    const mismatchedStatus = run();
    mismatchedStatus.status = "awaiting_human";
    const mismatchedDelivery = awaitingHumanDelivery();
    mismatchedDelivery.observation = {
      headSha: candidateCommit,
      branchSha: candidateCommit,
      checks: [
        {
          name: "validate",
          status: "completed",
          conclusion: "success",
          headSha: "e".repeat(40),
        },
      ],
      reviews: [],
      feedback: [],
    };
    mismatchedStatus.deliveryJson = JSON.stringify(mismatchedDelivery);
    expect(outcome(mismatchedStatus).integrity.reasons).toContainEqual(
      expect.objectContaining({ code: "OUTCOME_DELIVERY_RECEIPT_MISMATCH" }),
    );

    const ready = run();
    ready.status = "awaiting_human";
    const delivery = awaitingHumanDelivery();
    delivery.reviewPolicy = {
      mode: "github_required",
      requiredReviewerLogins: ["reviewer"],
    };
    delivery.observation = {
      headSha: candidateCommit,
      branchSha: candidateCommit,
      checks: [
        {
          name: "validate",
          status: "completed",
          conclusion: "success",
          headSha: candidateCommit,
        },
      ],
      reviews: [
        {
          actorLogin: "reviewer",
          state: "APPROVED",
          commitId: candidateCommit,
        },
      ],
      feedback: [],
    };
    ready.deliveryJson = JSON.stringify(delivery);
    expect(outcome(ready).integrity.status).toBe("consistent");

    delivery.observation = {
      headSha: candidateCommit,
      branchSha: candidateCommit,
      checks: [
        {
          name: "validate",
          status: "completed",
          conclusion: "failure",
          headSha: candidateCommit,
        },
      ],
      reviews: [],
      feedback: [],
    };
    ready.deliveryJson = JSON.stringify(delivery);
    expect(outcome(ready).integrity.reasons).toContainEqual(
      expect.objectContaining({ code: "OUTCOME_DELIVERY_RECEIPT_MISMATCH" }),
    );

    const merged = run();
    merged.status = "awaiting_human";
    const mergedDelivery = awaitingHumanDelivery();
    mergedDelivery.mergeApproval = {
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
      state: "merged",
      approvalSource: "attended_operator",
    };
    merged.deliveryJson = JSON.stringify(mergedDelivery);
    expect(outcome(merged).delivery.status).toBe("merged");
    expect(outcome(merged).integrity.status).toBe("consistent");

    const wrongMerge = run();
    wrongMerge.status = "awaiting_human";
    const wrongDelivery = JSON.parse(JSON.stringify(mergedDelivery)) as Record<
      string,
      unknown
    >;
    const approval = wrongDelivery.mergeApproval as {
      plan: { headCommit: string };
    };
    approval.plan.headCommit = "e".repeat(40);
    wrongMerge.deliveryJson = JSON.stringify(wrongDelivery);
    expect(outcome(wrongMerge).delivery.status).toBe("inconsistent");
    expect(outcome(wrongMerge).integrity.reasons).toContainEqual(
      expect.objectContaining({ code: "OUTCOME_DELIVERY_RECEIPT_MISMATCH" }),
    );
  });

  it("retains required evidence after a blocked or cancelled lifecycle", () => {
    const blocked = run();
    blocked.status = "blocked";
    delete blocked.validationJson;
    delete blocked.reviewJson;
    delete blocked.deliveryJson;
    const blockedOutcome = outcome(blocked);
    expect(blockedOutcome.integrity.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "OUTCOME_VALIDATION_MISSING" }),
        expect.objectContaining({ code: "OUTCOME_REVIEW_MISSING" }),
        expect.objectContaining({ code: "OUTCOME_DELIVERY_MISSING" }),
      ]),
    );

    const cancelled = run();
    cancelled.status = "cancelled";
    delete cancelled.validationJson;
    delete cancelled.reviewJson;
    const cancelledOutcome = outcome(cancelled);
    expect(cancelledOutcome.integrity.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "OUTCOME_VALIDATION_MISSING" }),
        expect.objectContaining({ code: "OUTCOME_REVIEW_MISSING" }),
      ]),
    );
    expect(cancelledOutcome.integrity.reasons).not.toContainEqual(
      expect.objectContaining({ code: "OUTCOME_DELIVERY_MISSING" }),
    );
  });

  it("retains failed validation and review evidence", () => {
    const validationFailed = run();
    validationFailed.status = "blocked";
    delete validationFailed.validationJson;
    const validationFailureEvents = [
      ...events("reviewed").slice(0, 4),
      {
        sequence: 5,
        occurredAt: "2026-09-11T12:00:04.000Z",
        type: "validation.failed",
        data: { from: "committed", to: "blocked" },
      },
    ];
    expect(
      outcome(validationFailed, validationFailureEvents).integrity.reasons,
    ).toContainEqual(
      expect.objectContaining({ code: "OUTCOME_VALIDATION_MISSING" }),
    );

    const retainedValidationFailure = run();
    retainedValidationFailure.status = "blocked";
    const failedValidation = JSON.parse(
      retainedValidationFailure.validationJson ?? "null",
    ) as {
      commands: { status: string; exitCode: number | null }[];
      passed: boolean;
    };
    const failedCommand = failedValidation.commands[0];
    if (failedCommand === undefined)
      throw new Error("expected validation command");
    failedCommand.status = "failed";
    failedCommand.exitCode = 1;
    failedValidation.passed = false;
    const failedSemantic = failedValidation as typeof failedValidation & {
      semantic: {
        items: { id: string; status: string }[];
        preservationPassed: boolean;
        passed: boolean;
      };
    };
    for (const item of failedSemantic.semantic.items) {
      if (["SCN-RESTRICTED", "INV-PRESERVATION"].includes(item.id))
        item.status = "blocked";
    }
    failedSemantic.semantic.preservationPassed = false;
    failedSemantic.semantic.passed = false;
    retainedValidationFailure.validationJson = JSON.stringify(failedValidation);
    const retainedValidationOutcome = outcome(
      retainedValidationFailure,
      validationFailureEvents,
    );
    expect(retainedValidationOutcome.validation.status).toBe("failed");
    expect(retainedValidationOutcome.integrity.reasons).not.toContainEqual(
      expect.objectContaining({
        code: "OUTCOME_VALIDATION_LIFECYCLE_MISMATCH",
      }),
    );

    const contradictoryValidation = run();
    contradictoryValidation.status = "blocked";
    const contradictoryValidationOutcome = outcome(
      contradictoryValidation,
      validationFailureEvents,
    );
    expect(contradictoryValidationOutcome.validation.status).toBe(
      "inconsistent",
    );
    expect(contradictoryValidationOutcome.integrity.reasons).toContainEqual(
      expect.objectContaining({
        code: "OUTCOME_VALIDATION_LIFECYCLE_MISMATCH",
      }),
    );

    const reviewFailed = run();
    reviewFailed.status = "blocked";
    delete reviewFailed.reviewJson;
    const reviewFailureEvents = [
      ...events("reviewed").slice(0, 5),
      {
        sequence: 6,
        occurredAt: "2026-09-11T12:00:05.000Z",
        type: "review.blocked",
        data: { from: "verified", to: "blocked" },
      },
    ];
    expect(
      outcome(reviewFailed, reviewFailureEvents).integrity.reasons,
    ).toContainEqual(
      expect.objectContaining({ code: "OUTCOME_REVIEW_MISSING" }),
    );

    const retainedReviewFailure = run();
    retainedReviewFailure.status = "blocked";
    const failedReview = JSON.parse(
      retainedReviewFailure.reviewJson ?? "null",
    ) as { findings: Record<string, unknown>[] };
    failedReview.findings.push({
      id: "review-finding",
      severity: "P2",
      class: "correctness",
      title: "Recorded review finding",
      body: "The independent review found a repairable defect.",
      file: "src/example.ts",
      line: 1,
    });
    retainedReviewFailure.reviewJson = JSON.stringify(failedReview);
    const retainedReviewOutcome = outcome(
      retainedReviewFailure,
      reviewFailureEvents,
    );
    expect(retainedReviewOutcome.review.status).toBe("findings");
    expect(retainedReviewOutcome.integrity.reasons).not.toContainEqual(
      expect.objectContaining({ code: "OUTCOME_REVIEW_RESULT_MISMATCH" }),
    );

    const contradictoryReview = run();
    contradictoryReview.status = "blocked";
    const contradictoryReviewOutcome = outcome(
      contradictoryReview,
      reviewFailureEvents,
    );
    expect(contradictoryReviewOutcome.review.status).toBe("inconsistent");
    expect(contradictoryReviewOutcome.integrity.reasons).toContainEqual(
      expect.objectContaining({ code: "OUTCOME_REVIEW_RESULT_MISMATCH" }),
    );
  });

  it("rejects an incompatible retained merge receipt", () => {
    const blocked = run();
    blocked.status = "blocked";
    const delivery = deliveryRecord("blocked");
    delivery.merge = {
      commit: "e".repeat(40),
      tree: "f".repeat(40),
      method: "merge",
      mergedByLogin: "operator",
      mergedAt: "2026-09-11T12:00:10.000Z",
      defaultBranchHead: "e".repeat(40),
    };
    blocked.deliveryJson = JSON.stringify(delivery);
    const value = outcome(blocked);
    expect(value.delivery.status).toBe("inconsistent");
    expect(value.integrity.reasons).toContainEqual(
      expect.objectContaining({ code: "OUTCOME_DELIVERY_RECEIPT_MISMATCH" }),
    );
  });

  it("requires merge and resulting-main evidence at their lifecycle milestones", () => {
    const unreceipted = run();
    unreceipted.status = "merged";
    const missingMerge = awaitingHumanDelivery();
    missingMerge.state = "merged";
    unreceipted.deliveryJson = JSON.stringify(missingMerge);
    expect(outcome(unreceipted).integrity.reasons).toContainEqual(
      expect.objectContaining({ code: "OUTCOME_DELIVERY_RECEIPT_MISMATCH" }),
    );

    const unverified = run();
    unverified.status = "post_merge_verified";
    const failedPostMerge = awaitingHumanDelivery();
    failedPostMerge.state = "merged";
    failedPostMerge.merge = {
      commit: "e".repeat(40),
      tree: candidateTree,
      method: "merge",
      mergedByLogin: "operator",
      mergedAt: "2026-09-11T12:00:10.000Z",
      defaultBranchHead: "e".repeat(40),
    };
    failedPostMerge.observation = {
      mergeChecks: [
        { name: "validate", status: "completed", conclusion: "failure" },
      ],
    };
    unverified.deliveryJson = JSON.stringify(failedPostMerge);
    expect(outcome(unverified).integrity.reasons).toContainEqual(
      expect.objectContaining({ code: "OUTCOME_DELIVERY_RECEIPT_MISMATCH" }),
    );

    const checkpoint = run();
    checkpoint.status = "post_merge_verified";
    const checkpointDelivery = awaitingHumanDelivery();
    checkpointDelivery.state = "closed";
    checkpointDelivery.merge = {
      commit: "e".repeat(40),
      tree: candidateTree,
      method: "merge",
      mergedByLogin: "operator",
      mergedAt: "2026-09-11T12:00:10.000Z",
      defaultBranchHead: "e".repeat(40),
    };
    checkpointDelivery.observation = {
      mergeChecks: [
        { name: "validate", status: "completed", conclusion: "success" },
      ],
    };
    checkpoint.deliveryJson = JSON.stringify(checkpointDelivery);
    expect(outcome(checkpoint).integrity.status).toBe("consistent");

    const policyMismatch = run();
    policyMismatch.status = "closed";
    const policyDelivery = JSON.parse(
      JSON.stringify(checkpointDelivery),
    ) as Record<string, unknown>;
    const policyMerge = policyDelivery.merge as { mergedByLogin: string };
    policyMerge.mergedByLogin = "unapproved-operator";
    policyMismatch.deliveryJson = JSON.stringify(policyDelivery);
    expect(outcome(policyMismatch).integrity.reasons).toContainEqual(
      expect.objectContaining({ code: "OUTCOME_DELIVERY_RECEIPT_MISMATCH" }),
    );

    const postMergePolicyMismatch = run();
    postMergePolicyMismatch.status = "closed";
    const postMergePolicyDelivery = JSON.parse(
      JSON.stringify(checkpointDelivery),
    ) as Record<string, unknown>;
    postMergePolicyDelivery.postMergeRequiredChecks = ["unrelated"];
    postMergePolicyDelivery.observation = {
      mergeChecks: [
        { name: "unrelated", status: "completed", conclusion: "success" },
      ],
    };
    postMergePolicyMismatch.deliveryJson = JSON.stringify(
      postMergePolicyDelivery,
    );
    expect(outcome(postMergePolicyMismatch).integrity.reasons).toContainEqual(
      expect.objectContaining({ code: "OUTCOME_DELIVERY_RECEIPT_MISMATCH" }),
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

    const malformed = run();
    const malformedValidation = JSON.parse(
      malformed.validationJson ?? "null",
    ) as {
      adaptation: { matrix: Record<string, unknown>[] };
    };
    const malformedCell = malformedValidation.adaptation.matrix[0];
    if (malformedCell === undefined)
      throw new Error("expected adaptation cell");
    malformedCell.workflowId = "";
    malformed.validationJson = JSON.stringify(malformedValidation);
    const malformedOutcome = outcome(malformed);
    expect(malformedOutcome.validation.adaptation).toBeNull();
    expect(malformedOutcome.integrity.reasons).toContainEqual(
      expect.objectContaining({ code: "OUTCOME_ADAPTATION_COMMAND_MISMATCH" }),
    );

    const malformedScenario = run();
    const malformedScenarioValidation = JSON.parse(
      malformedScenario.validationJson ?? "null",
    ) as {
      adaptation: { matrix: Record<string, unknown>[] };
    };
    const scenarioCell = malformedScenarioValidation.adaptation.matrix[0];
    if (scenarioCell === undefined) throw new Error("expected adaptation cell");
    scenarioCell.scenarioId = "";
    malformedScenario.validationJson = JSON.stringify(
      malformedScenarioValidation,
    );
    const malformedScenarioOutcome = outcome(malformedScenario);
    expect(malformedScenarioOutcome.validation.status).toBe("inconsistent");
    expect(malformedScenarioOutcome.validation.adaptation).toMatchObject({
      matrix: [expect.objectContaining({ scenarioId: null })],
    });
    expect(malformedScenarioOutcome.integrity.reasons).toContainEqual(
      expect.objectContaining({ code: "OUTCOME_ADAPTATION_MALFORMED" }),
    );

    const unknownScenario = run();
    const unknownScenarioValidation = JSON.parse(
      unknownScenario.validationJson ?? "null",
    ) as {
      adaptation: { matrix: Record<string, unknown>[] };
    };
    const unknownScenarioCell = unknownScenarioValidation.adaptation.matrix[0];
    if (unknownScenarioCell === undefined)
      throw new Error("expected adaptation cell");
    unknownScenarioCell.scenarioId = "SCN-UNKNOWN";
    unknownScenario.validationJson = JSON.stringify(unknownScenarioValidation);
    expect(outcome(unknownScenario).integrity.reasons).toContainEqual(
      expect.objectContaining({ code: "OUTCOME_ADAPTATION_COMMAND_MISMATCH" }),
    );
  });
});
