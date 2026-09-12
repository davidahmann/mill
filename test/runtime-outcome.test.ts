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

function events(): Record<string, unknown>[] {
  return [
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
}

function outcome(record = run()) {
  return projectRunOutcome({
    run: record,
    timeline: projectRunTimeline({ run: record, events: events() }),
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
    firstCommand.status = "failed";
    firstCommand.exitCode = 1;
    contradictoryValidation.validationJson = JSON.stringify(validation);
    expect(outcome(contradictoryValidation).integrity).toMatchObject({
      status: "inconsistent",
      reasons: [{ code: "OUTCOME_VALIDATION_RESULT_MISMATCH" }],
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
  });
});
