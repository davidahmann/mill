import path from "node:path";

import { parse as parseYaml } from "yaml";

import {
  outcomePlanSchema,
  sourceManifestSchema,
} from "../contracts/schemas.js";
import { canonicalDigest, type JsonValue } from "../contracts/canonical.js";
import { doctor, doctorReady } from "../doctor.js";
import { asMillError, ExitCode, MillError } from "../errors.js";
import {
  finalizeDraftPr,
  observeDraftPr,
  planDraftPr,
  reconcileDraftPr,
} from "../runtime/delivery.js";
import {
  qualifyBaseline,
  resumeRun,
  reviewRun,
  runInventory,
  runStatus,
  startLocalRun,
  verifyRun,
} from "../runtime/lifecycle.js";
import {
  loadMillConfig,
  loadRuntimeInputs,
  textDigest,
  type RuntimeInputs,
} from "../runtime/inputs.js";
import {
  commonGitDirectory,
  qualifyRepositoryForBuild,
} from "../runtime/repository.js";
import {
  prepareDependencySnapshot,
  type DependencyPreparationResult,
} from "../runtime/dependencies.js";
import { isTerminalRun, repositoryStateDirectory } from "../runtime/state.js";
import { safeReadText } from "../security/safe-path.js";
import { assertOutcomeDependencies } from "../planning/outcomes.js";

export interface NextOutcome {
  outcomeId: string;
  title: string;
  taskPath: string;
  productContractDigest: string;
  acceptanceIds: readonly string[];
}

export async function nextReadyOutcome(root: string): Promise<NextOutcome> {
  const source = await safeReadText(root, "product/plan.yaml", 2 * 1024 * 1024);
  let raw: unknown;
  try {
    raw = parseYaml(source);
  } catch (error) {
    throw new MillError(
      "OUTCOME_PLAN_INVALID",
      "product/plan.yaml is not valid YAML.",
      ExitCode.data,
      { cause: String(error) },
    );
  }
  const plan = outcomePlanSchema.parse(raw);
  assertOutcomeDependencies(plan);
  const ready = plan.outcomes.filter((outcome) => outcome.status === "ready");
  if (ready.length !== 1 || ready[0]?.taskRef === undefined) {
    throw new MillError(
      ready.length === 0 ? "NO_READY_OUTCOME" : "AMBIGUOUS_READY_OUTCOME",
      "Exactly one ready outcome with one approved task reference is required.",
      ExitCode.configuration,
      { readyOutcomeIds: ready.map((outcome) => outcome.id) },
    );
  }
  return {
    outcomeId: ready[0].id,
    title: ready[0].title,
    taskPath: ready[0].taskRef,
    productContractDigest: plan.productContractDigest,
    acceptanceIds: ready[0].acceptanceIds ?? [],
  };
}

export async function prepareRepositoryDependencies(
  root: string,
  attended: boolean,
): Promise<DependencyPreparationResult | undefined> {
  const config = await loadMillConfig(root);
  if (config.verifier?.dependencies === undefined) return undefined;
  const commonDirectory = await commonGitDirectory(root);
  return prepareDependencySnapshot({
    root,
    stateDirectory: repositoryStateDirectory(
      config.repositoryId,
      commonDirectory,
    ),
    config,
    attended,
  });
}

