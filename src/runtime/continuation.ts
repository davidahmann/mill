import type { PublicRunRecord, RunStatus } from "./state.js";

export type ContinuationAction =
  | "none"
  | "wait"
  | "reconcile"
  | "resume"
  | "verify"
  | "review"
  | "plan_draft_pr"
  | "open_draft_pr"
  | "observe_draft_pr"
  | "plan_merge"
  | "finalize_merge"
  | "attended_disposition";

export interface ContinuationUsage {
  source: "measured" | "partial" | "unavailable";
  admittedCalls: number;
  completedCalls: number;
  measuredCalls: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheInputTokens: number | null;
  cacheSource: "measured" | "partial" | "unavailable";
  cost: "unavailable";
  blockEvents: number;
}

export interface RunContinuationPacket {
  schemaVersion: "1";
  run: {
    id: string;
    taskId: string;
    taskDigest: string;
    configDigest: string;
    status: RunStatus;
    baseCommit: string;
    candidateCommit: string | null;
    candidateTree: string | null;
    deadlineAt: string;
    cancelRequested: boolean;
    repairCount: number;
    attemptCount: number;
    blockCode: string | null;
  };
  observation: {
    interrupted: boolean;
    reconciliationRequired: boolean;
    mergeFinalizationRequired: boolean;
    activeWorker: "observed" | "not_observed";
  };
  usage: ContinuationUsage;
  next: {
    action: ContinuationAction;
    reason: string;
    attended: true;
  };
}

function nextAction(input: {
  status: RunStatus;
  interrupted: boolean;
  reconciliationRequired: boolean;
  mergeFinalizationRequired: boolean;
  activeWorker: boolean;
}): RunContinuationPacket["next"] {
  if (input.reconciliationRequired) {
    return {
      action: "reconcile",
      reason:
        "Durable state records an uncertain worker or external effect; reconcile before another mutation.",
      attended: true,
    };
  }
  if (input.mergeFinalizationRequired) {
    return {
      action: "finalize_merge",
      reason:
        "Provider-authoritative merge evidence is recorded; resulting-main closure still needs finalization.",
      attended: true,
    };
  }
  if (input.activeWorker && !input.interrupted) {
    return {
      action: "wait",
      reason:
        "A worker is still observed; do not start, resume, or cancel blindly.",
      attended: true,
    };
  }
  if (input.status === "running") {
    return {
      action: "resume",
      reason:
        "The worker controller is absent and no uncertain effect is recorded; resume performs its own bounded reconciliation.",
      attended: true,
    };
  }
  const actions: Record<RunStatus, RunContinuationPacket["next"]> = {
    approved: {
      action: "attended_disposition",
      reason: "The run has not reached an executable workspace checkpoint.",
      attended: true,
    },
    ready: {
      action: "attended_disposition",
      reason:
        "The run is preparing its bounded workspace and needs an attended controller.",
      attended: true,
    },
    running: {
      action: "resume",
      reason:
        "The run is not actively observed and can be resumed only through its bounded lifecycle.",
      attended: true,
    },
    committed: {
      action: "verify",
      reason: "An exact candidate commit exists and needs native validation.",
      attended: true,
    },
    verified: {
      action: "review",
      reason:
        "Native validation passed; the exact candidate still needs independent read-only review.",
      attended: true,
    },
    reviewed: {
      action: "plan_draft_pr",
      reason:
        "The candidate is locally reviewed; draft delivery still requires an exact plan and approval.",
      attended: true,
    },
    proposing: {
      action: "open_draft_pr",
      reason: "A draft delivery plan is pending its exact attended approval.",
      attended: true,
    },
    effect_unknown: {
      action: "reconcile",
      reason:
        "A GitHub effect is uncertain and authoritative readback is required before retry.",
      attended: true,
    },
    awaiting_ci: {
      action: "observe_draft_pr",
      reason:
        "The draft pull request is open and its exact head needs provider-authoritative observation.",
      attended: true,
    },
    awaiting_human: {
      action: "plan_merge",
      reason:
        "CI and review are ready, but merge remains a separately planned human effect.",
      attended: true,
    },
    merged: {
      action: "finalize_merge",
      reason:
        "The provider reports a merge; resulting-main closure still needs authoritative verification.",
      attended: true,
    },
    post_merge_verified: {
      action: "finalize_merge",
      reason:
        "Post-merge checks are recorded; finalize preserves resulting-main closure evidence.",
      attended: true,
    },
    closed: {
      action: "none",
      reason:
        "The run is closed and must not be restarted from a continuation packet.",
      attended: true,
    },
    blocked: {
      action: "attended_disposition",
      reason:
        "The run is blocked; inspect retained evidence and choose a new approved path if needed.",
      attended: true,
    },
    cancelled: {
      action: "none",
      reason:
        "The run was cancelled and must not be restarted from a continuation packet.",
      attended: true,
    },
    failed: {
      action: "none",
      reason:
        "The run failed and retained evidence must be used to create a new approved path.",
      attended: true,
    },
    stale: {
      action: "none",
      reason:
        "The run is stale and cannot be resumed without a new approved path.",
      attended: true,
    },
  };
  return actions[input.status];
}

export function continuationPacket(input: {
  run: PublicRunRecord;
  interrupted?: boolean;
  reconciliationRequired?: boolean;
  mergeFinalizationRequired?: boolean;
  activeWorker?: boolean;
  usage: ContinuationUsage;
}): RunContinuationPacket {
  const interrupted = input.interrupted === true;
  const reconciliationRequired = input.reconciliationRequired === true;
  const mergeFinalizationRequired = input.mergeFinalizationRequired === true;
  const activeWorker = input.activeWorker ?? input.run.activePid !== undefined;
  return {
    schemaVersion: "1",
    run: {
      id: input.run.id,
      taskId: input.run.taskId,
      taskDigest: input.run.taskDigest,
      configDigest: input.run.configDigest,
      status: input.run.status,
      baseCommit: input.run.baseCommit,
      candidateCommit: input.run.candidateCommit ?? null,
      candidateTree: input.run.candidateTree ?? null,
      deadlineAt: input.run.deadlineAt,
      cancelRequested: input.run.cancelRequested,
      repairCount: input.run.repairCount,
      attemptCount: input.run.attemptCount,
      blockCode: input.run.blockCode ?? null,
    },
    observation: {
      interrupted,
      reconciliationRequired,
      mergeFinalizationRequired,
      activeWorker: activeWorker ? "observed" : "not_observed",
    },
    usage: input.usage,
    next: nextAction({
      status: input.run.status,
      interrupted,
      reconciliationRequired,
      mergeFinalizationRequired,
      activeWorker,
    }),
  };
}
