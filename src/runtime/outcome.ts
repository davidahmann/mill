import type { z } from "zod";

import {
  deliveryRecordSchema,
  reviewResultSchema,
  runOutcomeSchema,
  validationEvidenceSchema,
} from "../contracts/schemas.js";
import type { ContinuationUsage } from "./continuation.js";
import type { PublicRunRecord, RunRecord } from "./state.js";
import type { RunTimeline } from "./timeline.js";

export type RunOutcome = z.infer<typeof runOutcomeSchema>;

function reason(
  code: string,
  message: string,
): RunOutcome["integrity"]["reasons"][number] {
  return { code, message };
}

function sameCandidate(
  run: PublicRunRecord,
  candidateCommit: string,
  candidateTree?: string,
): boolean {
  return (
    run.candidateCommit === candidateCommit &&
    (candidateTree === undefined || run.candidateTree === candidateTree)
  );
}

function validationSummary(
  value: z.infer<typeof validationEvidenceSchema>,
): RunOutcome["validation"]["commands"] {
  return {
    passed: value.commands.filter((command) => command.status === "passed")
      .length,
    failed: value.commands.filter((command) => command.status === "failed")
      .length,
    blocked: value.commands.filter((command) => command.status === "blocked")
      .length,
  };
}

function compactAdaptation(
  value: z.infer<typeof validationEvidenceSchema>,
): RunOutcome["validation"]["adaptation"] {
  const adaptation = value.adaptation;
  if (adaptation === undefined) return null;
  return {
    manifestDigest: adaptation.manifestDigest,
    observedAt: adaptation.observedAt,
    assurance: adaptation.assurance,
    ownerAcceptance: adaptation.ownerAcceptance,
    provider: {
      id: adaptation.provider.id,
      from: adaptation.provider.from,
      to: adaptation.provider.to,
    },
    configurations: adaptation.configurations.map((configuration) => ({
      id: configuration.id,
      revision: configuration.revision,
    })),
    fixtures: adaptation.fixtures,
    matrix: adaptation.matrix.map((cell) => ({
      workflowId: cell.workflowId,
      configurationId: cell.configurationId,
      status: cell.status,
      commandId: cell.commandId ?? null,
      scenarioId: cell.scenarioId ?? null,
    })),
  };
}

function parseStored<T>(
  json: string | undefined,
  schema: z.ZodType<T>,
): { value: T | undefined; invalid: boolean } {
  if (json === undefined) return { value: undefined, invalid: false };
  try {
    return { value: schema.parse(JSON.parse(json)), invalid: false };
  } catch {
    return { value: undefined, invalid: true };
  }
}

/**
 * Projects one run's stored evidence without returning payloads, paths or prose.
 * Consistency describes record integrity only; it never certifies acceptance.
 */
