import { describe, expect, it } from "vitest";
import { eligibleVerificationFailure } from "../src/runtime/verification-recovery.js";
import type { RunRecord } from "../src/runtime/state.js";

const run: RunRecord = {
  id: "run",
  repositoryId: "repo",
  taskId: "task",
  taskDigest: "task",
  configDigest: "config",
  status: "blocked",
  baseCommit: "base",
  candidateCommit: "candidate",
  candidateTree: "tree",
  deadlineAt: "2020-01-01T00:00:00.000Z",
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
  cancelRequested: false,
  attemptCount: 1,
  repairCount: 0,
  blockCode: "VERIFIER_IMAGE_UNAVAILABLE",
};
const history = [
  {
    sequence: 1,
    type: "candidate.committed",
    data: { commit: "candidate", tree: "tree" },
  },
  { sequence: 2, type: "builder.completed", data: {} },
  {
    sequence: 3,
    type: "run.blocked",
    data: {
      from: "committed",
      to: "blocked",
      code: "VERIFIER_IMAGE_UNAVAILABLE",
    },
  },
];
describe("verification recovery eligibility", () => {
  it("requires the adjacent infrastructure failure, permitting only its known old rejection overwrite", () => {
    expect(eligibleVerificationFailure(run, history)).toBe(3);
    expect(
      eligibleVerificationFailure({ ...run, blockCode: "RUN_NOT_COMMITTED" }, [
        ...history,
        {
          sequence: 4,
          type: "run.blocker_replaced",
          data: { from: "VERIFIER_IMAGE_UNAVAILABLE", to: "RUN_NOT_COMMITTED" },
        },
      ]),
    ).toBe(3);
    expect(() =>
      eligibleVerificationFailure(
        { ...run, blockCode: "RUN_NOT_COMMITTED" },
        history,
      ),
    ).toThrow();
  });
  it.each([
    { status: "cancelled" },
    { cancelRequested: true },
    { validationJson: "{}" },
    { reviewJson: "{}" },
    { deliveryJson: "{}" },
    { remoteFeedbackJson: "{}" },
    { activeProcessId: "worker" },
    { candidateCommit: undefined },
  ] as Partial<RunRecord>[])(
    "rejects non-recoverable run state %j",
    (patch) => {
      expect(() =>
        eligibleVerificationFailure({ ...run, ...patch }, history),
      ).toThrow();
    },
  );
  it.each([
    "validation.failed",
    "validation.passed",
    "repair.started",
    "review.started",
    "worker.launch_started",
    "delivery.effect_intent",
    "verification.recovery_applied",
  ])(
    "does not reach back through %s to an earlier infrastructure failure",
    (type) => {
      expect(() =>
        eligibleVerificationFailure(run, [
          ...history,
          { sequence: 4, type, data: {} },
        ]),
      ).toThrow();
    },
  );
  it("rejects an unrelated or malformed failure chain", () => {
    expect(() =>
      eligibleVerificationFailure(
        { ...run, candidateCommit: "different" },
        history,
      ),
    ).toThrow();
    expect(() =>
      eligibleVerificationFailure(run, [
        ...history,
        {
          sequence: 4,
          type: "run.blocker_replaced",
          data: { from: "OTHER", to: "RUN_NOT_COMMITTED" },
        },
      ]),
    ).toThrow();
    expect(() =>
      eligibleVerificationFailure(
        run,
        history.map((event) =>
          event.sequence === 3
            ? {
                ...event,
                data: {
                  from: "committed",
                  to: "blocked",
                  code: "VALIDATION_FAILED",
                },
              }
            : event,
        ),
      ),
    ).toThrow();
    expect(() => eligibleVerificationFailure(run, [])).toThrow();
  });
});