async function assertApprovedPrd(
  root: string,
  prdPath: string,
  inputs: RuntimeInputs,
): Promise<void> {
  const [prd, manifestSource] = await Promise.all([
    safeReadText(root, prdPath, 2 * 1024 * 1024),
    safeReadText(root, "product/sources.yaml", 2 * 1024 * 1024),
  ]);
  let raw: unknown;
  try {
    raw = parseYaml(manifestSource);
  } catch (error) {
    throw new MillError(
      "PRD_SOURCE_MANIFEST_INVALID",
      "product/sources.yaml is not valid YAML.",
      ExitCode.data,
      { cause: String(error) },
    );
  }
  const manifest = sourceManifestSchema.safeParse(raw);
  if (!manifest.success) {
    throw new MillError(
      "PRD_SOURCE_MANIFEST_INVALID",
      "product/sources.yaml does not satisfy its schema.",
      ExitCode.data,
      { issues: manifest.error.issues },
    );
  }
  const normalizedPrd = path.normalize(prdPath).split(path.sep).join("/");
  const expectedDigest = textDigest(prd);
  const productSourceIds = new Set(inputs.continuity?.product.sourceRefs ?? []);
  const matches = manifest.data.sources.filter((source) => {
    const normalizedSource = path
      .normalize(source.uri)
      .split(path.sep)
      .join("/");
    return (
      normalizedSource === normalizedPrd &&
      (source.revision === expectedDigest ||
        source.digest === expectedDigest) &&
      productSourceIds.has(source.id)
    );
  });
  if (matches.length !== 1) {
    throw new MillError(
      "PRD_AUTHORITY_MISMATCH",
      "The selected PRD is not the exact source bound by the approved product contract.",
      ExitCode.configuration,
      { prdPath, digest: expectedDigest, matches: matches.length },
    );
  }
}

function sameMembers(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((value, index) => value === sortedRight[index])
  );
}

function assertOutcomeAuthority(
  outcome: NextOutcome,
  inputs: RuntimeInputs,
): void {
  const continuity = inputs.continuity;
  const contractDigest =
    continuity === undefined
      ? null
      : canonicalDigest(continuity.product as unknown as JsonValue);
  const contractOutcome = continuity?.product.outcomes.find(
    (candidate) => candidate.id === outcome.outcomeId,
  );
  const impact = continuity?.impact;
  const contractAcceptance =
    contractOutcome?.acceptanceIds ??
    continuity?.product.acceptance.map((item) => item.id) ??
    [];
  const planAcceptance =
    outcome.acceptanceIds.length > 0
      ? outcome.acceptanceIds
      : contractAcceptance;
  if (
    continuity === undefined ||
    contractDigest !== outcome.productContractDigest ||
    contractOutcome === undefined ||
    impact?.outcomeId !== outcome.outcomeId ||
    contractAcceptance.length === 0 ||
    !sameMembers(planAcceptance, contractAcceptance) ||
    !sameMembers(contractAcceptance, impact.acceptanceIds)
  ) {
    throw new MillError(
      "OUTCOME_TASK_AUTHORITY_MISMATCH",
      "The ready outcome, product contract, and referenced task impact do not identify the same approved work.",
      ExitCode.configuration,
      {
        readyOutcomeId: outcome.outcomeId,
        impactOutcomeId: impact?.outcomeId ?? null,
        planProductContractDigest: outcome.productContractDigest,
        taskProductContractDigest: contractDigest,
      },
    );
  }
}

async function activeOutcomeRun(
  root: string,
  taskId: string,
): Promise<Awaited<ReturnType<typeof runStatus>>> {
  const active = (await runInventory({ root })).filter(
    (run) => !isTerminalRun(run.status),
  );
  if (active.length === 0) return {};
  if (active.length !== 1 || active[0]?.taskId !== taskId) {
    throw new MillError(
      "ACTIVE_OUTCOME_CONFLICT",
      "Exactly zero or one nonterminal run for the selected task may exist.",
      ExitCode.configuration,
      {
        activeRuns: active.map((run) => ({
          runId: run.id,
          taskId: run.taskId,
          status: run.status,
        })),
      },
    );
  }
  return runStatus({ root, runId: active[0].id });
}

