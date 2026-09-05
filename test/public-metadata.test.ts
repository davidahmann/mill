import { describe, expect, it } from "vitest";

import { publicPullRequestTitle } from "../src/runtime/public-metadata.js";
import { publicRunRecord, type RunRecord } from "../src/runtime/state.js";
import { summarizeUsage } from "../src/runtime/usage.js";

describe("public delivery metadata", () => {
  it("reports measured and partial usage without inventing missing spend", () => {
    expect(summarizeUsage([])).toMatchObject({
      source: "unavailable",
      inputTokens: null,
      cost: "unavailable",
    });
    const completed = {
      type: "builder.completed",
      data: { usageSource: "measured", inputTokens: 100, outputTokens: 7 },
    };
    expect(summarizeUsage([completed])).toMatchObject({
      source: "measured",
      inputTokens: 100,
      outputTokens: 7,
      completedCalls: 1,
    });
    expect(
      summarizeUsage([
        completed,
        { type: "review.completed", data: null },
        { type: "validation.failed" },
      ]),
    ).toMatchObject({ source: "partial", measuredCalls: 1, blockEvents: 1 });
    expect(
      summarizeUsage([
        {
          type: "builder.completed",
          data: { usageSource: "measured", inputTokens: -1, outputTokens: 0 },
        },
      ]).source,
    ).toBe("unavailable");
  });
  it("does not copy multiline or folded commit trailers into PR titles", () => {
    for (const separator of ["\n\n", "\r\n", " "]) {
      expect(
        publicPullRequestTitle(
          `fix: preserve privacy${separator}Signed-off-by: Test <private@example.com>`,
        ),
      ).toBe("fix: preserve privacy");
    }
    expect(
      publicPullRequestTitle("fix: contact private@example.com\nbody"),
    ).toBe("fix: contact [email redacted]");
    expect(publicPullRequestTitle("x".repeat(300))).toHaveLength(240);
    expect(() =>
      publicPullRequestTitle("Signed-off-by: Test <private@example.com>"),
    ).toThrow();
  });

  it("omits nested raw evidence from routine run records without changing storage", () => {
    const run = {
      id: "run",
      validationJson: "private command evidence",
      reviewJson: "private reviewer text",
      remoteFeedbackJson: "private feedback",
      worktreePath: "/private/worktree",
    } as RunRecord;
    expect(publicRunRecord(run)).toEqual({ id: "run" });
    expect(run.reviewJson).toBe("private reviewer text");
  });
});
