import type { z } from "zod";
import type { outcomePlanSchema } from "../contracts/schemas.js";
import { ExitCode, MillError } from "../errors.js";

export type OutcomePlan = z.infer<typeof outcomePlanSchema>;

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
