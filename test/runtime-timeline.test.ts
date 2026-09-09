import { describe, expect, it } from "vitest";

import { projectRunTimeline } from "../src/runtime/timeline.js";
import type { PublicRunRecord, RunStatus } from "../src/runtime/state.js";

function run(status: RunStatus): PublicRunRecord {
  return {
    id: "123e4567-e89b-12d3-a456-426614174000",
    repositoryId: "11111111-1111-4111-8111-111111111111",
    taskId: "task-1",
    taskDigest: `sha256:${"a".repeat(64)}`,
    configDigest: `sha256:${"b".repeat(64)}`,
    status,
    baseCommit: "c".repeat(40),
    candidateCommit: "d".repeat(40),
    deadlineAt: "2026-09-09T13:00:00.000Z",
    cancelRequested: false,
    repairCount: 0,
    attemptCount: 1,
    createdAt: "2026-09-09T12:00:00.000Z",
    updatedAt: "2026-09-09T12:00:05.000Z",
  };
}

function events(): Record<string, unknown>[] {
  return [
    {
      sequence: 10,
      occurredAt: "2026-09-09T12:00:00.000Z",
      type: "run.created",
      data: { status: "approved", hidden: "/private/customer/source" },
    },
    {
      sequence: 11,
      occurredAt: "2026-09-09T12:00:01.000Z",
      type: "run.ready",
      data: { from: "approved", to: "ready" },
    },
    {
      sequence: 12,
      occurredAt: "2026-09-09T12:00:02.000Z",
      type: "builder.started",
      data: { from: "ready", to: "running" },
    },
    {
      sequence: 13,
      occurredAt: "2026-09-09T12:00:03.000Z",
      type: "candidate.committed",
      data: { from: "running", to: "committed" },
    },
    {
      sequence: 14,
      occurredAt: "2026-09-09T12:00:04.000Z",
      type: "validation.passed",
      data: { from: "committed", to: "verified" },
    },
    {
      sequence: 15,
      occurredAt: "2026-09-09T12:00:05.000Z",
      type: "review.passed",
      data: { from: "verified", to: "reviewed" },
    },
  ];
}

