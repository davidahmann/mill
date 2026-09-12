import type { z } from "zod";

import {
  deliveryRecordSchema,
  reviewResultSchema,
  runOutcomeSchema,
  validationEvidenceSchema,
} from "../contracts/schemas.js";
import type { ContinuationUsage } from "./continuation.js";
import { checkDecision } from "./delivery.js";
import { externalEffectBoundary } from "./effect-boundary.js";
import type { GitHubCheck } from "./github.js";
import type { PublicRunRecord, RunRecord, RunStatus } from "./state.js";
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

const validationRequiredStatuses = new Set<RunStatus>([
  "verified",
  "reviewed",
  "proposing",
  "effect_unknown",
  "awaiting_ci",
  "awaiting_human",
  "merged",
  "post_merge_verified",
  "closed",
]);

const reviewRequiredStatuses = new Set<RunStatus>([
  "reviewed",
  "proposing",
  "effect_unknown",
  "awaiting_ci",
  "awaiting_human",
  "merged",
  "post_merge_verified",
  "closed",
]);

const deliveryRequiredStatuses = new Set<RunStatus>([
  "proposing",
  "effect_unknown",
  "awaiting_ci",
  "awaiting_human",
  "merged",
  "post_merge_verified",
  "closed",
]);

function evidenceRequired(
  run: PublicRunRecord,
  timeline: RunTimeline,
  statuses: ReadonlySet<RunStatus>,
  resetTypes: ReadonlySet<string>,
  completionTypes: ReadonlySet<string>,
): boolean {
  if (statuses.has(run.status)) return true;
  let start = 0;
  for (const [index, event] of timeline.events.entries()) {
    if (resetTypes.has(event.type)) start = index + 1;
  }
  return timeline.events
    .slice(start)
    .some(
      (event) =>
        completionTypes.has(event.type) ||
        (event.transition !== undefined && statuses.has(event.transition.to)),
    );
}

function validationEvidenceRequired(
  run: PublicRunRecord,
  timeline: RunTimeline,
): boolean {
  return evidenceRequired(
    run,
    timeline,
    validationRequiredStatuses,
    new Set(["builder.started", "builder.resumed", "repair.started"]),
    new Set(["validation.failed"]),
  );
}

function validationSuccessRequired(
  run: PublicRunRecord,
  timeline: RunTimeline,
): boolean {
  return evidenceRequired(
    run,
    timeline,
    validationRequiredStatuses,
    new Set(["builder.started", "builder.resumed", "repair.started"]),
    new Set(),
  );
}

function reviewEvidenceRequired(
  run: PublicRunRecord,
  timeline: RunTimeline,
): boolean {
  return evidenceRequired(
    run,
    timeline,
    reviewRequiredStatuses,
    new Set([
      "builder.started",
      "builder.resumed",
      "repair.started",
      "review.refresh_prepared",
    ]),
    new Set(["review.blocked"]),
  );
}

function cleanReviewRequired(
  run: PublicRunRecord,
  timeline: RunTimeline,
): boolean {
  return evidenceRequired(
    run,
    timeline,
    reviewRequiredStatuses,
    new Set([
      "builder.started",
      "builder.resumed",
      "repair.started",
      "review.refresh_prepared",
    ]),
    new Set(),
  );
}

function deliveryEvidenceRequired(
  run: PublicRunRecord,
  timeline: RunTimeline,
): boolean {
  return evidenceRequired(
    run,
    timeline,
    deliveryRequiredStatuses,
    new Set([
      "builder.started",
      "builder.resumed",
      "repair.started",
      "review.refresh_prepared",
    ]),
    new Set(),
  );
}

function latestPhaseCompletion(
  timeline: RunTimeline,
  resetTypes: ReadonlySet<string>,
  completionTypes: ReadonlySet<string>,
): string | undefined {
  let start = 0;
  for (const [index, event] of timeline.events.entries()) {
    if (resetTypes.has(event.type)) start = index + 1;
  }
  return timeline.events
    .slice(start)
    .findLast((event) => completionTypes.has(event.type))?.type;
}

function commandEvidenceConsistent(
  commands: z.infer<typeof validationEvidenceSchema>["commands"],
): boolean {
  return commands.every(
    (command) => command.status !== "passed" || command.exitCode === 0,
  );
}

