import { deliveryRecordSchema } from "../contracts/schemas.js";
import { ExitCode, MillError } from "../errors.js";
import type { RunRecord } from "./state.js";

/** Derived from durable evidence, never from a caller's status/event label. */
export function externalEffectBoundary(run: RunRecord) {
  const delivery =
    run.deliveryJson === undefined
      ? undefined
      : deliveryRecordSchema.parse(JSON.parse(run.deliveryJson));
  const journalUnresolved =
    delivery?.effects.some((effect) =>
      ["call_started", "effect_unknown"].includes(effect.status),
    ) === true ||
    (delivery?.mergeApproval !== undefined &&
      ["ready_started", "merge_started", "effect_unknown"].includes(
        delivery.mergeApproval.state,
      ));
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