describe("run timeline projection", () => {
  it("projects a compact, consistent lifecycle without exposing event data", () => {
    const timeline = projectRunTimeline({
      run: run("reviewed"),
      events: events(),
    });

    expect(timeline).toMatchObject({
      schemaVersion: "1",
      run: { status: "reviewed", candidateCommit: "d".repeat(40) },
      integrity: { status: "consistent", reasons: [] },
    });
    expect(timeline.events).toEqual(
      expect.arrayContaining([
        {
          sequence: 10,
          occurredAt: "2026-09-09T12:00:00.000Z",
          type: "run.created",
        },
        {
          sequence: 11,
          occurredAt: "2026-09-09T12:00:01.000Z",
          type: "run.ready",
          transition: { from: "approved", to: "ready" },
        },
      ]),
    );
    expect(JSON.stringify(timeline)).not.toContain("/private/customer/source");
  });

  it("marks discontinuous and forbidden transitions inconsistent", () => {
    const invalid = events();
    invalid[2] = {
      sequence: 12,
      occurredAt: "2026-09-09T12:00:02.000Z",
      type: "builder.started",
      data: { from: "reviewed", to: "running" },
    };
    const timeline = projectRunTimeline({
      run: run("reviewed"),
      events: invalid,
    });

    expect(timeline.integrity.status).toBe("inconsistent");
    expect(timeline.integrity.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "TIMELINE_TRANSITION_DISCONTINUITY",
          sequence: 12,
        }),
        expect.objectContaining({
          code: "TIMELINE_TRANSITION_FORBIDDEN",
          sequence: 12,
        }),
      ]),
    );
  });

  it("marks a durable status that disagrees with lifecycle evidence inconsistent", () => {
    const timeline = projectRunTimeline({
      run: run("blocked"),
      events: events(),
    });

    expect(timeline.integrity.status).toBe("inconsistent");
    expect(timeline.integrity.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "TIMELINE_STATUS_MISMATCH" }),
      ]),
    );
  });

  it("keeps blocker metadata out of lifecycle transition validation", () => {
    const timeline = projectRunTimeline({
      run: run("blocked"),
      events: [
        ...events().slice(0, 3),
        {
          sequence: 13,
          occurredAt: "2026-09-09T12:00:03.000Z",
          type: "run.blocked",
          data: { from: "running", to: "blocked" },
        },
        {
          sequence: 14,
          occurredAt: "2026-09-09T12:00:04.000Z",
          type: "delivery.blocked",
          data: {
            from: "REMOTE_CHECKS_FAILED",
            to: "REMOTE_REVIEW_FINDINGS",
          },
        },
      ],
    });

    expect(timeline.integrity).toEqual({ status: "consistent", reasons: [] });
    expect(timeline.events.at(-1)).toEqual({
      sequence: 14,
      occurredAt: "2026-09-09T12:00:04.000Z",
      type: "delivery.blocked",
    });
  });

  it("rejects malformed boundaries and missing lifecycle transitions", () => {
    const malformed = events();
    malformed[1] = {
      sequence: 11,
      occurredAt: "2026-09-09T12:00:01.000Z",
      type: "run.ready",
      data: { from: "aproved", to: "redy" },
    };
    const missing = events();
    missing[2] = {
      sequence: 12,
      occurredAt: "2026-09-09T12:00:02.000Z",
      type: "builder.started",
      data: {},
    };

    for (const evidence of [malformed, missing]) {
      const timeline = projectRunTimeline({
        run: run("reviewed"),
        events: evidence,
      });
      expect(timeline.integrity.status).toBe("inconsistent");
      expect(timeline.integrity.reasons).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "TIMELINE_TRANSITION_INVALID" }),
        ]),
      );
    }
  });

  it("accepts metadata-only delivery observations before their transitions", () => {
    const timeline = projectRunTimeline({
      run: run("awaiting_human"),
      events: [
        ...events(),
        {
          sequence: 16,
          occurredAt: "2026-09-09T12:00:06.000Z",
          type: "delivery.awaiting_approval",
          data: { from: "reviewed", to: "proposing" },
        },
        {
          sequence: 17,
          occurredAt: "2026-09-09T12:00:07.000Z",
          type: "delivery.effect_reconciled",
          data: { from: "proposing", to: "awaiting_ci" },
        },
        {
          sequence: 18,
          occurredAt: "2026-09-09T12:00:08.000Z",
          type: "delivery.awaiting_human",
          data: {},
        },
        {
          sequence: 19,
          occurredAt: "2026-09-09T12:00:09.000Z",
          type: "delivery.awaiting_human",
          data: { from: "awaiting_ci", to: "awaiting_human" },
        },
      ],
    });

    expect(timeline.integrity).toEqual({ status: "consistent", reasons: [] });
  });

  it("accepts guarded refresh and reconciliation transitions", () => {
    const timeline = projectRunTimeline({
      run: run("proposing"),
      events: [
        ...events(),
        {
          sequence: 16,
          occurredAt: "2026-09-09T12:00:06.000Z",
          type: "review.refresh_prepared",
          data: { from: "reviewed", to: "verified" },
        },
        {
          sequence: 17,
          occurredAt: "2026-09-09T12:00:07.000Z",
          type: "review.passed",
          data: { from: "verified", to: "reviewed" },
        },
        {
          sequence: 18,
          occurredAt: "2026-09-09T12:00:08.000Z",
          type: "delivery.planned",
          data: { from: "reviewed", to: "proposing" },
        },
        {
          sequence: 19,
          occurredAt: "2026-09-09T12:00:09.000Z",
          type: "delivery.effect_reconciled",
          data: { from: "proposing", to: "proposing" },
        },
      ],
    });

    expect(timeline.integrity).toEqual({ status: "consistent", reasons: [] });
  });

  it("marks malformed or missing creation evidence inconsistent without returning it", () => {
    const timeline = projectRunTimeline({
      run: run("approved"),
      events: [
        {
          sequence: 1,
          occurredAt: "2026-09-09 12:00:00Z",
          type: "run.created",
          data: { status: "approved" },
        },
      ],
    });

    expect(timeline.events).toEqual([]);
    expect(timeline.integrity.status).toBe("inconsistent");
    expect(timeline.integrity.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "TIMELINE_EVENT_INVALID" }),
        expect.objectContaining({ code: "TIMELINE_CREATION_MISSING" }),
        expect.objectContaining({ code: "TIMELINE_STATUS_MISMATCH" }),
      ]),
    );
  });

  it("does not treat a duplicate creation event as a generic transition", () => {
    const timeline = projectRunTimeline({
      run: run("ready"),
      events: [
        {
          sequence: 1,
          occurredAt: "2026-09-09T12:00:00.000Z",
          type: "run.created",
          data: { status: "approved" },
        },
        {
          sequence: 2,
          occurredAt: "2026-09-09T12:00:01.000Z",
          type: "run.created",
          data: { status: "invalid", from: "approved", to: "ready" },
        },
      ],
    });

    expect(timeline.integrity.status).toBe("inconsistent");
    expect(timeline.integrity.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "TIMELINE_CREATION_INVALID",
          sequence: 2,
        }),
        expect.objectContaining({ code: "TIMELINE_STATUS_MISMATCH" }),
      ]),
    );
    expect(timeline.events.at(-1)).toEqual({
      sequence: 2,
      occurredAt: "2026-09-09T12:00:01.000Z",
      type: "run.created",
    });
  });

  it("marks invalid journal data inconsistent without exposing it", () => {
    const timeline = projectRunTimeline({
      run: run("approved"),
      events: [
        {
          sequence: 1,
          occurredAt: "2026-09-09T12:00:00.000Z",
          type: "run.created",
          data: { status: "approved" },
        },
        {
          sequence: 2,
          occurredAt: "2026-09-09T12:00:01.000Z",
          type: "worker.admitted",
          journalDataInvalid: true,
        },
      ],
    });

    expect(timeline.integrity.status).toBe("inconsistent");
    expect(timeline.integrity.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "TIMELINE_EVENT_DATA_INVALID",
          sequence: 2,
        }),
      ]),
    );
    expect(JSON.stringify(timeline)).not.toContain("journalDataInvalid");
  });
});