function adaptationEvidenceMatchesCommands(
  adaptation: z.infer<typeof validationEvidenceSchema>["adaptation"],
  commands: z.infer<typeof validationEvidenceSchema>["commands"],
): boolean {
  if (adaptation === undefined) return true;
  if (adaptation.workflows === undefined) return false;
  const workflowIds = new Set(adaptation.workflows);
  const configurationIds = new Set(
    adaptation.configurations.map((configuration) => configuration.id),
  );
  const pairs = new Set<string>();
  const commandIds = new Set<string>();
  if (
    workflowIds.size !== adaptation.workflows.length ||
    configurationIds.size !== adaptation.configurations.length
  )
    return false;
  return (
    adaptation.matrix.some((cell) => cell.status !== "excluded") &&
    adaptation.matrix.every((cell) => {
      if (
        !workflowIds.has(cell.workflowId) ||
        !configurationIds.has(cell.configurationId)
      )
        return false;
      const pair = JSON.stringify([cell.workflowId, cell.configurationId]);
      if (pairs.has(pair)) return false;
      pairs.add(pair);
      if (cell.status === "excluded") return true;
      if (
        cell.commandId === undefined ||
        cell.scenarioId === undefined ||
        cell.scenarioId.length === 0 ||
        cell.outputDigest === undefined
      )
        return false;
      if (commandIds.has(cell.commandId)) return false;
      commandIds.add(cell.commandId);
      const results = commands.filter(
        (command) => command.commandId === cell.commandId,
      );
      const result = results[0];
      if (result === undefined) return false;
      return (
        results.length === 1 &&
        result.required &&
        result.status === cell.status &&
        result.outputDigest === cell.outputDigest
      );
    }) &&
    pairs.size === workflowIds.size * configurationIds.size
  );
}

function adaptationFieldsAreProjectable(
  adaptation: z.infer<typeof validationEvidenceSchema>["adaptation"],
): boolean {
  return (
    adaptation === undefined ||
    adaptation.matrix.every(
      (cell) =>
        cell.workflowId.length > 0 &&
        cell.configurationId.length > 0 &&
        cell.commandId !== "" &&
        cell.scenarioId !== "" &&
        (cell.status === "excluded" || cell.scenarioId !== undefined),
    )
  );
}

function semanticEvidenceMatchesCommands(
  semantic: NonNullable<z.infer<typeof validationEvidenceSchema>["semantic"]>,
  commands: z.infer<typeof validationEvidenceSchema>["commands"],
): boolean {
  const commandsById = new Map<string, (typeof commands)[number]>();
  for (const command of commands) {
    if (commandsById.has(command.commandId)) return false;
    commandsById.set(command.commandId, command);
  }
  const itemsByKey = new Map<string, (typeof semantic.items)[number]>();
  for (const item of semantic.items) {
    const key = `${item.kind}\u0000${item.id}`;
    if (itemsByKey.has(key)) return false;
    itemsByKey.set(key, item);
  }
  const newBehavior = semantic.items.filter(
    (item) => item.coverage === "new_behavior" || item.coverage === "both",
  );
  const preservation = semantic.items.filter(
    (item) => item.coverage === "preservation" || item.coverage === "both",
  );
  const newBehaviorPassed =
    newBehavior.length > 0 &&
    newBehavior.every((item) => item.status !== "blocked");
  const preservationPassed =
    preservation.length === 0 ||
    preservation.every((item) => item.status !== "blocked");
  if (
    semantic.newBehaviorPassed !== newBehaviorPassed ||
    semantic.preservationPassed !== preservationPassed ||
    semantic.passed !== (newBehaviorPassed && preservationPassed)
  )
    return false;

  return semantic.items.every((item) => {
    const references = new Set(item.evidenceRefs);
    if (references.size !== item.evidenceRefs.length) return false;
    let hasPassingCommand = false;
    let hasAttestedAuthority = false;
    for (const reference of references) {
      if (reference.startsWith("command:")) {
        const command = commandsById.get(reference.slice("command:".length));
        if (command === undefined) return false;
        if (item.status !== "blocked") {
          if (command.status !== "passed" || command.exitCode !== 0)
            return false;
          hasPassingCommand = true;
        }
      } else if (reference.startsWith("acceptance:")) {
        const acceptance = itemsByKey.get(
          `acceptance\u0000${reference.slice("acceptance:".length)}`,
        );
        if (acceptance === undefined) return false;
        if (item.status !== "blocked" && acceptance.status === "blocked")
          return false;
      } else if (reference.startsWith("attestation:")) {
        const parts = reference.split(":");
        if (parts.length < 3 || parts.some((part) => part.length === 0))
          return false;
        hasAttestedAuthority = true;
      } else if (reference.startsWith("exception:")) {
        if (reference.slice("exception:".length).length === 0) return false;
        hasAttestedAuthority = true;
      } else {
        return false;
      }
    }
    return (
      item.status === "blocked" ||
      (item.status === "passed" && hasPassingCommand) ||
      (item.status === "attested" && hasAttestedAuthority)
    );
  });
}

