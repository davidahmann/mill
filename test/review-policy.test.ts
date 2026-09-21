import { describe, expect, it } from "vitest";
import {
  reviewResultSchema,
  millConfigSchema,
} from "../src/contracts/schemas.js";
import {
  blockingReviewFindings,
  classifyReview,
  blocksReview,
} from "../src/runtime/review-policy.js";
const digest = "sha256:" + "a".repeat(64);
const review = (severity: "P0" | "P1" | "P2" | "P3") =>
  reviewResultSchema.parse({
    schemaVersion: "1",
    candidateCommit: "a".repeat(40),
    summary: "review",
    findings: [
      {
        id: "R1",
        severity,
        class: "correctness",
        title: "Finding",
        body: "Evidence",
        file: null,
        line: null,
      },
    ],
  });
describe("frozen review policy", () => {
  it.each(["P0", "P1", "P2", "P3"] as const)(
    "retains legacy blocking for %s",
    (severity) => {
      const legacy = review(severity);
      expect(classifyReview(legacy, digest, undefined)).toEqual(legacy);
      expect(blockingReviewFindings(legacy, digest)).toHaveLength(1);
    },
  );
  it.each(["P0", "P1", "P2", "P3"] as const)(
    "classifies %s without discarding findings",
    (severity) => {
      const source = review(severity);
      const result = classifyReview(source, digest, "p0_p1");
      expect(result.findings).toEqual(source.findings);
      expect(
        blockingReviewFindings(result, digest, { policy: "p0_p1" }),
      ).toHaveLength(severity === "P0" || severity === "P1" ? 1 : 0);
    },
  );
  it("rejects policy substitution, incomplete partitions, duplicate IDs and drift", () => {
    const source = review("P1");
    const result = classifyReview(source, digest, "p0_p1");
    expect(() => classifyReview(result, digest, "p0_p1")).toThrow();
    expect(() =>
      blockingReviewFindings(result, "sha256:" + "b".repeat(64)),
    ).toThrow();
    expect(() =>
      blockingReviewFindings(result, digest, { policy: undefined }),
    ).toThrow();
    expect(() =>
      blockingReviewFindings(source, digest, { policy: "p0_p1" }),
    ).toThrow();
    if (result.gate === undefined || source.findings[0] === undefined)
      throw new Error("missing fixture");
    result.gate.blockingFindingIds = [];
    result.gate.advisoryFindingIds = ["R1"];
    expect(() => blockingReviewFindings(result, digest)).toThrow();
    source.findings.push(source.findings[0]);
    expect(() => classifyReview(source, digest, "p0_p1")).toThrow();
  });
  it("does not admit unknown severity or policy", () => {
    expect(blocksReview("unclassified", "p0_p1")).toBe(true);
    expect(
      reviewResultSchema.safeParse({
        ...review("P1"),
        findings: [{ ...review("P1").findings[0], severity: "unknown" }],
      }).success,
    ).toBe(false);
    expect(
      millConfigSchema.safeParse({ review: { blocking: "none" } }).success,
    ).toBe(false);
  });
});
