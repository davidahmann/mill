import type { ContinuationUsage } from "./continuation.js";

/** Aggregate recorded provider measurements, never estimates or duplicated settlements. */
export function summarizeUsage(
  events: readonly Record<string, unknown>[],
): ContinuationUsage {
  const completed = events.filter((event) =>
    [
      "builder.completed",
      "builder.resume_completed",
      "repair.builder_completed",
      "review.completed",
    ].includes(String(event.type)),
  );
  const admittedCalls = events.filter(
    (event) => event.type === "worker.admitted",
  ).length;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheInputTokens = 0;
  let measuredCalls = 0;
  let cacheMeasuredCalls = 0;
  for (const event of completed) {
    const data = event.data;
    if (typeof data !== "object" || data === null || Array.isArray(data))
      continue;
    const value = data as Record<string, unknown>;
    if (
      value.usageSource !== "measured" ||
      !Number.isSafeInteger(value.inputTokens) ||
      !Number.isSafeInteger(value.outputTokens) ||
      (value.inputTokens as number) < 0 ||
      (value.outputTokens as number) < 0
    )
      continue;
    measuredCalls++;
    inputTokens += value.inputTokens as number;
    outputTokens += value.outputTokens as number;
    if (
      Number.isSafeInteger(value.cacheInputTokens) &&
      (value.cacheInputTokens as number) >= 0
    ) {
      cacheMeasuredCalls++;
      cacheInputTokens += value.cacheInputTokens as number;
    }
  }
  return {
    source:
      measuredCalls === 0
        ? "unavailable"
        : measuredCalls === completed.length &&
            admittedCalls <= completed.length
          ? "measured"
          : "partial",
    admittedCalls,
    completedCalls: completed.length,
    measuredCalls,
    inputTokens: measuredCalls === 0 ? null : inputTokens,
    outputTokens: measuredCalls === 0 ? null : outputTokens,
    cacheSource:
      cacheMeasuredCalls === 0
        ? "unavailable"
        : cacheMeasuredCalls === completed.length &&
            admittedCalls <= completed.length
          ? "measured"
          : "partial",
    cacheInputTokens: cacheMeasuredCalls === 0 ? null : cacheInputTokens,
    cost: "unavailable",
    blockEvents: events.filter(
      (event) =>
        String(event.type).endsWith("blocked") ||
        event.type === "validation.failed",
    ).length,
  };
}
