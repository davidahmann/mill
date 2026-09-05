import { deliveryRecordSchema } from "../contracts/schemas.js";
import { ExitCode, MillError } from "../errors.js";
import type { RunRecord } from "./state.js";

export const maximumRemoteEffectAttempts = 2;
export type DeliveryJournal = ReturnType<typeof deliveryRecordSchema.parse>;

export function pendingExternalEffects(delivery: DeliveryJournal) {
  return {
    draft: delivery.effects.filter((effect) =>
      ["call_started", "effect_unknown"].includes(effect.status),
    ),
    merge:
      delivery.mergeApproval !== undefined &&
      ["ready_started", "merge_started", "effect_unknown"].includes(
        delivery.mergeApproval.state,
      ),
  };
}

/** Every draft effect that blocks new work is admitted by this same classifier. */
export function reconcilableDraftEffect(run: RunRecord) {
  const delivery =
    run.deliveryJson === undefined
      ? undefined
      : deliveryRecordSchema.parse(JSON.parse(run.deliveryJson));
  if (delivery === undefined)
    throw new MillError(
      "RECONCILIATION_NOT_REQUIRED",
      "No delivery journal exists.",
      ExitCode.configuration,
    );
  const pending = pendingExternalEffects(delivery);
  if (pending.merge)
    throw new MillError(
      "MERGE_RECONCILIATION_REQUIRED",
      "Use merge-reconcile for the recorded readiness or merge effect.",
      ExitCode.configuration,
    );
  if (pending.draft.length === 0 && run.status !== "effect_unknown")
    throw new MillError(
      "RECONCILIATION_NOT_REQUIRED",
      "The journal has no interrupted draft effect.",
      ExitCode.configuration,
    );
  const effect = pending.draft[0];
  if (
    pending.draft.length !== 1 ||
    effect === undefined ||
    effect.attemptCount < 1 ||
    effect.candidateCommit !== run.candidateCommit ||
    delivery.candidateCommit !== run.candidateCommit ||
    delivery.candidateTree !== run.candidateTree ||
    delivery.runId !== run.id ||
    delivery.mergeApproval?.state === "merged"
  )
    throw new MillError(
      "GITHUB_RECONCILIATION_STATE_INVALID",
      "Exactly one interrupted effect must match this run and candidate.",
      ExitCode.data,
    );
  return effect;
}

/** Derived from durable evidence, never from a caller's status/event label. */
export function externalEffectBoundary(run: RunRecord) {
  const delivery =
    run.deliveryJson === undefined
      ? undefined
      : deliveryRecordSchema.parse(JSON.parse(run.deliveryJson));
  const pending =
    delivery === undefined ? undefined : pendingExternalEffects(delivery);
  const journalUnresolved =
    pending !== undefined && (pending.draft.length > 0 || pending.merge);
  return {
    journalUnresolved,
    unresolved: run.status === "effect_unknown" || journalUnresolved,
    merged:
      run.status !== "closed" &&
      (delivery?.mergeApproval?.state === "merged" || delivery?.merge != null),
  };
}

export function assertNoUnresolvedEffect(run: RunRecord): void {
  if (externalEffectBoundary(run).unresolved)
    throw new MillError(
      "GITHUB_RECONCILIATION_REQUIRED",
      "Reconcile the recorded external effect before changing its lifecycle or evidence.",
      ExitCode.temporary,
    );
}

/** Local work and cleanup must not supersede an unresolved or merged candidate. */
export function assertEffectAllowsNewWork(run: RunRecord): void {
  assertNoUnresolvedEffect(run);
  if (externalEffectBoundary(run).merged)
    throw new MillError(
      "MERGE_FINALIZATION_REQUIRED",
      "Finalize the confirmed merge before superseding or removing its evidence.",
      ExitCode.temporary,
    );
}
