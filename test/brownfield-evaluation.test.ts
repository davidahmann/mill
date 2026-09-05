import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  continuationPacket,
  type ContinuationUsage,
} from "../src/runtime/continuation.js";
import type { PublicRunRecord, RunStatus } from "../src/runtime/state.js";

interface EvaluationCase {
  id: string;
  condition: string;
  status: RunStatus;
  interrupted: boolean;
  reconciliationRequired: boolean;
  expectedAction: string;
}

interface EvaluationPack {
  schemaVersion: "1";
  kind: "deterministic_harness_evaluation";
  cases: readonly EvaluationCase[];
}

const digest = `sha256:${"c".repeat(64)}`;
const run: PublicRunRecord = {
  id: "brownfield-evaluation",
  repositoryId: "11111111-1111-4111-8111-111111111111",
  taskId: "evaluation",
  taskDigest: digest,
  configDigest: digest,
  status: "blocked",
  baseCommit: "d".repeat(40),
  deadlineAt: "2026-09-05T00:01:00.000Z",
  cancelRequested: false,
  repairCount: 0,
  attemptCount: 1,
  createdAt: "2026-09-05T00:00:00.000Z",
  updatedAt: "2026-09-05T00:00:00.000Z",
};
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

describe("deterministic brownfield harness evaluation", () => {
  it("preserves evidence-first routing for representative inherited-repository failures", async () => {
    const raw = await readFile(
      path.join(
        import.meta.dirname,
        "fixtures",
        "brownfield-evaluation",
        "pack.json",
      ),
      "utf8",
    );
    const pack = JSON.parse(raw) as EvaluationPack;
    expect(pack).toMatchObject({
      schemaVersion: "1",
      kind: "deterministic_harness_evaluation",
    });
    expect(pack.cases.length).toBeGreaterThanOrEqual(5);
    for (const testCase of pack.cases) {
      const packet = continuationPacket({
        run: { ...run, status: testCase.status },
        usage,
        ...(testCase.interrupted ? { interrupted: true } : {}),
        ...(testCase.reconciliationRequired
          ? { reconciliationRequired: true }
          : {}),
      });
      expect(packet.next.action, testCase.condition).toBe(
        testCase.expectedAction,
      );
    }
  });
});