export function projectRunOutcome(input: {
  run: RunRecord;
  timeline: RunTimeline;
  usage: ContinuationUsage;
}): RunOutcome {
  const run: PublicRunRecord = input.run;
  const reasons: RunOutcome["integrity"]["reasons"] = [];
  if (input.timeline.integrity.status !== "consistent") {
    reasons.push(
      reason(
        "OUTCOME_TIMELINE_INCONSISTENT",
        "The run lifecycle timeline is not internally consistent.",
      ),
    );
  }

  const validationStored = parseStored(
    input.run.validationJson,
    validationEvidenceSchema,
  );
  let validation: RunOutcome["validation"] = {
    status: "not_recorded",
    candidateCommit: null,
    commands: { passed: 0, failed: 0, blocked: 0 },
    adaptation: null,
  };
  if (validationStored.invalid) {
    reasons.push(
      reason(
        "OUTCOME_VALIDATION_INVALID",
        "Stored validation evidence cannot be parsed against its contract.",
      ),
    );
    validation = { ...validation, status: "inconsistent" };
  } else if (validationStored.value !== undefined) {
    const evidence = validationStored.value;
    const candidateMatches = sameCandidate(run, evidence.candidateCommit);
    if (!candidateMatches) {
      reasons.push(
        reason(
          "OUTCOME_VALIDATION_CANDIDATE_MISMATCH",
          "Stored validation evidence is bound to a different candidate.",
        ),
      );
    }
    const adaptation = compactAdaptation(evidence);
    if (
      adaptation !== null &&
      Date.parse(adaptation.fixtures.expiresAt) <=
        Date.parse(adaptation.observedAt)
    ) {
      reasons.push(
        reason(
          "OUTCOME_ADAPTATION_FIXTURE_STALE",
          "Adaptation fixture evidence expired before the recorded run state.",
        ),
      );
    }
    validation = {
      status: !candidateMatches
        ? "inconsistent"
        : evidence.passed
          ? "passed"
          : evidence.commands.some((command) => command.status === "blocked")
            ? "blocked"
            : "failed",
      candidateCommit: evidence.candidateCommit,
      commands: validationSummary(evidence),
      adaptation,
    };
  }

  const reviewStored = parseStored(input.run.reviewJson, reviewResultSchema);
  let review: RunOutcome["review"] = {
    status: "not_recorded",
    candidateCommit: null,
    findingCounts: { P0: 0, P1: 0, P2: 0, P3: 0 },
  };
  if (reviewStored.invalid) {
    reasons.push(
      reason(
        "OUTCOME_REVIEW_INVALID",
        "Stored review evidence cannot be parsed against its contract.",
      ),
    );
    review = { ...review, status: "inconsistent" };
  } else if (reviewStored.value !== undefined) {
    const evidence = reviewStored.value;
    const candidateMatches = sameCandidate(
      run,
      evidence.candidateCommit,
      evidence.scope?.candidateTree,
    );
    if (!candidateMatches) {
      reasons.push(
        reason(
          "OUTCOME_REVIEW_CANDIDATE_MISMATCH",
          "Stored review evidence is bound to a different candidate.",
        ),
      );
    }
    const findingCounts = { P0: 0, P1: 0, P2: 0, P3: 0 };
    for (const finding of evidence.findings) findingCounts[finding.severity]++;
    review = {
      status: !candidateMatches
        ? "inconsistent"
        : evidence.findings.length === 0
          ? "clean"
          : "findings",
      candidateCommit: evidence.candidateCommit,
      findingCounts,
    };
  }

  const deliveryStored = parseStored(
    input.run.deliveryJson,
    deliveryRecordSchema,
  );
  let delivery: RunOutcome["delivery"] = {
    status: "not_recorded",
    candidateCommit: null,
  };
  if (deliveryStored.invalid) {
    reasons.push(
      reason(
        "OUTCOME_DELIVERY_INVALID",
        "Stored delivery evidence cannot be parsed against its contract.",
      ),
    );
    delivery = { ...delivery, status: "inconsistent" };
  } else if (deliveryStored.value !== undefined) {
    const evidence = deliveryStored.value;
    const matches =
      evidence.runId === run.id &&
      sameCandidate(run, evidence.candidateCommit, evidence.candidateTree);
    if (!matches) {
      reasons.push(
        reason(
          "OUTCOME_DELIVERY_CANDIDATE_MISMATCH",
          "Stored delivery evidence is bound to a different run or candidate.",
        ),
      );
    }
    delivery = {
      status: matches ? evidence.state : "inconsistent",
      candidateCommit: evidence.candidateCommit,
    };
  }

  return runOutcomeSchema.parse({
    schemaVersion: "1",
    run: {
      id: run.id,
      taskId: run.taskId,
      taskDigest: run.taskDigest,
      configDigest: run.configDigest,
      status: run.status,
      baseCommit: run.baseCommit,
      candidateCommit: run.candidateCommit ?? null,
      candidateTree: run.candidateTree ?? null,
      repairCount: run.repairCount,
      attemptCount: run.attemptCount,
    },
    lifecycle: {
      timeline: input.timeline.integrity.status,
      eventCount: input.timeline.events.length,
    },
    validation,
    review,
    delivery,
    ownerAcceptance: "not_recorded",
    usage: input.usage,
    integrity: {
      status: reasons.length === 0 ? "consistent" : "inconsistent",
      reasons,
    },
  });
}