function validationPassedByEvidence(
  evidence: z.infer<typeof validationEvidenceSchema>,
): boolean {
  const commandsPassed =
    evidence.commands.length > 0 &&
    evidence.commands
      .filter((command) => command.required)
      .every(
        (command) => command.status === "passed" && command.exitCode === 0,
      );
  const semanticPassed =
    evidence.semantic === undefined ||
    (evidence.semantic.passed &&
      semanticEvidenceMatchesCommands(evidence.semantic, evidence.commands));
  const adaptationPassed =
    evidence.adaptation === undefined
      ? true
      : evidence.adaptation.matrix.every(
          (cell) => cell.status === "passed" || cell.status === "excluded",
        ) &&
        adaptationEvidenceMatchesCommands(
          evidence.adaptation,
          evidence.commands,
        );
  return (
    commandEvidenceConsistent(evidence.commands) &&
    commandsPassed &&
    semanticPassed &&
    adaptationPassed
  );
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function recordedChecks(value: unknown): GitHubCheck[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const checks: GitHubCheck[] = [];
  for (const entry of value) {
    const check = record(entry);
    if (
      check === undefined ||
      typeof check.name !== "string" ||
      typeof check.status !== "string" ||
      (check.conclusion !== null && typeof check.conclusion !== "string") ||
      (check.appId !== undefined &&
        (typeof check.appId !== "number" || !Number.isInteger(check.appId))) ||
      (check.headSha !== undefined && typeof check.headSha !== "string") ||
      (check.workflowPath !== undefined &&
        typeof check.workflowPath !== "string") ||
      (check.event !== undefined && typeof check.event !== "string")
    )
      return undefined;
    checks.push({
      name: check.name,
      status: check.status,
      conclusion: check.conclusion,
      ...(check.appId === undefined ? {} : { appId: check.appId }),
      ...(check.headSha === undefined ? {} : { headSha: check.headSha }),
      ...(check.workflowPath === undefined
        ? {}
        : { workflowPath: check.workflowPath }),
      ...(check.event === undefined ? {} : { event: check.event }),
    });
  }
  return checks;
}

function recordedReviewsPass(
  value: unknown,
  delivery: z.infer<typeof deliveryRecordSchema>,
): boolean {
  if (delivery.reviewPolicy.mode === "local_only") return true;
  if (!Array.isArray(value)) return false;
  return delivery.reviewPolicy.requiredReviewerLogins.every((login) => {
    let latest: string | undefined;
    for (const entry of value) {
      const review = record(entry);
      if (
        review === undefined ||
        typeof review.actorLogin !== "string" ||
        typeof review.state !== "string" ||
        (review.commitId !== null && typeof review.commitId !== "string")
      )
        return false;
      if (
        review.actorLogin === login &&
        review.commitId === delivery.candidateCommit
      )
        latest = review.state;
    }
    return latest === "APPROVED" || latest === "COMMENTED";
  });
}

function recordedFeedbackIsClear(
  value: unknown,
  delivery: z.infer<typeof deliveryRecordSchema>,
): boolean {
  if (delivery.reviewPolicy.mode === "local_only") return true;
  if (!Array.isArray(value)) return false;
  return value.every((entry) => {
    const feedback = record(entry);
    if (
      feedback === undefined ||
      typeof feedback.actorLogin !== "string" ||
      typeof feedback.commitId !== "string" ||
      typeof feedback.priority !== "string"
    )
      return false;
    return !(
      feedback.commitId === delivery.candidateCommit &&
      delivery.reviewPolicy.requiredReviewerLogins.includes(
        feedback.actorLogin,
      ) &&
      feedback.priority !== "P3"
    );
  });
}

function awaitingHumanEvidencePasses(
  delivery: z.infer<typeof deliveryRecordSchema>,
): boolean {
  if (delivery.state !== "awaiting_human") return true;
  const observation = record(delivery.observation);
  if (observation?.headSha !== delivery.candidateCommit) return false;
  if (observation.branchSha !== delivery.candidateCommit) return false;
  const checks = recordedChecks(observation.checks);
  return (
    checks !== undefined &&
    checks
      .filter((check) => delivery.requiredChecks.includes(check.name))
      .every(
        (check) =>
          check.headSha === undefined ||
          check.headSha === delivery.candidateCommit,
      ) &&
    checkDecision(
      delivery.requiredChecks,
      checks,
      delivery.checkProducers,
      "pull_request",
      delivery.candidateCommit,
    ).status === "passed" &&
    recordedReviewsPass(observation.reviews, delivery) &&
    recordedFeedbackIsClear(observation.feedback, delivery)
  );
}

function nestedMergedReceiptMatches(
  delivery: z.infer<typeof deliveryRecordSchema>,
): boolean {
  const approval = delivery.mergeApproval;
  if (approval?.state !== "merged") return true;
  const plan = approval.plan;
  return (
    approval.approvalSource === "attended_operator" &&
    delivery.pullRequest !== null &&
    plan.repositoryNodeId === delivery.target.repositoryNodeId &&
    plan.pullRequestNumber === delivery.pullRequest.number &&
    plan.pullRequestNodeId === delivery.pullRequest.nodeId &&
    plan.headCommit === delivery.candidateCommit &&
    plan.candidateTree === delivery.candidateTree &&
    plan.actorLogin === delivery.target.actorLogin &&
    plan.actorId === delivery.target.actorId
  );
}

function postMergeDeliveryChecksPass(
  delivery: z.infer<typeof deliveryRecordSchema>,
  required: boolean,
): boolean {
  if (!required) return true;
  const mergeCommit = delivery.merge?.commit;
  const observation = record(delivery.observation);
  const checks = observation?.mergeChecks;
  if (mergeCommit === undefined || !Array.isArray(checks)) return false;
  const requiredChecks =
    delivery.postMergeRequiredChecks ?? delivery.requiredChecks;
  return requiredChecks.every((name) => {
    const producer = delivery.checkProducers?.[name];
    const named = checks.filter((value) => record(value)?.name === name);
    if (
      named.some((value) => {
        const check = record(value);
        return check?.headSha !== undefined && check.headSha !== mergeCommit;
      })
    )
      return false;
    const matching = checks.filter((value) => {
      const check = record(value);
      if (check?.name !== name) return false;
      if (delivery.checkProducers === undefined) return true;
      return (
        producer !== undefined &&
        check.appId === producer.appId &&
        check.workflowPath === producer.workflowPath &&
        check.event === "push" &&
        check.headSha === mergeCommit
      );
    });
    return (
      matching.length > 0 &&
      matching.every((value) => {
        const check = record(value);
        return check?.status === "completed" && check.conclusion === "success";
      })
    );
  });
}

function deliveryReceiptsMatch(
  delivery: z.infer<typeof deliveryRecordSchema>,
  run: PublicRunRecord,
): boolean {
  const validStatesByRun: Partial<
    Record<RunStatus, z.infer<typeof deliveryRecordSchema>["state"][]>
  > = {
    proposing: ["planned", "proposing"],
    effect_unknown: ["effect_unknown"],
    awaiting_ci: ["awaiting_ci"],
    awaiting_human: ["awaiting_human"],
    merged: ["merged"],
    post_merge_verified: ["merged", "post_merge_verified", "closed"],
    closed: ["closed"],
  };
  const validStates = validStatesByRun[run.status];
  if (validStates !== undefined && !validStates.includes(delivery.state))
    return false;
  const requiresPullRequest = [
    "awaiting_ci",
    "awaiting_human",
    "merged",
    "post_merge_verified",
    "closed",
  ].includes(delivery.state);
  if (
    requiresPullRequest &&
    (delivery.pullRequest === null ||
      delivery.remoteHeadCommit !== delivery.candidateCommit)
  )
    return false;
  if (delivery.merge !== null && delivery.merge.tree !== delivery.candidateTree)
    return false;
  if (delivery.state === "closed" && run.status !== "closed") return false;
  const mergeReceiptRequired = [
    "merged",
    "post_merge_verified",
    "closed",
  ].includes(run.status);
  const postMergeChecksRequired = ["post_merge_verified", "closed"].includes(
    run.status,
  );
  if (mergeReceiptRequired && delivery.merge === null) return false;
  return (
    awaitingHumanEvidencePasses(delivery) &&
    postMergeDeliveryChecksPass(delivery, postMergeChecksRequired) &&
    nestedMergedReceiptMatches(delivery)
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
  if (
    adaptation.matrix.some(
      (cell) =>
        cell.workflowId.length === 0 || cell.configurationId.length === 0,
    )
  )
    return null;
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
      commandId: cell.commandId === "" ? null : (cell.commandId ?? null),
      scenarioId: cell.scenarioId === "" ? null : (cell.scenarioId ?? null),
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
  } else if (
    validationStored.value === undefined &&
    validationEvidenceRequired(run, input.timeline)
  ) {
    reasons.push(
      reason(
        "OUTCOME_VALIDATION_MISSING",
        "The recorded lifecycle requires validation evidence, but none is stored.",
      ),
    );
    validation = { ...validation, status: "inconsistent" };
  } else if (validationStored.value !== undefined) {
    const evidence = validationStored.value;
    const candidateMatches = sameCandidate(run, evidence.candidateCommit);
    const commandRecordsMatch = commandEvidenceConsistent(evidence.commands);
    const adaptationCommandsMatch = adaptationEvidenceMatchesCommands(
      evidence.adaptation,
      evidence.commands,
    );
    const semanticRecordsMatch =
      evidence.semantic === undefined ||
      semanticEvidenceMatchesCommands(evidence.semantic, evidence.commands);
    const adaptationFieldsProjectable = adaptationFieldsAreProjectable(
      evidence.adaptation,
    );
    const passedByEvidence = validationPassedByEvidence(evidence);
    const resultMatches = evidence.passed === passedByEvidence;
    const validationCompletion = latestPhaseCompletion(
      input.timeline,
      new Set(["builder.started", "builder.resumed", "repair.started"]),
      new Set(["validation.passed", "validation.failed"]),
    );
    const validationCompletionMatches =
      validationCompletion !== "validation.failed" || !evidence.passed;
    if (!candidateMatches) {
      reasons.push(
        reason(
          "OUTCOME_VALIDATION_CANDIDATE_MISMATCH",
          "Stored validation evidence is bound to a different candidate.",
        ),
      );
    }
    if (!commandRecordsMatch) {
      reasons.push(
        reason(
          "OUTCOME_VALIDATION_COMMAND_MISMATCH",
          "Stored command status disagrees with its recorded exit evidence.",
        ),
      );
    }
    if (!adaptationCommandsMatch) {
      reasons.push(
        reason(
          "OUTCOME_ADAPTATION_COMMAND_MISMATCH",
          "Adaptation evidence lacks a complete command-bound configuration matrix.",
        ),
      );
    }
    if (!adaptationFieldsProjectable) {
      reasons.push(
        reason(
          "OUTCOME_ADAPTATION_MALFORMED",
          "Adaptation evidence contains identifiers that cannot support a stable outcome projection.",
        ),
      );
    }
    if (!semanticRecordsMatch) {
      reasons.push(
        reason(
          "OUTCOME_VALIDATION_SEMANTIC_MISMATCH",
          "Semantic evidence does not match its command or acceptance references.",
        ),
      );
    }
    if (!resultMatches) {
      reasons.push(
        reason(
          "OUTCOME_VALIDATION_RESULT_MISMATCH",
          "Stored validation pass state disagrees with its command or semantic evidence.",
        ),
      );
    }
    if (validationSuccessRequired(run, input.timeline) && !evidence.passed) {
      reasons.push(
        reason(
          "OUTCOME_VALIDATION_LIFECYCLE_MISMATCH",
          "The recorded lifecycle requires successful validation evidence.",
        ),
      );
    }
    if (!validationCompletionMatches) {
      reasons.push(
        reason(
          "OUTCOME_VALIDATION_LIFECYCLE_MISMATCH",
          "Stored validation evidence disagrees with the recorded failed validation completion.",
        ),
      );
    }
    const adaptation = compactAdaptation(evidence);
    let adaptationCurrent = true;
    if (adaptation !== null) {
      const capturedAt = Date.parse(adaptation.fixtures.capturedAt);
      const observedAt = Date.parse(adaptation.observedAt);
      const expiresAt = Date.parse(adaptation.fixtures.expiresAt);
      if (capturedAt > observedAt) {
        adaptationCurrent = false;
        reasons.push(
          reason(
            "OUTCOME_ADAPTATION_FIXTURE_FUTURE",
            "Adaptation fixture evidence was captured after the recorded verification.",
          ),
        );
      }
      if (expiresAt <= observedAt) {
        adaptationCurrent = false;
        reasons.push(
          reason(
            "OUTCOME_ADAPTATION_FIXTURE_STALE",
            "Adaptation fixture evidence expired before the recorded run state.",
          ),
        );
      }
    }
    validation = {
      status:
        !candidateMatches ||
        !commandRecordsMatch ||
        !adaptationCommandsMatch ||
        !adaptationFieldsProjectable ||
        !semanticRecordsMatch ||
        !resultMatches ||
        !validationCompletionMatches ||
        !adaptationCurrent
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
  } else if (
    reviewStored.value === undefined &&
    reviewEvidenceRequired(run, input.timeline)
  ) {
    reasons.push(
      reason(
        "OUTCOME_REVIEW_MISSING",
        "The recorded lifecycle requires review evidence, but none is stored.",
      ),
    );
    review = { ...review, status: "inconsistent" };
  } else if (reviewStored.value !== undefined) {
    const evidence = reviewStored.value;
    const candidateMatches = sameCandidate(run, evidence.candidateCommit);
    const scopeMatches =
      evidence.scope === undefined ||
      (evidence.scope.candidateCommit === evidence.candidateCommit &&
        evidence.scope.candidateCommit === run.candidateCommit &&
        evidence.scope.candidateTree === run.candidateTree);
    const reviewMustBeClean = cleanReviewRequired(run, input.timeline);
    const reviewCompletion = latestPhaseCompletion(
      input.timeline,
      new Set([
        "builder.started",
        "builder.resumed",
        "repair.started",
        "review.refresh_prepared",
      ]),
      new Set(["review.passed", "review.blocked"]),
    );
    const reviewCompletionMatches =
      reviewCompletion !== "review.blocked" || evidence.findings.length > 0;
    if (!candidateMatches || !scopeMatches) {
      reasons.push(
        reason(
          "OUTCOME_REVIEW_CANDIDATE_MISMATCH",
          "Stored review evidence is bound to a different candidate.",
        ),
      );
    }
    if (reviewMustBeClean && evidence.findings.length !== 0) {
      reasons.push(
        reason(
          "OUTCOME_REVIEW_RESULT_MISMATCH",
          "The recorded lifecycle requires a clean review, but findings remain.",
        ),
      );
    }
    if (!reviewCompletionMatches) {
      reasons.push(
        reason(
          "OUTCOME_REVIEW_RESULT_MISMATCH",
          "Stored review evidence disagrees with the recorded blocked review completion.",
        ),
      );
    }
    const findingCounts = { P0: 0, P1: 0, P2: 0, P3: 0 };
    for (const finding of evidence.findings) findingCounts[finding.severity]++;
    review = {
      status:
        !candidateMatches ||
        !scopeMatches ||
        (reviewMustBeClean && evidence.findings.length !== 0) ||
        !reviewCompletionMatches
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
  } else if (
    deliveryStored.value === undefined &&
    deliveryEvidenceRequired(run, input.timeline)
  ) {
    reasons.push(
      reason(
        "OUTCOME_DELIVERY_MISSING",
        "The recorded lifecycle requires delivery evidence, but none is stored.",
      ),
    );
    delivery = { ...delivery, status: "inconsistent" };
  } else if (deliveryStored.value !== undefined) {
    const evidence = deliveryStored.value;
    const matches =
      evidence.runId === run.id &&
      sameCandidate(run, evidence.candidateCommit, evidence.candidateTree);
    const receiptsMatch = deliveryReceiptsMatch(evidence, run);
    const effects = externalEffectBoundary(input.run);
    if (!matches) {
      reasons.push(
        reason(
          "OUTCOME_DELIVERY_CANDIDATE_MISMATCH",
          "Stored delivery evidence is bound to a different run or candidate.",
        ),
      );
    }
    if (!receiptsMatch) {
      reasons.push(
        reason(
          "OUTCOME_DELIVERY_RECEIPT_MISMATCH",
          "Stored delivery state lacks the required pull-request or merge receipts.",
        ),
      );
    }
    if (effects.unresolved) {
      reasons.push(
        reason(
          "OUTCOME_DELIVERY_EFFECT_UNRESOLVED",
          "Stored delivery evidence requires external-effect reconciliation.",
        ),
      );
    }
    delivery = {
      status:
        !matches || !receiptsMatch
          ? "inconsistent"
          : effects.unresolved
            ? "effect_unknown"
            : effects.merged
              ? evidence.state === "blocked"
                ? "blocked"
                : "merged"
              : evidence.state,
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
