import { z } from "zod";

import { runTimelineSchema } from "../contracts/schemas.js";
import {
  isRunStatus,
  isRunTransitionAllowed,
  type PublicRunRecord,
  type RunStatus,
} from "./state.js";

export type RunTimeline = z.infer<typeof runTimelineSchema>;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && z.iso.datetime().safeParse(value).success;
}

const lifecycleTransitionEventTypes = new Set([
  "builder.resumed",
  "builder.started",
  "candidate.committed",
  "delivery.awaiting_approval",
  "delivery.awaiting_ci",
  "delivery.blocked",
  "delivery.effect_reconciled",
  "delivery.merged",
  "delivery.post_merge_verified",
  "delivery.reconciliation_required",
  "delivery.reobserved",
  "repair.started",
  "review.blocked",
  "review.passed",
  "review.refresh_prepared",
  "review.retry_ready",
  "run.blocked",
  "run.cancelled",
  "run.closed",
  "run.interrupted",
  "run.ready",
  "validation.failed",
  "validation.passed",
  "workspace.setup_failed",
]);

function isBlockerReplacementMetadata(
  type: string,
  priorStatus: RunStatus | undefined,
  from: unknown,
  to: unknown,
): boolean {
  return (
    priorStatus === "blocked" &&
    (type === "run.blocker_replaced" || type === "delivery.blocked") &&
    typeof from === "string" &&
    from.length > 0 &&
    typeof to === "string" &&
    to.length > 0 &&
    !isRunStatus(from) &&
    !isRunStatus(to)
  );
}

function recordedTransition(
  type: string,
  priorStatus: RunStatus | undefined,
  data: Record<string, unknown> | undefined,
): { from: RunStatus; to: RunStatus } | "invalid" | undefined {
  const from = data?.from;
  const to = data?.to;
  if (isBlockerReplacementMetadata(type, priorStatus, from, to)) {
    return undefined;
  }
  if (from === undefined && to === undefined) {
    return lifecycleTransitionEventTypes.has(type) ? "invalid" : undefined;
  }
  if (isRunStatus(from) && isRunStatus(to)) return { from, to };
  return "invalid";
}

function isRecordedTransitionAllowed(
  type: string,
  from: RunStatus,
  to: RunStatus,
): boolean {
  return (
    isRunTransitionAllowed(from, to) ||
    (type === "review.refresh_prepared" &&
      ["reviewed", "proposing"].includes(from) &&
      to === "verified") ||
    (type === "delivery.effect_reconciled" &&
      from === "proposing" &&
      to === "proposing")
  );
}

function compactRun(run: PublicRunRecord): RunTimeline["run"] {
  return {
    id: run.id,
    taskId: run.taskId,
    status: run.status,
    baseCommit: run.baseCommit,
    ...(run.candidateCommit === undefined
      ? {}
      : { candidateCommit: run.candidateCommit }),
    cancelRequested: run.cancelRequested,
    repairCount: run.repairCount,
    attemptCount: run.attemptCount,
    ...(run.blockCode === undefined ? {} : { blockCode: run.blockCode }),
  };
}

function reason(
  code: string,
  message: string,
  sequence?: number,
): RunTimeline["integrity"]["reasons"][number] {
  return {
    code,
    message,
    ...(sequence === undefined ? {} : { sequence }),
  };
}

/**
 * Projects append-only run events into a compact, shareable lifecycle view.
 * It deliberately omits event data: detailed support evidence remains local.
 */
export function projectRunTimeline(input: {
  run: PublicRunRecord;
  events: readonly Record<string, unknown>[];
}): RunTimeline {
  const events: RunTimeline["events"] = [];
  const reasons: RunTimeline["integrity"]["reasons"] = [];
  let priorSequence = -1;
  let priorTimestamp = -Infinity;
  let derivedStatus: RunStatus | undefined;

  for (const raw of input.events) {
    const sequence = raw.sequence;
    const occurredAt = raw.occurredAt;
    const type = raw.type;
    if (
      typeof sequence !== "number" ||
      !Number.isInteger(sequence) ||
      sequence < 1 ||
      !isIsoTimestamp(occurredAt) ||
      typeof type !== "string" ||
      type.length === 0
    ) {
      reasons.push(
        reason(
          "TIMELINE_EVENT_INVALID",
          "A stored run event cannot be projected safely.",
        ),
      );
      continue;
    }
    if (sequence <= priorSequence) {
      reasons.push(
        reason(
          "TIMELINE_SEQUENCE_NONMONOTONIC",
          "Run event sequences must increase strictly.",
          sequence,
        ),
      );
    }
    priorSequence = sequence;
    const timestamp = Date.parse(occurredAt);
    if (timestamp < priorTimestamp) {
      reasons.push(
        reason(
          "TIMELINE_TIME_NONMONOTONIC",
          "Run event timestamps must not move backward.",
          sequence,
        ),
      );
    }
    priorTimestamp = timestamp;

    const journalDataInvalid = raw.journalDataInvalid === true;
    if (journalDataInvalid) {
      reasons.push(
        reason(
          "TIMELINE_EVENT_DATA_INVALID",
          "A stored run event has invalid journal data.",
          sequence,
        ),
      );
    }
    let transition: RunTimeline["events"][number]["transition"];
    const data = journalDataInvalid ? undefined : record(raw.data);
    if (type === "run.created") {
      if (data?.status !== "approved" || events.length !== 0) {
        reasons.push(
          reason(
            "TIMELINE_CREATION_INVALID",
            "The first run event must establish approved status.",
            sequence,
          ),
        );
      } else {
        derivedStatus = "approved";
      }
    } else {
      const recorded = recordedTransition(type, derivedStatus, data);
      if (recorded !== undefined) {
        if (recorded === "invalid") {
          reasons.push(
            reason(
              "TIMELINE_TRANSITION_INVALID",
              "A state-transition event has an invalid status boundary.",
              sequence,
            ),
          );
        } else {
          const { from, to } = recorded;
          transition = { from, to };
          if (derivedStatus !== from) {
            reasons.push(
              reason(
                "TIMELINE_TRANSITION_DISCONTINUITY",
                "A state-transition event does not begin at the prior recorded status.",
                sequence,
              ),
            );
          }
          if (!isRecordedTransitionAllowed(type, from, to)) {
            reasons.push(
              reason(
                "TIMELINE_TRANSITION_FORBIDDEN",
                "A state-transition event is not permitted by the lifecycle contract.",
                sequence,
              ),
            );
          }
          derivedStatus = to;
        }
      }
    }
    events.push({
      sequence,
      occurredAt,
      type,
      ...(transition === undefined ? {} : { transition }),
    });
  }

  if (events.length === 0 || events[0]?.type !== "run.created") {
    reasons.push(
      reason(
        "TIMELINE_CREATION_MISSING",
        "The lifecycle does not begin with a valid run.created event.",
      ),
    );
  }
  if (derivedStatus === undefined || derivedStatus !== input.run.status) {
    reasons.push(
      reason(
        "TIMELINE_STATUS_MISMATCH",
        "The projected lifecycle status does not match durable run state.",
      ),
    );
  }

  return runTimelineSchema.parse({
    schemaVersion: "1",
    run: compactRun(input.run),
    events,
    integrity: {
      status: reasons.length === 0 ? "consistent" : "inconsistent",
      reasons,
    },
  });
}
