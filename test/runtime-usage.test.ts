import { describe, expect, it } from "vitest";

import { summarizeUsage } from "../src/runtime/usage.js";

describe("provider usage summaries", () => {
  it("separates phases and retains measured failed calls", () => {
    const usage = summarizeUsage([
      { type: "worker.admitted", data: { phase: "build" } },
      {
        type: "provider.usage_recorded",
        data: {
          phase: "build",
          outcome: "completed",
          usageSource: "measured",
          inputTokens: 10,
          outputTokens: 5,
          cacheInputTokens: 3,
        },
      },
      { type: "worker.admitted", data: { phase: "review" } },
      {
        type: "provider.usage_recorded",
        data: {
          phase: "review",
          outcome: "failed",
          usageSource: "measured",
          inputTokens: 7,
          outputTokens: 2,
          cacheInputTokens: null,
        },
      },
    ]);
    expect(usage).toMatchObject({
      source: "measured",
      admittedCalls: 2,
      completedCalls: 1,
      measuredCalls: 2,
      inputTokens: 17,
      outputTokens: 7,
      phases: {
        build: { calls: 1, completedCalls: 1, failedCalls: 0 },
        review: { calls: 1, completedCalls: 0, failedCalls: 1 },
      },
    });
  });
});
