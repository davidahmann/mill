import { describe, expect, it } from "vitest";

import {
  continuationPacket,
  type ContinuationUsage,
} from "../src/runtime/continuation.js";
import type { PublicRunRecord, RunStatus } from "../src/runtime/state.js";

const digest = `sha256:${"a".repeat(64)}`;
const commit = "b".repeat(40);
const usage: ContinuationUsage = {
  source: "unavailable",
  admittedCalls: 0,
  completedCalls: 0,
  measuredCalls: 0,
  inputTokens: null,
  outputTokens: null,
  cacheInputTokens: null,
  cacheSource: "unavailable",
  cost: "unavailable",
  blockEvents: 0,
};
const statuses: readonly RunStatus[] = [
  "approved",
  "ready",
  "running",
  "committed",
  "verified",
  "reviewed",
  "proposing",
  "effect_unknown",
  "awaiting_ci",
  "awaiting_human",
  "merged",
  "post_merge_verified",
  "closed",
  "blocked",
  "cancelled",
  "failed",
  "stale",
];
const candidateStatuses = new Set<RunStatus>([
  "committed",
  "verified",
  "reviewed",
  "proposing",
  "effect_unknown",
  "awaiting_ci",
  "awaiting_human",
  "merged",
  "post_merge_verified",
]);

function run(status: RunStatus, active = false): PublicRunRecord {
  return {
    id: "run-1",
    repositoryId: "11111111-1111-4111-8111-111111111111",
    taskId: "task-1",
    taskDigest: digest,
    configDigest: digest,
    status,
    baseCommit: commit,
    ...(candidateStatuses.has(status) ? { candidateCommit: commit } : {}),
    deadlineAt: "2026-09-05T00:01:00.000Z",
    ...(active ? { activePid: 1234 } : {}),
    cancelRequested: false,
    repairCount: 0,
    attemptCount: 1,
    createdAt: "2026-09-05T00:00:00.000Z",
    updatedAt: "2026-09-05T00:00:00.000Z",
  };
}

describe("read-only continuation packets", () => {
  it("routes each lifecycle checkpoint to its one attended next action", () => {
    const expected: Record<RunStatus, string> = {
      approved: "attended_disposition",
      ready: "attended_disposition",
      running: "resume",
      committed: "verify",
      verified: "review",
      reviewed: "plan_draft_pr",
      proposing: "open_draft_pr",
      effect_unknown: "reconcile",
      awaiting_ci: "observe_draft_pr",
      awaiting_human: "plan_merge",
      merged: "finalize_merge",
      post_merge_verified: "finalize_merge",
      closed: "none",
      blocked: "attended_disposition",
      cancelled: "none",
      failed: "none",
      stale: "none",
    };
    for (const status of statuses) {
      expect(continuationPacket({ run: run(status), usage }).next.action).toBe(
        expected[status],
      );
    }
  });

  it("generated recovery combinations always choose reconciliation before mutation", () => {
    const generatedBlockCodes = [
      undefined,
      "VALIDATION_FAILED",
      "WORKER_INVOCATION_RECONCILIATION_REQUIRED",
      "GITHUB_RECONCILIATION_REQUIRED",
    ];
    for (const status of statuses) {
      for (const interrupted of [false, true]) {
        for (const reconciliationRequired of [false, true]) {
          for (const active of [false, true]) {
            for (const blockCode of generatedBlockCodes) {
              const packet = continuationPacket({
                run: {
                  ...run(status, active),
                  ...(blockCode ? { blockCode } : {}),
                },
                usage,
                ...(interrupted ? { interrupted } : {}),
                ...(reconciliationRequired ? { reconciliationRequired } : {}),
              });
              if (reconciliationRequired) {
                expect(packet.next.action).toBe("reconcile");
              } else if (status === "running" && active) {
                expect(packet.next.action).toBe(
                  interrupted ? "resume" : "wait",
                );
              }
              expect(packet.next.attended).toBe(true);
              expect(packet).not.toHaveProperty("worktreePath");
              expect(packet).not.toHaveProperty("deliveryJson");
            }
          }
        }
      }
    }
  });
});
