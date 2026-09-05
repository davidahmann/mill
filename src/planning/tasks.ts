import { lstat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as yaml } from "yaml";
import { canonicalDigest, type JsonValue } from "../contracts/canonical.js";
import {
  changeRequestSchema,
  impactManifestSchema,
  outcomePlanSchema,
  productContractSchema,
  scenarioSetSchema,
  taskPacketV2Schema,
} from "../contracts/schemas.js";
import { ExitCode, MillError } from "../errors.js";
import { loadMillConfig, textDigest } from "../runtime/inputs.js";
import {
  assertRepositoryWorktreeClean,
  commonGitDirectory,
  createCandidateWorktree,
  readCandidateIdentity,
} from "../runtime/repository.js";
import {
  acquireWriterLease,
  StateStore,
  isTerminalRun,
} from "../runtime/state.js";
import { safeReadText } from "../security/safe-path.js";
import { assessImpactManifest } from "./impact.js";
import { assertOutcomeDependencies } from "./outcomes.js";

const digest = (value: unknown) => canonicalDigest(value as JsonValue);

/** Deterministic compilation; source prose and model proposals never confer authority. */
export async function compileChangeTasks(input: {
  root: string;
  requestPath: string;
}) {
  await assertRepositoryWorktreeClean(input.root);
  const base = await readCandidateIdentity(input.root);
  const request = changeRequestSchema.parse(
    parseYaml(
      await safeReadText(input.root, input.requestPath, 2 * 1024 * 1024),
    ),
  );
  const [source, productText, scenarioText, policyText, config] =
    await Promise.all([
      safeReadText(input.root, request.source.path, 2 * 1024 * 1024),
      safeReadText(input.root, request.productPath, 2 * 1024 * 1024),
      safeReadText(input.root, request.scenariosPath, 2 * 1024 * 1024),
      safeReadText(input.root, request.policyPath, 2 * 1024 * 1024),
      loadMillConfig(input.root),
    ]);
  if (textDigest(source) !== request.source.digest)
    throw new MillError(
      "CHANGE_SOURCE_STALE",
      "The change request is bound to different source bytes.",
      ExitCode.configuration,
    );
  const product = productContractSchema.parse(parseYaml(productText));
  const scenarios = scenarioSetSchema.parse(parseYaml(scenarioText));
  const files: { path: string; content: string }[] = [];
  const outcomes: Parameters<typeof assertOutcomeDependencies>[0]["outcomes"] =
    [];
  const taskIds = new Set<string>();
  const commandControls = Object.values(config.commands).flatMap(
    (command) => command.controlPaths,
  );
  const authorityPaths = [
    "AGENTS.md",
    "WORKFLOW.md",
    "mill.yaml",
    "mill.lock",
    request.productPath,
    request.scenariosPath,
    request.policyPath,
    input.requestPath,
    request.source.path,
    "product/tasks/**",
    "product/impacts/**",
    "product/plan.yaml",
    ...request.tasks.map((task) => task.impactPath),
    ...commandControls,
  ];
  const overlaps = (left: string, right: string): boolean => {
    const a = left.replace(/\/\*\*$/u, "");
    const b = right.replace(/\/\*\*$/u, "");
    return (
      a === b ||
      (left.endsWith("/**") && b.startsWith(`${a}/`)) ||
      (right.endsWith("/**") && a.startsWith(`${b}/`))
    );
  };
  for (const draft of request.tasks) {
    if (taskIds.has(draft.id))
      throw new MillError(
        "DUPLICATE_TASK_ID",
        "Compiled task IDs must be unique.",
        ExitCode.configuration,
      );
    taskIds.add(draft.id);
    if (
      draft.allowedPaths.some((allowed) =>
        [...authorityPaths, ...config.sensitivePaths].some((protectedPath) =>
          overlaps(allowed, protectedPath),
        ),
      )
    )
      throw new MillError(
        "TASK_AUTHORITY_OVERLAP",
        "Compiled outputs overlap authority, command controls or sensitive paths.",
        ExitCode.configuration,
      );
    const impactText = await safeReadText(
      input.root,
      draft.impactPath,
      2 * 1024 * 1024,
    );
    const impact = impactManifestSchema.parse(parseYaml(impactText));
    const assessed = assessImpactManifest({
      manifest: impact,
      product,
      scenarios,
    });
    if (
      !assessed.approved ||
      assessed.blockers.length > 0 ||
      impact.outcomeId !== draft.outcomeId
    )
      throw new MillError(
        "CHANGE_IMPACT_BLOCKED",
        "Every compiled task requires its own approved, closed impact manifest.",
        ExitCode.configuration,
        { blockers: assessed.blockers },
      );
    const outcome = product.outcomes.find(
      (value) => value.id === draft.outcomeId,
    );
    if (
      outcome === undefined ||
      (outcome.acceptanceIds !== undefined &&
        digest([...outcome.acceptanceIds].sort()) !==
          digest([...impact.acceptanceIds].sort()))
    )
      throw new MillError(
        "CHANGE_OUTCOME_MISMATCH",
        "Task acceptance must equal the approved outcome acceptance.",
        ExitCode.configuration,
      );
    for (const command of impact.commandIds)
      if (config.commands[command] === undefined)
        throw new MillError(
          "CHANGE_COMMAND_MISSING",
          "An impact references an undeclared native command.",
          ExitCode.configuration,
        );
    const acceptance = impact.acceptanceIds.map((id) => {
      const item = product.acceptance.find((value) => value.id === id);
      if (item === undefined)
        throw new MillError(
          "CHANGE_ACCEPTANCE_MISSING",
          "An acceptance item does not resolve in the approved product.",
          ExitCode.configuration,
        );
      const selected = scenarios.scenarios.filter(
        (scenario) =>
          impact.scenarioIds.includes(scenario.id) &&
          scenario.acceptanceRefs.includes(id),
      );
      const commandIds = [
        ...new Set(selected.map((scenario) => scenario.executionRef)),
      ];
      if (
        selected.length === 0 ||
        commandIds.length !== 1 ||
        commandIds[0] === undefined ||
        selected.some((scenario) => scenario.oracleOwner !== "repository")
      )
        throw new MillError(
          "CHANGE_ORACLE_UNSUPPORTED",
          "Compilation requires one explicit repository-native command per acceptance item; human or external oracles require an expert task packet.",
          ExitCode.configuration,
        );
      return {
        id,
        statement: item.statement,
        invariantIds: [
          ...new Set(selected.flatMap((scenario) => scenario.invariantRefs)),
        ],
        scenarioIds: selected.map((scenario) => scenario.id),
        coverage: selected.every(
          (scenario) => scenario.coverage === "new_behavior",
        )
          ? ("new_behavior" as const)
          : selected.every((scenario) => scenario.coverage === "preservation")
            ? ("preservation" as const)
            : ("both" as const),
        evidence: { mode: "command" as const, commandId: commandIds[0] },
      };
    });
    const task = taskPacketV2Schema.parse({
      schemaVersion: "2",
      ...(request.repositoryIntelligence === true
        ? { repositoryIntelligence: true }
        : {}),
      id: draft.id,
      title: draft.title,
      objective: draft.objective,
      riskClass: impact.riskClass,
      baseRef: "HEAD",
      authority: {
        productContract: {
          path: request.productPath,
          digest: textDigest(productText),
        },
        scenarioSet: {
          path: request.scenariosPath,
          digest: textDigest(scenarioText),
        },
        policy: { path: request.policyPath, digest: textDigest(policyText) },
        impactManifest: {
          path: draft.impactPath,
          digest: textDigest(impactText),
        },
      },
      contextPaths: [
        ...new Set([...draft.contextPaths, request.source.path]),
      ].sort(),
      allowedPaths: draft.allowedPaths,
      commandIds: impact.commandIds,
      attestations: draft.attestations,
      acceptance,
      commit: {
        ...request.commit,
        message: `feat: ${draft.title}\n\nSigned-off-by: ${request.commit.authorName} <${request.commit.authorEmail}>`,
      },
      budget: request.budget,
    });
    const taskPath = `product/tasks/${draft.id}.yaml`;
    files.push({ path: taskPath, content: yaml(task) });
    outcomes.push({
      id: draft.outcomeId,
      title: draft.title,
      acceptance: acceptance.map((item) => item.statement),
      acceptanceIds: impact.acceptanceIds,
      dependsOn: draft.dependsOn,
      status: draft.outcomeId === request.readyOutcomeId ? "ready" : "approved",
      taskRef: taskPath,
    });
  }
  try {
    const previous = outcomePlanSchema.parse(
      parseYaml(await safeReadText(input.root, "product/plan.yaml")),
    );
    for (const outcome of previous.outcomes) {
      if (!outcomes.some((next) => next.id === outcome.id))
        outcomes.push(outcome);
      else if (outcome.status === "closed")
        throw new MillError(
          "CHANGE_REOPENS_CLOSED_OUTCOME",
          "A follow-up must use a new approved outcome; closed history cannot be rewritten.",
          ExitCode.configuration,
        );
      else {
        const draft = request.tasks.find(
          (task) => task.outcomeId === outcome.id,
        );
        if (
          outcome.taskRef === undefined ||
          draft?.supersedesTaskDigest === undefined ||
          textDigest(await safeReadText(input.root, outcome.taskRef)) !==
            draft.supersedesTaskDigest
        )
          throw new MillError(
            "CHANGE_SUPERSESSION_REQUIRED",
            "Replacing an existing outcome requires its exact prior task-file digest; preserve closed history.",
            ExitCode.configuration,
          );
      }
    }
  } catch (error) {
    if (!(error instanceof MillError && error.code === "FILE_NOT_FOUND"))
      throw error;
  }
  const plan = outcomePlanSchema.parse({
    schemaVersion: "1",
    productContractDigest: digest(product),
    outcomes,
  });
  assertOutcomeDependencies(plan);
  if (outcomes.filter((outcome) => outcome.status === "ready").length !== 1)
    throw new MillError(
      "CHANGE_READY_OUTCOME_INVALID",
      "The change plan must select exactly one dependency-ready outcome.",
      ExitCode.configuration,
    );
  files.push({ path: "product/plan.yaml", content: yaml(plan) });
  await assertRepositoryWorktreeClean(input.root);
  if ((await readCandidateIdentity(input.root)).commit !== base.commit)
    throw new MillError(
      "CHANGE_BASE_STALE",
      "Source changed during task compilation.",
      ExitCode.configuration,
    );
  const result = {
    schemaVersion: "1",
    kind: request.kind,
    requestId: request.id,
    requestDigest: digest(request),
    baseCommit: base.commit,
    baseTree: base.tree,
    configDigest: digest(config),
    files,
  };
  return { ...result, approvalDigest: digest(result) };
}