export async function startNextReadyOutcome(input: {
  root: string;
  approvalDigest: string;
}): Promise<{
  outcome: NextOutcome;
  result: Awaited<ReturnType<typeof startLocalRun>>;
}> {
  const outcome = await nextReadyOutcome(input.root);
  const inputs = await loadRuntimeInputs(input.root, outcome.taskPath);
  assertOutcomeAuthority(outcome, inputs);
  const active = (await runInventory({ root: input.root })).filter(
    (run) => !isTerminalRun(run.status),
  );
  if (active.length > 0) {
    throw new MillError(
      "ACTIVE_OUTCOME_CONFLICT",
      "run next cannot create a second nonterminal lifecycle.",
      ExitCode.configuration,
      { activeRunIds: active.map((run) => run.id) },
    );
  }
  return {
    outcome,
    result: await startLocalRun({
      root: input.root,
      taskPath: outcome.taskPath,
      approvalDigest: input.approvalDigest,
    }),
  };
}

function requiresBuildPreflight(
  run: Awaited<ReturnType<typeof runStatus>>["run"],
): boolean {
  return (
    run === undefined ||
    run.status === "running" ||
    run.status === "verified" ||
    (run.status === "blocked" &&
      [
        "REVIEW_FINDINGS",
        "VALIDATION_FAILED",
        "REMOTE_REVIEW_FINDINGS",
        "INTERRUPTED_RUN",
        "CODEX_CANCELLED",
        "CODEX_DEADLINE_EXCEEDED",
        "CODEX_OUTPUT_BUDGET_EXCEEDED",
        "CODEX_EXECUTION_FAILED",
      ].includes(run.blockCode ?? ""))
  );
}

function requiresDependencyPreparation(
  run: Awaited<ReturnType<typeof runStatus>>["run"],
): boolean {
  return (
    run === undefined ||
    run.status === "running" ||
    run.status === "committed" ||
    (run.status === "blocked" &&
      [
        "REVIEW_FINDINGS",
        "VALIDATION_FAILED",
        "REMOTE_REVIEW_FINDINGS",
        "INTERRUPTED_RUN",
        "CODEX_CANCELLED",
        "CODEX_DEADLINE_EXCEEDED",
        "CODEX_OUTPUT_BUDGET_EXCEEDED",
        "CODEX_EXECUTION_FAILED",
      ].includes(run.blockCode ?? ""))
  );
}

async function authorizeExistingBuildSpend(
  root: string,
  outcome: NextOutcome,
  run: NonNullable<Awaited<ReturnType<typeof runStatus>>["run"]>,
): Promise<void> {
  const inputs = await loadRuntimeInputs(root, outcome.taskPath);
  assertOutcomeAuthority(outcome, inputs);
  if (
    run.taskDigest !== inputs.taskDigest ||
    run.configDigest !== inputs.configDigest
  ) {
    throw new MillError(
      "RUN_POLICY_DRIFT",
      "Task or repository configuration changed after approval.",
      ExitCode.configuration,
    );
  }
  const deadline = Date.parse(run.deadlineAt);
  if (!Number.isSafeInteger(deadline) || deadline <= Date.now()) {
    throw new MillError(
      "RUN_DEADLINE_EXCEEDED",
      "The approved run deadline has elapsed; a fresh qualification and run are required.",
      ExitCode.temporary,
      { deadlineAt: run.deadlineAt },
    );
  }
  const qualification = await qualifyRepositoryForBuild(
    root,
    inputs.task.baseRef,
    inputs.config.sensitivePaths,
  );
  if (qualification.baseCommit !== run.baseCommit) {
    throw new MillError(
      "BASE_REF_DRIFT",
      "The approved base reference moved after the run started.",
      ExitCode.configuration,
    );
  }
}

