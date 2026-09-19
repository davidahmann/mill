import type { z } from "zod";
import type {
  outcomePlanSchema,
  productContractSchema,
} from "../contracts/schemas.js";
import { canonicalDigest, type JsonValue } from "../contracts/canonical.js";
import type { RuntimeInputs } from "../runtime/inputs.js";
import { ExitCode, MillError } from "../errors.js";

export type OutcomePlan = z.infer<typeof outcomePlanSchema>;

function sameMembers(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    new Set(left).size === left.length &&
    left.every((id) => right.includes(id))
  );
}

/** Explicit outcome scope is complete; legacy unscoped outcomes may select a subset. */
export function outcomeAcceptanceIssue(
  product: z.infer<typeof productContractSchema>,
  outcomeId: string,
  acceptanceIds: readonly string[],
): string | undefined {
  const outcome = product.outcomes.find((item) => item.id === outcomeId);
  if (outcome === undefined) return `outcome is unresolved: ${outcomeId}`;
  if (
    acceptanceIds.length === 0 ||
    new Set(acceptanceIds).size !== acceptanceIds.length ||
    acceptanceIds.some(
      (id) => !product.acceptance.some((item) => item.id === id),
    )
  )
    return `outcome acceptance must select unique, known acceptance IDs: ${outcomeId}`;
  if (
    outcome.acceptanceIds !== undefined &&
    !sameMembers(outcome.acceptanceIds, acceptanceIds)
  )
    return `impact acceptance must equal the declared outcome acceptance: ${outcomeId}`;
  return undefined;
}

/** Bind a plan entry to the same scope enforced for direct task admission. */
export function assertOutcomeAuthority(
  outcome: {
    outcomeId: string;
    productContractDigest: string;
    acceptanceIds: readonly string[];
  },
  inputs: RuntimeInputs,
): void {
  const continuity = inputs.continuity;
  const contractDigest =
    continuity === undefined
      ? null
      : canonicalDigest(continuity.product as unknown as JsonValue);
  const impact = continuity?.impact;
  if (
    continuity === undefined ||
    impact === undefined ||
    contractDigest !== outcome.productContractDigest ||
    impact.outcomeId !== outcome.outcomeId ||
    outcomeAcceptanceIssue(
      continuity.product,
      outcome.outcomeId,
      impact.acceptanceIds,
    ) !== undefined ||
    (outcome.acceptanceIds.length > 0 &&
      !sameMembers(outcome.acceptanceIds, impact.acceptanceIds))
  ) {
    throw new MillError(
      "OUTCOME_TASK_AUTHORITY_MISMATCH",
      "The outcome, product contract, and referenced task impact do not identify the same approved work.",
      ExitCode.configuration,
      {
        outcomeId: outcome.outcomeId,
        impactOutcomeId: impact?.outcomeId ?? null,
        planProductContractDigest: outcome.productContractDigest,
        taskProductContractDigest: contractDigest,
      },
    );
  }
}

/** A ready flag cannot override missing predecessors or a cyclic plan. */
export function assertOutcomeDependencies(plan: OutcomePlan): void {
  const outcomes = new Map(
    plan.outcomes.map((outcome) => [outcome.id, outcome]),
  );
  const fail = (reason: string): never => {
    throw new MillError(
      "OUTCOME_DEPENDENCY_INVALID",
      reason,
      ExitCode.configuration,
    );
  };
  if (outcomes.size !== plan.outcomes.length)
    fail("Outcome IDs must be unique.");
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) fail(`Outcome dependency cycle at ${id}.`);
    if (visited.has(id)) return;
    const outcome = outcomes.get(id);
    if (outcome === undefined)
      return fail(`Unknown outcome dependency: ${id}.`);
    visiting.add(id);
    const dependencies = outcome.dependsOn;
    if (outcome.status === "ready" && outcome.taskRef === undefined)
      fail(`Ready outcome ${id} has no approved task reference.`);
    if (new Set(dependencies).size !== dependencies.length)
      fail(`Duplicate dependencies for ${id}.`);
    for (const dependency of dependencies) visit(dependency);
    visiting.delete(id);
    visited.add(id);
    if (
      outcome.status === "ready" &&
      dependencies.some(
        (dependency) => outcomes.get(dependency)?.status !== "closed",
      )
    ) {
      fail(`Ready outcome ${id} has an unclosed dependency.`);
    }
  };
  for (const id of outcomes.keys()) visit(id);
}
