import { describe, expect, it } from "vitest";

import { evaluatePromotionReadiness } from "../scripts/promotion-readiness.mjs";

const candidate = "a".repeat(40);

describe("promotion readiness", () => {
  it("accepts exact passing local evidence", () => {
    expect(
      evaluatePromotionReadiness({
        candidateCommit: candidate,
        validation: { passed: true, candidateCommit: candidate },
        review: {
          candidateCommit: candidate,
          scopeDigest: "sha256:scope",
          blockingFindingIds: [],
        },
        expectedScopeDigest: "sha256:scope",
      }),
    ).toEqual({ ready: true, candidateCommit: candidate, reasonCodes: [] });
  });

  it("returns stable reasons for stale or blocking evidence", () => {
    expect(
      evaluatePromotionReadiness({
        candidateCommit: candidate,
        validation: { passed: false, candidateCommit: "b".repeat(40) },
        review: {
          candidateCommit: "c".repeat(40),
          scopeDigest: "sha256:old",
          blockingFindingIds: ["F1"],
        },
        expectedScopeDigest: "sha256:new",
      }).reasonCodes,
    ).toEqual([
      "VALIDATION_FAILED",
      "VALIDATION_CANDIDATE_MISMATCH",
      "REVIEW_CANDIDATE_MISMATCH",
      "REVIEW_SCOPE_MISMATCH",
      "BLOCKING_REVIEW_FINDINGS",
    ]);
  });
});
