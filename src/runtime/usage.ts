import type { ContinuationUsage, PhaseUsage } from "./continuation.js";

type UsagePhase = "build" | "repair" | "review";

interface UsageRecord {
  phase: UsagePhase;
  outcome: "completed" | "failed";
  usageSource: unknown;
  inputTokens: unknown;
  outputTokens: unknown;
  cacheInputTokens: unknown;
}

function eventData(event: Record<string, unknown>): Record<string, unknown> {
  return typeof event.data === "object" &&
    event.data !== null &&
    !Array.isArray(event.data)
    ? (event.data as Record<string, unknown>)
    : {};
}

function usageRecords(
  events: readonly Record<string, unknown>[],
): UsageRecord[] {
  const explicit = events
    .filter((event) => event.type === "provider.usage_recorded")
    .map(eventData)
    .filter(
      (
        data,
      ): data is Record<string, unknown> & {
        phase: UsagePhase;
        outcome: "completed" | "failed";
      } =>
        ["build", "repair", "review"].includes(String(data.phase)) &&
        ["completed", "failed"].includes(String(data.outcome)),
    )
    .map((data) => ({
      phase: data.phase,
      outcome: data.outcome,
      usageSource: data.usageSource,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      cacheInputTokens: data.cacheInputTokens,
    }));
  if (explicit.length > 0) return explicit;

  const legacyPhase: Record<string, UsagePhase> = {
    "builder.completed": "build",
    "builder.resume_completed": "build",
    "repair.builder_completed": "repair",
    "review.completed": "review",
  };
  return events.flatMap((event) => {
    const phase = legacyPhase[String(event.type)];
    if (phase === undefined) return [];
    const data = eventData(event);
    return [
      {
        phase,
        outcome: "completed" as const,
        usageSource: data.usageSource,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        cacheInputTokens: data.cacheInputTokens,
      },
    ];
  });
}

function measured(record: UsageRecord): boolean {
  return (
    record.usageSource === "measured" &&
    Number.isSafeInteger(record.inputTokens) &&
    (record.inputTokens as number) >= 0 &&
    Number.isSafeInteger(record.outputTokens) &&
    (record.outputTokens as number) >= 0
  );
}

function phaseUsage(records: readonly UsageRecord[]): PhaseUsage {
  const complete = records.filter(measured);
  return {
    calls: records.length,
    completedCalls: records.filter((record) => record.outcome === "completed")
      .length,
    failedCalls: records.filter((record) => record.outcome === "failed").length,
    measuredCalls: complete.length,
    inputTokens:
      complete.length === 0
        ? null
        : complete.reduce(
            (total, record) => total + (record.inputTokens as number),
            0,
          ),
    outputTokens:
      complete.length === 0
        ? null
        : complete.reduce(
            (total, record) => total + (record.outputTokens as number),
            0,
          ),
  };
}

/** Aggregate recorded provider measurements, never estimates or duplicated settlements. */
export function summarizeUsage(
  events: readonly Record<string, unknown>[],
): ContinuationUsage {
  const records = usageRecords(events);
  const admittedCalls = events.filter(
    (event) => event.type === "worker.admitted",
  ).length;
  const complete = records.filter(measured);
  const cacheComplete = records.filter(
    (record) =>
      record.usageSource === "measured" &&
      Number.isSafeInteger(record.cacheInputTokens) &&
      (record.cacheInputTokens as number) >= 0,
  );
  const completeCoverage =
    complete.length === records.length && admittedCalls <= records.length;
  const cacheCoverage =
    cacheComplete.length === records.length && admittedCalls <= records.length;
  return {
    source:
      complete.length === 0
        ? "unavailable"
        : completeCoverage
          ? "measured"
          : "partial",
    admittedCalls,
    completedCalls: records.filter((record) => record.outcome === "completed")
      .length,
    measuredCalls: complete.length,
    inputTokens:
      complete.length === 0
        ? null
        : complete.reduce(
            (total, record) => total + (record.inputTokens as number),
            0,
          ),
    outputTokens:
      complete.length === 0
        ? null
        : complete.reduce(
            (total, record) => total + (record.outputTokens as number),
            0,
          ),
    cacheSource:
      cacheComplete.length === 0
        ? "unavailable"
        : cacheCoverage
          ? "measured"
          : "partial",
    cacheInputTokens:
      cacheComplete.length === 0
        ? null
        : cacheComplete.reduce(
            (total, record) => total + (record.cacheInputTokens as number),
            0,
          ),
    cost: "unavailable",
    blockEvents: events.filter(
      (event) =>
        String(event.type).endsWith("blocked") ||
        event.type === "validation.failed",
    ).length,
    phases: {
      build: phaseUsage(records.filter((record) => record.phase === "build")),
      repair: phaseUsage(records.filter((record) => record.phase === "repair")),
      review: phaseUsage(records.filter((record) => record.phase === "review")),
    },
  };
}
