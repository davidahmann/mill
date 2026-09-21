import type { z } from "zod";
import { reviewResultSchema } from "../contracts/schemas.js";
import { MillError, ExitCode } from "../errors.js";

type Review = z.infer<typeof reviewResultSchema>;
export type ReviewBlocking = "p0_p1" | undefined;

export function blocksReview(
  severity: string,
  policy: ReviewBlocking,
): boolean {
  return policy === undefined || (severity !== "P2" && severity !== "P3");
}

/** Only the controller can attach this classification to a provider report. */
export function classifyReview(
  review: Review,
  configDigest: string,
  policy: ReviewBlocking,
): Review {
  if (review.gate !== undefined) invalid();
  if (policy === undefined) return review;
  if (new Set(review.findings.map((f) => f.id)).size !== review.findings.length)
    invalid();
  return reviewResultSchema.parse({
    ...review,
    gate: {
      schemaVersion: "1",
      policy,
      configDigest,
      blockingFindingIds: review.findings
        .filter((f) => blocksReview(f.severity, policy))
        .map((f) => f.id),
      advisoryFindingIds: review.findings
        .filter((f) => !blocksReview(f.severity, policy))
        .map((f) => f.id),
    },
  });
}

function invalid(): never {
  throw new MillError(
    "REVIEW_POLICY_INVALID",
    "Review classification does not match its frozen policy and complete findings.",
    ExitCode.data,
  );
}

/** Receiptless reviews always retain their legacy all-findings blocking rule. */
export function blockingReviewFindings(
  review: Review,
  configDigest: string,
  expected?: { policy: ReviewBlocking },
): Review["findings"] {
  if (expected !== undefined && review.gate?.policy !== expected.policy)
    invalid();
  const gate = review.gate;
  if (gate === undefined) return review.findings;
  if (gate.configDigest !== configDigest) invalid();
  const classified = classifyReview(
    { ...review, gate: undefined },
    configDigest,
    gate.policy,
  ).gate;
  if (classified === undefined) invalid();
  if (
    JSON.stringify(gate.blockingFindingIds) !==
      JSON.stringify(classified.blockingFindingIds) ||
    JSON.stringify(gate.advisoryFindingIds) !==
      JSON.stringify(classified.advisoryFindingIds)
  )
    invalid();
  return review.findings.filter((f) => blocksReview(f.severity, gate.policy));
}