export async function startFounderDelivery(input: {
  root: string;
  prdPath: string;
  attended: boolean;
  draftPr: boolean;
}): Promise<{
  outcome: NextOutcome;
  stage: string;
  run?: Awaited<ReturnType<typeof runStatus>>["run"];
  pullRequestUrl?: string;
  deliveryProposalDigest?: string;
  nextAction: string;
  dependencyPreparation?: DependencyPreparationResult;
}> {
  if (!input.attended) {
    throw new MillError(
      "ATTENDANCE_REQUIRED",
      "The founder coordinator requires attended model, dependency, and optional forge authority.",
      ExitCode.configuration,
    );
  }
  const outcome = await nextReadyOutcome(input.root);
  const outcomeInputs = await loadRuntimeInputs(
    input.root,
    outcome.taskPath,
    "readback",
  );
  await assertApprovedPrd(input.root, input.prdPath, outcomeInputs);
  assertOutcomeAuthority(outcome, outcomeInputs);
  let status = await activeOutcomeRun(input.root, outcomeInputs.task.id);
  const preflightMode = requiresBuildPreflight(status.run)
    ? "build"
    : status.run?.status === "reviewed" && input.draftPr
      ? "propose"
      : "inspect";
  const preflight = await doctor(input.root, preflightMode);
  if (!doctorReady(preflight)) {
    throw new MillError(
      "START_PREFLIGHT_BLOCKED",
      "Founder preflight failed before the next required tool or external effect.",
      ExitCode.unavailable,
      { preflight },
    );
  }
  if (status.run === undefined && requiresDependencyPreparation(status.run)) {
    const authorizingInputs = await loadRuntimeInputs(
      input.root,
      outcome.taskPath,
    );
    assertOutcomeAuthority(outcome, authorizingInputs);
    await qualifyRepositoryForBuild(
      input.root,
      authorizingInputs.task.baseRef,
      authorizingInputs.config.sensitivePaths,
    );
  } else if (
    status.run !== undefined &&
    requiresDependencyPreparation(status.run)
  ) {
    await authorizeExistingBuildSpend(input.root, outcome, status.run);
  }
  const dependencyPreparation = requiresDependencyPreparation(status.run)
    ? await prepareRepositoryDependencies(input.root, input.attended)
    : undefined;
  if (status.run === undefined) {
    const qualification = await qualifyBaseline({
      root: input.root,
      taskPath: outcome.taskPath,
    });
    if (
      !qualification.evidence.passed ||
      qualification.approvalDigest === null
    ) {
      return {
        outcome,
        stage: "baseline_blocked",
        nextAction:
          "Resolve the reported native baseline failure and rerun the same start command.",
        ...(dependencyPreparation === undefined
          ? {}
          : { dependencyPreparation }),
      };
    }
    const started = await startLocalRun({
      root: input.root,
      taskPath: outcome.taskPath,
      approvalDigest: qualification.approvalDigest,
    });
    status = { run: started.run };
  }
  for (let step = 0; step < 8; step += 1) {
    const run = status.run;
    if (run === undefined) break;
    if (run.status === "committed") {
      status = {
        run: (
          await verifyRun({
            root: input.root,
            taskPath: outcome.taskPath,
            runId: run.id,
          })
        ).run,
      };
      continue;
    }
    if (run.status === "verified") {
      status = {
        run: (
          await reviewRun({
            root: input.root,
            taskPath: outcome.taskPath,
            runId: run.id,
          })
        ).run,
      };
      continue;
    }
    if (run.status === "reviewed") {
      if (!input.draftPr) {
        return {
          outcome,
          stage: "reviewed",
          run,
          nextAction: `Run millctl ship --draft --task ${outcome.taskPath} --run ${run.id} to approve remote delivery.`,
          ...(dependencyPreparation === undefined
            ? {}
            : { dependencyPreparation }),
        };
      }
      const planned = await planDraftPr({
        root: input.root,
        taskPath: outcome.taskPath,
        runId: run.id,
      });
      return {
        outcome,
        stage: "delivery_planned",
        run: planned.run,
        deliveryProposalDigest: planned.delivery.proposalDigest,
        nextAction: `Inspect the exact delivery plan, then run millctl ship --draft --task ${outcome.taskPath} --run ${run.id} --approve ${planned.delivery.proposalDigest} --attended.`,
        ...(dependencyPreparation === undefined
          ? {}
          : { dependencyPreparation }),
      };
    }
    if (run.status === "proposing") {
      return {
        outcome,
        stage: "delivery_planned",
        run,
        nextAction: `Run millctl ship --draft --task ${outcome.taskPath} --run ${run.id} to inspect a fresh exact delivery plan before attended approval.`,
        ...(dependencyPreparation === undefined
          ? {}
          : { dependencyPreparation }),
      };
    }
    if (run.status === "effect_unknown") {
      status = {
        run: (
          await reconcileDraftPr({
            root: input.root,
            taskPath: outcome.taskPath,
            runId: run.id,
          })
        ).run,
      };
      continue;
    }
    if (
      run.status === "blocked" &&
      run.blockCode === "REMOTE_REVIEW_FINDINGS"
    ) {
      status = {
        run: await resumeRun({
          root: input.root,
          taskPath: outcome.taskPath,
          runId: run.id,
        }),
      };
      continue;
    }
    if (
      run.status === "awaiting_ci" ||
      (run.status === "blocked" && run.blockCode === "REMOTE_CHECKS_FAILED")
    ) {
      const observed = await observeDraftPr({
        root: input.root,
        taskPath: outcome.taskPath,
        runId: run.id,
      });
      return {
        outcome,
        stage: observed.run.status,
        run: observed.run,
        ...(observed.delivery.pullRequest?.url === undefined
          ? {}
          : { pullRequestUrl: observed.delivery.pullRequest.url }),
        nextAction:
          observed.run.status === "awaiting_human"
            ? "The configured human marks the draft ready and merges it, then reruns start."
            : "Resolve the exact-head check or review blocker, then rerun start.",
        ...(dependencyPreparation === undefined
          ? {}
          : { dependencyPreparation }),
      };
    }
    if (
      run.status === "awaiting_human" ||
      run.status === "merged" ||
      run.status === "post_merge_verified"
    ) {
      let finalized: Awaited<ReturnType<typeof finalizeDraftPr>>;
      try {
        finalized = await finalizeDraftPr({
          root: input.root,
          taskPath: outcome.taskPath,
          runId: run.id,
        });
      } catch (error) {
        const failure = asMillError(error);
        if (failure.code !== "HUMAN_MERGE_PENDING") throw error;
        return {
          outcome,
          stage: run.status,
          run,
          nextAction:
            "The configured human marks the draft ready and merges it, then reruns start.",
          ...(dependencyPreparation === undefined
            ? {}
            : { dependencyPreparation }),
        };
      }
      return {
        outcome,
        stage: finalized.run.status,
        run: finalized.run,
        ...(finalized.delivery.pullRequest?.url === undefined
          ? {}
          : { pullRequestUrl: finalized.delivery.pullRequest.url }),
        nextAction:
          finalized.run.status === "closed"
            ? "Promote the next approved outcome in product/plan.yaml through an ordinary reviewed change."
            : "Wait for exact resulting-main checks, then rerun start.",
        ...(dependencyPreparation === undefined
          ? {}
          : { dependencyPreparation }),
      };
    }
    if (
      run.status === "running" ||
      (run.status === "blocked" &&
        [
          "REVIEW_FINDINGS",
          "VALIDATION_FAILED",
          "REVIEW_NON_CONVERGENCE",
          "INTERRUPTED_RUN",
          "CODEX_CANCELLED",
          "CODEX_DEADLINE_EXCEEDED",
          "CODEX_OUTPUT_BUDGET_EXCEEDED",
          "CODEX_EXECUTION_FAILED",
        ].includes(run.blockCode ?? ""))
    ) {
      status = {
        run: await resumeRun({
          root: input.root,
          taskPath: outcome.taskPath,
          runId: run.id,
        }),
      };
      continue;
    }
    return {
      outcome,
      stage: run.status,
      run,
      nextAction:
        "Inspect the typed blocker and use the matching expert recovery command.",
      ...(dependencyPreparation === undefined ? {} : { dependencyPreparation }),
    };
  }
  throw new MillError(
    "START_ADVANCE_BUDGET_EXHAUSTED",
    "The coordinator reached its bounded transition budget.",
    ExitCode.temporary,
  );
}