/** Apply only in a new disposable worktree; never overwrite an existing task. */
export async function applyChangeTasks(input: {
  root: string;
  requestPath: string;
  approvalDigest: string;
  attended: boolean;
}) {
  if (!input.attended)
    throw new MillError(
      "ATTENDANCE_REQUIRED",
      "Task-plan apply requires an attended operator.",
      ExitCode.configuration,
    );
  const plan = await compileChangeTasks(input);
  if (plan.approvalDigest !== input.approvalDigest)
    throw new MillError(
      "CHANGE_APPROVAL_MISMATCH",
      "Approval does not match the exact source, base, policy and compiled files.",
      ExitCode.configuration,
    );
  const config = await loadMillConfig(input.root);
  if (config.trustCeiling === "inspect")
    throw new MillError(
      "TRUST_CEILING_EXCEEDED",
      "Inspect-only policy permits task planning, not authority writes.",
      ExitCode.configuration,
    );
  const store = await StateStore.open(
    config.repositoryId,
    await commonGitDirectory(input.root),
  );
  let lease: Awaited<ReturnType<typeof acquireWriterLease>> | undefined;
  const id = plan.approvalDigest.slice(7);
  const destination = path.join(store.worktreesDirectory, `plan-${id}`);
  let branch: string;
  try {
    lease = await acquireWriterLease(store);
    if (store.runs().some((run) => !isTerminalRun(run.status)))
      throw new MillError(
        "ACTIVE_RUN_CONFLICT",
        "Finish or reconcile the existing lifecycle before applying new task authority.",
        ExitCode.configuration,
      );
    if (
      (await compileChangeTasks(input)).approvalDigest !== plan.approvalDigest
    )
      throw new MillError(
        "CHANGE_BASE_STALE",
        "The approved plan changed before apply.",
        ExitCode.configuration,
      );
    store.beginAuthorityPlan(
      {
        kind: "tasks",
        state: "intent",
        approvalDigest: plan.approvalDigest,
        baseCommit: plan.baseCommit,
        worktreePath: destination,
        branch: `mill/${`plan-${plan.requestId}`.slice(0, 32)}-${id.slice(0, 8)}`,
        files: plan.files.map((file) => ({
          path: file.path,
          digest: textDigest(file.content),
        })),
      },
      "CHANGE_APPLY_RECONCILIATION_REQUIRED",
    );
    branch = await createCandidateWorktree(
      input.root,
      destination,
      plan.baseCommit,
      `plan-${plan.requestId}`,
      id,
    );
    for (const file of plan.files) {
      let ancestor = destination;
      for (const segment of file.path.split("/")) {
        ancestor = path.join(ancestor, segment);
        try {
          const info = await lstat(ancestor);
          if (info.isSymbolicLink())
            throw new MillError(
              "CHANGE_UNSAFE_OUTPUT",
              "A generated-file ancestor is a symbolic link.",
              ExitCode.configuration,
            );
        } catch (error) {
          if (!(
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          ))
            throw error;
        }
      }
      await mkdir(path.dirname(path.join(destination, file.path)), {
        recursive: true,
      });
      if (file.path === "product/plan.yaml") {
        // Replacement is visible in the exact approved plan and isolated from the operator checkout.
        await writeFile(path.join(destination, file.path), file.content, {
          flag: "w",
          mode: 0o644,
        });
      } else
        await writeFile(path.join(destination, file.path), file.content, {
          flag: "wx",
          mode: 0o644,
        });
    }
    store.settleAuthorityPlan(plan.approvalDigest, { branch });
    return {
      approvalDigest: plan.approvalDigest,
      branch,
      worktree: destination,
      files: plan.files.map((file) => file.path),
      nextAction:
        "Review and commit the authority files, then qualify the selected task against that new exact base.",
    };
  } finally {
    try {
      await lease?.release();
    } finally {
      store.close();
    }
  }
}
