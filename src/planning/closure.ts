import { parse as parseYaml, stringify as yaml } from "yaml";
import { canonicalDigest, type JsonValue } from "../contracts/canonical.js";
import {
  deliveryRecordSchema,
  outcomePlanSchema,
} from "../contracts/schemas.js";
import { MillError, ExitCode } from "../errors.js";
import { loadRuntimeInputs, textDigest } from "../runtime/inputs.js";
import {
  assertRepositoryWorktreeClean,
  commonGitDirectory,
  readCandidateIdentity,
} from "../runtime/repository.js";
import { StateStore } from "../runtime/state.js";
import { safeReadText } from "../security/safe-path.js";
import { assertOutcomeDependencies } from "./outcomes.js";

/** Propose a repository-authority update from finalized evidence; never approve it. */
export async function planOutcomeClosure(input: {
  root: string;
  taskPath: string;
  runId: string;
  nextOutcomeId?: string;
}) {
  await assertRepositoryWorktreeClean(input.root);
  const base = await readCandidateIdentity(input.root);
  const inputs = await loadRuntimeInputs(
    input.root,
    input.taskPath,
    "readback",
  );
  const original = await safeReadText(input.root, "product/plan.yaml");
  const plan = outcomePlanSchema.parse(parseYaml(original));
  const store = await StateStore.open(
    inputs.config.repositoryId,
    await commonGitDirectory(input.root),
  );
  try {
    const run = store.getRun(input.runId);
    const delivery =
      run.deliveryJson === undefined
        ? undefined
        : deliveryRecordSchema.parse(JSON.parse(run.deliveryJson));
    const outcome = plan.outcomes.find(
      (item) => item.id === inputs.continuity?.impact.outcomeId,
    );
    if (
      inputs.continuity === undefined ||
      run.status !== "closed" ||
      run.deliveryJson === undefined ||
      run.taskDigest !== inputs.taskDigest ||
      delivery?.state !== "closed" ||
      delivery.merge === null ||
      delivery.candidateCommit !== run.candidateCommit ||
      delivery.merge.tree !== run.candidateTree ||
      outcome?.taskRef !== input.taskPath ||
      plan.productContractDigest !==
        canonicalDigest(inputs.continuity.product as JsonValue)
    )
      throw new MillError(
        "OUTCOME_CLOSURE_UNVERIFIED",
        "Closure requires the exact task, product plan and provider-finalized run; a ready flag or model claim is insufficient.",
        ExitCode.configuration,
      );
    outcome.status = "closed";
    if (input.nextOutcomeId !== undefined) {
      const next = plan.outcomes.find(
        (item) => item.id === input.nextOutcomeId,
      );
      if (next?.status !== "approved")
        throw new MillError(
          "OUTCOME_NEXT_NOT_APPROVED",
          "The next outcome must already be approved.",
          ExitCode.configuration,
        );
      next.status = "ready";
    }
    assertOutcomeDependencies(plan);
    if (plan.outcomes.filter((item) => item.status === "ready").length > 1)
      throw new MillError(
        "OUTCOME_MULTIPLE_READY",
        "Closure cannot create multiple ready outcomes.",
        ExitCode.configuration,
      );
    await assertRepositoryWorktreeClean(input.root);
    if ((await readCandidateIdentity(input.root)).commit !== base.commit)
      throw new MillError(
        "CHANGE_BASE_STALE",
        "The source changed during closure planning.",
        ExitCode.configuration,
      );
    const result = {
      schemaVersion: "1",
      authority: "proposal_only",
      baseCommit: base.commit,
      baseTree: base.tree,
      previousPlanDigest: textDigest(original),
      runId: run.id,
      taskDigest: run.taskDigest,
      evidenceDigest: textDigest(run.deliveryJson),
      mergeCommit: delivery.merge.commit,
      files: [{ path: "product/plan.yaml", content: yaml(plan) }],
      nextAction:
        "Review and commit this authority update through an ordinary approved repository change; closure planning writes nothing.",
    };
    return { ...result, approvalDigest: canonicalDigest(result) };
  } finally {
    store.close();
  }
}
