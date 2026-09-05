import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  contextManifestSchema,
  reviewResultSchema,
  validationEvidenceSchema,
} from "../contracts/schemas.js";
import { canonicalDigest, type JsonValue } from "../contracts/canonical.js";
import { verifyAuthorityPlanPurge } from "./authority-plans.js";
import {
  codexWorkerAdapter,
  codexAuthStatus,
  type ProviderUsage,
} from "./codex.js";
import {
  assertContextFresh,
  buildContextManifest,
  type ContextManifest,
} from "./context.js";
import { ExitCode, MillError, asMillError } from "../errors.js";
import {
  assertNewRunTaskContract,
  loadMillConfig,
  loadRuntimeInputs,
  type RuntimeInputs,
} from "./inputs.js";
import {
  assertCandidateIdentity,
  assertGitControlState,
  captureGitControlState,
  captureReviewScope,
  commitCandidate,
  commonGitDirectory,
  createCandidateWorktree,
  createDetachedWorktree,
  deleteCandidateBranch,
  qualifyRepositoryForBuild,
  removeCandidateWorktree,
  removeVerifiedAuthorityWorktree,
  resetCandidateWorktree,
  resolveCommit,
  type GitControlSnapshot,
} from "./repository.js";
import {
  acquireWriterLease,
  isPurgeSafeRun,
  isSettledAuthorityPlan,
  isTerminalRun,
  purgeRepositoryState,
  publicRunRecord,
  restoreStateBackup,
  StateStore,
  type PublicRunRecord,
  type RunRecord,
} from "./state.js";
import { createWorkerInvocation } from "./worker.js";
import { dependencySnapshotDirectory } from "./dependencies.js";
import { verifyDeclaredCommands, type ValidationEvidence } from "./verifier.js";
import {
  processCancellationScope,
  processIdentityStatus,
  type ActiveProcess,
} from "./process.js";
import { MILL_VERSION } from "../version.js";
import { validationRepairFindings } from "./repair.js";
import { summarizeUsage } from "./usage.js";
import { continuationPacket } from "./continuation.js";
import {
  assertEffectAllowsNewWork,
  externalEffectBoundary,
} from "./effect-boundary.js";

interface RunContext {
  inputs: RuntimeInputs;
  store: StateStore;
  commonDirectory: string;
}

function operationDeadline(seconds: number): number {
  return Date.now() + seconds * 1000;
}

function persistedRunDeadline(run: RunRecord): number {
  const deadline = Date.parse(run.deadlineAt);
  if (!Number.isSafeInteger(deadline) || deadline <= Date.now()) {
    throw new MillError(
      "RUN_DEADLINE_EXCEEDED",
      "The approved run deadline has elapsed; a fresh qualification and run are required.",
      ExitCode.temporary,
      { deadlineAt: run.deadlineAt },
    );
  }
  return deadline;
}

function baselineEvidenceDigest(evidence: ValidationEvidence): string {
  return canonicalDigest({
    schemaVersion: evidence.schemaVersion,
    candidateCommit: evidence.candidateCommit,
    verifierImage: evidence.verifierImage,
    network: evidence.network,
    passed: evidence.passed,
    commands: evidence.commands.map((command) => ({
      commandId: command.commandId,
      required: command.required,
      status: command.status,
      exitCode: command.exitCode,
      outputDigest: command.outputDigest,
      reason: command.reason ?? null,
    })),
  });
}

function baselineApprovalDigest(input: {
  taskDigest: string;
  configDigest: string;
  baseCommit: string;
  evidenceDigest: string;
}): string {
  return canonicalDigest({
    schemaVersion: "1",
    ...input,
  });
}

function assertBuildAuthorized(inputs: RuntimeInputs): void {
  if (inputs.config.trustCeiling === "inspect") {
    throw new MillError(
      "BUILD_NOT_AUTHORIZED",
      "mill.yaml trust ceiling does not authorize build mode.",
      ExitCode.configuration,
    );
  }
}

async function openRunContext(
  root: string,
  taskPath: string,
): Promise<RunContext> {
  const inputs = await loadRuntimeInputs(root, taskPath);
  assertBuildAuthorized(inputs);
  const commonDirectory = await commonGitDirectory(root);
  const store = await StateStore.open(
    inputs.config.repositoryId,
    commonDirectory,
  );
  return { inputs, store, commonDirectory };
}

function storedManifest(run: RunRecord): ContextManifest {
  if (run.contextJson === undefined || run.contextDigest === undefined) {
    throw new MillError(
      "CONTEXT_MANIFEST_MISSING",
      "Run has no frozen context manifest.",
      ExitCode.configuration,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(run.contextJson);
  } catch (error) {
    throw new MillError(
      "CONTEXT_MANIFEST_INVALID",
      "Stored context manifest is not valid JSON.",
      ExitCode.data,
      { cause: String(error) },
    );
  }
  const parsed = contextManifestSchema.safeParse(value);
  if (!parsed.success) {
    throw new MillError(
      "CONTEXT_MANIFEST_INVALID",
      "Stored context manifest does not satisfy its schema.",
      ExitCode.data,
      { issues: parsed.error.issues },
    );
  }
  const manifest = parsed.data;
  if (canonicalDigest(manifest as unknown as JsonValue) !== run.contextDigest) {
    throw new MillError(
      "CONTEXT_MANIFEST_DRIFT",
      "Stored context manifest digest does not match.",
      ExitCode.configuration,
    );
  }
  return manifest;
}

function storedReviewFindings(
  run: RunRecord,
): ReturnType<typeof reviewResultSchema.parse>["findings"] | undefined {
  const source =
    run.blockCode === "REMOTE_REVIEW_FINDINGS"
      ? run.remoteFeedbackJson
      : run.blockCode === "REVIEW_FINDINGS" ||
          run.blockCode === "REVIEW_NON_CONVERGENCE"
        ? run.reviewJson
        : undefined;
  if (source === undefined) return undefined;
  try {
    const parsed = reviewResultSchema.safeParse(JSON.parse(source));
    if (
      !parsed.success ||
      parsed.data.candidateCommit !== run.candidateCommit
    ) {
      throw parsed.success
        ? new Error("candidate identity mismatch")
        : parsed.error;
    }
    return parsed.data.findings;
  } catch (error) {
    throw new MillError(
      "REVIEW_EVIDENCE_INVALID",
      "Stored local or remote review evidence is invalid or bound to another candidate.",
      ExitCode.data,
      { cause: String(error) },
    );
  }
}

function storedGitControl(run: RunRecord): GitControlSnapshot {
  if (run.controlJson === undefined) {
    throw new MillError(
      "GIT_CONTROL_SNAPSHOT_MISSING",
      "Run has no frozen Git control snapshot.",
      ExitCode.configuration,
    );
  }
  try {
    const value = JSON.parse(run.controlJson) as Partial<GitControlSnapshot>;
    if (
      value.schemaVersion !== "1" ||
      typeof value.currentRef !== "string" ||
      ![value.commonConfig, value.worktreeConfig, value.infoAttributes].every(
        (item) => item === null || /^sha256:[a-f0-9]{64}$/u.test(String(item)),
      ) ||
      !/^sha256:[a-f0-9]{64}$/u.test(String(value.otherRefs))
    ) {
      throw new Error("snapshot shape invalid");
    }
    return value as GitControlSnapshot;
  } catch (error) {
    throw new MillError(
      "GIT_CONTROL_SNAPSHOT_INVALID",
      "Stored Git control snapshot is invalid.",
      ExitCode.data,
      { cause: String(error) },
    );
  }
}

export async function assertRunBindings(
  root: string,
  run: RunRecord,
  inputs: RuntimeInputs,
): Promise<{
  commit: string;
  tree: string;
  worktree: string;
  manifest: ContextManifest;
}> {
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
  if ((await resolveCommit(root, inputs.task.baseRef)) !== run.baseCommit) {
    throw new MillError(
      "BASE_REF_DRIFT",
      "The approved base reference moved after the run started.",
      ExitCode.configuration,
    );
  }
  if (
    run.worktreePath === undefined ||
    run.candidateCommit === undefined ||
    run.candidateTree === undefined
  ) {
    throw new MillError(
      "CANDIDATE_MISSING",
      "Run has no committed candidate.",
      ExitCode.configuration,
    );
  }
  await assertCandidateIdentity(run.worktreePath, {
    commit: run.candidateCommit,
    tree: run.candidateTree,
  });
  const manifest = storedManifest(run);
  await assertContextFresh(run.worktreePath, manifest);
  await assertGitControlState(run.worktreePath, storedGitControl(run));
  return {
    commit: run.candidateCommit,
    tree: run.candidateTree,
    worktree: run.worktreePath,
    manifest,
  };
}

function safeBlock(store: StateStore, runId: string, error: MillError): void {
  try {
    const run = store.getRun(runId);
    if (isTerminalRun(run.status)) return;
    if (run.status === "blocked") {
      store.replaceBlocker(runId, error.code, "run.blocker_replaced");
      return;
    }
    store.transition(runId, "blocked", "run.blocked", { code: error.code });
  } catch {
    // Preserve the primary error when even failure bookkeeping is unavailable.
  }
}

function settleFailure(
  store: StateStore,
  runId: string,
  error: MillError,
): void {
  try {
    const run = store.getRun(runId);
    const boundary = externalEffectBoundary(run);
    if (boundary.unresolved || boundary.merged) {
      store.recordEvent(runId, "run.reconciliation_required", {
        code: error.code,
      });
      return;
    }
    if (isTerminalRun(run.status)) return;
    if (run.cancelRequested) {
      store.transition(runId, "cancelled", "run.cancelled", {
        code: error.code,
      });
      return;
    }
  } catch {
    // Let safeBlock preserve the primary failure when possible.
  }
  safeBlock(store, runId, error);
}

function assertNotCancelled(store: StateStore, runId: string): void {
  const run = store.getRun(runId);
  if (!run.cancelRequested) return;
  if (!isTerminalRun(run.status)) {
    store.transition(runId, "cancelled", "run.cancelled", {
      code: "OPERATOR_CANCELLED",
    });
  }
  throw new MillError(
    "OPERATOR_CANCELLED",
    "The operator cancelled the active run.",
    ExitCode.temporary,
  );
}

function lifecycleHooks(
  store: StateStore,
  runId: string,
  invocationId?: string,
): {
  onBeforeSpawn(): void;
  onSpawn(process: ActiveProcess): void;
  onExit(process?: ActiveProcess): void;
  cancellationRequested(): boolean;
} {
  return {
    onBeforeSpawn(): void {
      if (invocationId !== undefined) {
        store.markWorkerLaunchStarted(invocationId);
      }
    },
    onSpawn(process): void {
      store.setActiveProcess(runId, process);
    },
    onExit(process): void {
      if (invocationId !== undefined) {
        store.recordWorkerProcessExit(runId, invocationId, process?.id);
      } else if (process !== undefined) {
        store.clearActiveProcess(runId, process.id);
      }
    },
    cancellationRequested(): boolean {
      return store.getRun(runId).cancelRequested;
    },
  };
}

async function admitWorker(input: {
  store: StateStore;
  run: RunRecord;
  inputs: RuntimeInputs;
  manifest: ContextManifest;
  root: string;
  phase: "build" | "repair" | "review";
  role: "builder" | "reviewer";
  attempt: number;
  candidateCommit?: string;
}): Promise<{
  invocationId: string;
  hooks: ReturnType<typeof lifecycleHooks>;
}> {
  const profile = await codexWorkerAdapter.profile(input.root, input.role);
  const admitted = createWorkerInvocation({
    runId: input.run.id,
    phase: input.phase,
    attempt: input.attempt,
    task: input.inputs.task,
    taskDigest: input.inputs.taskDigest,
    manifest: input.manifest,
    baseCommit: input.run.baseCommit,
    ...(input.candidateCommit === undefined
      ? {}
      : { candidateCommit: input.candidateCommit }),
    ...(input.inputs.continuity === undefined
      ? {}
      : { impactManifestDigest: input.inputs.continuity.impactDigest }),
    profile,
    deadlineAt: input.run.deadlineAt,
  });
  input.store.admitWorkerInvocation({
    runId: input.run.id,
    invocationId: admitted.invocation.invocationId,
    phase: input.phase,
    envelopeDigest: admitted.digest,
    envelopeJson: JSON.stringify(admitted.invocation),
  });
  return {
    invocationId: admitted.invocation.invocationId,
    hooks: lifecycleHooks(
      input.store,
      input.run.id,
      admitted.invocation.invocationId,
    ),
  };
}

function settleWorkerFailure(
  store: StateStore,
  invocationId: string,
  role: "builder" | "reviewer",
  error: unknown,
): void {
  if (store.workerInvocationStatus(invocationId) !== "launch_started") return;
  const failure = asMillError(error);
  store.settleWorkerInvocation(
    invocationId,
    role === "builder" ? "uncertain" : "failed",
    {
      code: failure.code,
      ...(role === "builder" ? { processExited: true } : {}),
    },
  );
}

function storedActiveProcess(run: RunRecord): ActiveProcess | undefined {
  if (
    run.activeProcessId === undefined ||
    run.activePid === undefined ||
    run.activeProcessGroup === undefined ||
    run.activeProcessIdentity === undefined
  ) {
    return undefined;
  }
  return {
    id: run.activeProcessId,
    pid: run.activePid,
    processGroup: run.activeProcessGroup,
    identity: run.activeProcessIdentity,
  };
}

function reconcileMutatingWorkerAdmissions(
  store: StateStore,
  run: RunRecord,
  active: ActiveProcess | undefined,
): void {
  const activeStatus =
    active === undefined ? undefined : processIdentityStatus(active);
  if (active !== undefined && activeStatus !== "mismatch") {
    throw new MillError(
      "ORPHANED_EXECUTION_RECONCILIATION_REQUIRED",
      "A recorded execution may still be active without its controller; Mill will not signal it or resume automatically.",
      ExitCode.temporary,
    );
  }
  const unresolved = store.unresolvedMutatingWorkerInvocations(run.id);
  const unobservedLaunches = unresolved.filter(
    (invocation) =>
      invocation.status === "launch_started" && !invocation.processExited,
  );
  if (
    unobservedLaunches.length > 0 &&
    (active === undefined ||
      activeStatus !== "mismatch" ||
      unobservedLaunches.length !== 1)
  ) {
    throw new MillError(
      "WORKER_INVOCATION_RECONCILIATION_REQUIRED",
      "A mutating worker may have started before process identity was durably observed; attended disposition is required.",
      ExitCode.temporary,
      { invocationIds: unobservedLaunches.map((item) => item.invocationId) },
    );
  }
  for (const invocation of unresolved) {
    if (invocation.processExited) {
      store.reconcileWorkerInvocation(
        run.id,
        invocation.invocationId,
        "process_exit_observed",
      );
    } else if (invocation.status === "launch_started") {
      store.reconcileWorkerInvocation(
        run.id,
        invocation.invocationId,
        "recorded_process_absent",
      );
    } else {
      throw new MillError(
        "WORKER_INVOCATION_RECONCILIATION_REQUIRED",
        "An uncertain mutating worker lacks durable process-exit evidence; attended disposition is required.",
        ExitCode.temporary,
        { invocationId: invocation.invocationId },
      );
    }
  }
  store.setActiveProcess(run.id, null);
}

function recordProviderUsage(
  store: StateStore,
  runId: string,
  eventType: string,
  usage: ProviderUsage,
): void {
  store.recordEvent(runId, eventType, {
    usageSource: usage.source,
    costSource: usage.cost,
    inputTokens: usage.inputTokens ?? null,
    outputTokens: usage.outputTokens ?? null,
    cacheInputTokens: usage.cacheInputTokens ?? null,
  });
}

export async function startLocalRun(input: {
  root: string;
  taskPath: string;
  approvalDigest: string;
}): Promise<{
  run: PublicRunRecord;
  usage: {
    source: string;
    cost: string;
    inputTokens?: number;
    outputTokens?: number;
  };
}> {
  const context = await openRunContext(input.root, input.taskPath);
  const { inputs, store } = context;
  let run: RunRecord | undefined;
  let lease: Awaited<ReturnType<typeof acquireWriterLease>> | undefined;
  let provisionalWorktree: string | undefined;
  let provisionalBranch: string | undefined;
  const signals = processCancellationScope();
  try {
    assertNewRunTaskContract(inputs.task);
    const qualified = await qualifyRepositoryForBuild(
      input.root,
      "HEAD",
      inputs.config.sensitivePaths,
    );
    if (inputs.task.baseRef !== "HEAD") {
      const requestedBase = await resolveCommit(
        input.root,
        inputs.task.baseRef,
      );
      if (requestedBase !== qualified.baseCommit) {
        throw new MillError(
          "BASE_REF_NOT_CHECKED_OUT",
          "The approved base must equal the clean checked-out HEAD in Wave 2.",
          ExitCode.configuration,
        );
      }
    }
    lease = await acquireWriterLease(store);
    const activeRuns = store
      .runs()
      .filter((candidate) => !isTerminalRun(candidate.status));
    if (activeRuns.length > 0) {
      throw new MillError(
        "ACTIVE_OUTCOME_CONFLICT",
        "A new run cannot be created while another nonterminal lifecycle exists.",
        ExitCode.configuration,
        {
          activeRuns: activeRuns.map((candidate) => ({
            runId: candidate.id,
            taskId: candidate.taskId,
            status: candidate.status,
          })),
        },
      );
    }
    if (
      !store.hasBaselineQualification({
        approvalDigest: input.approvalDigest,
        repositoryId: inputs.config.repositoryId,
        taskDigest: inputs.taskDigest,
        configDigest: inputs.configDigest,
        baseCommit: qualified.baseCommit,
      })
    ) {
      throw new MillError(
        "TASK_APPROVAL_REQUIRED",
        "Run requires an approval digest from a successful matching baseline qualification.",
        ExitCode.configuration,
      );
    }
    run = store.createRun({
      repositoryId: inputs.config.repositoryId,
      taskId: inputs.task.id,
      taskDigest: inputs.taskDigest,
      configDigest: inputs.configDigest,
      baseCommit: qualified.baseCommit,
      deadlineAt: new Date(
        operationDeadline(inputs.task.budget.deadlineSeconds),
      ).toISOString(),
    });
    store.transition(run.id, "ready", "run.ready");
    const worktree = path.join(store.worktreesDirectory, run.id);
    const branch = await createCandidateWorktree(
      input.root,
      worktree,
      qualified.baseCommit,
      inputs.task.id,
      run.id,
    );
    provisionalWorktree = worktree;
    provisionalBranch = branch;
    const frozen = await buildContextManifest(
      worktree,
      qualified.baseCommit,
      inputs.task,
      inputs.config,
      inputs.taskDigest,
    );
    const gitControl = await captureGitControlState(worktree);
    store.setWorkspace(
      run.id,
      worktree,
      frozen.digest,
      JSON.stringify(frozen.manifest),
      JSON.stringify(gitControl),
    );
    provisionalWorktree = undefined;
    provisionalBranch = undefined;
    run = store.transition(run.id, "running", "builder.started");
    store.beginBuilderAttempt(run.id, inputs.task.budget.retryCount + 1);
    run = store.getRun(run.id);
    const admission = await admitWorker({
      store,
      run,
      inputs,
      manifest: frozen.manifest,
      root: worktree,
      phase: "build",
      role: "builder",
      attempt: run.attemptCount,
    });
    let invocation: Awaited<ReturnType<typeof codexWorkerAdapter.runBuilder>>;
    let candidate: Awaited<ReturnType<typeof commitCandidate>>;
    try {
      invocation = await codexWorkerAdapter.runBuilder({
        root: worktree,
        task: inputs.task,
        manifest: frozen.manifest,
        deadlineMs: persistedRunDeadline(run),
        maxOutputBytes: inputs.task.budget.maxOutputBytes,
        signal: signals.signal,
        ...admission.hooks,
      });
      assertNotCancelled(store, run.id);
      await assertGitControlState(worktree, gitControl);
      candidate = await commitCandidate(
        worktree,
        qualified.baseCommit,
        inputs.task,
        inputs.protectedPaths,
      );
      store.commitCandidate(
        run.id,
        candidate.commit,
        candidate.tree,
        admission.invocationId,
      );
    } catch (error) {
      settleWorkerFailure(store, admission.invocationId, "builder", error);
      throw error;
    }
    recordProviderUsage(store, run.id, "builder.completed", invocation.usage);
    const completed = store.getRun(run.id);
    return { run: publicRunRecord(completed), usage: invocation.usage };
  } catch (error) {
    let failure = asMillError(error);
    if (
      run !== undefined &&
      provisionalWorktree !== undefined &&
      provisionalBranch !== undefined
    ) {
      try {
        await removeCandidateWorktree(input.root, provisionalWorktree);
        await deleteCandidateBranch(
          input.root,
          provisionalBranch,
          run.baseCommit,
        );
        const current = store.getRun(run.id);
        if (!isTerminalRun(current.status)) {
          store.transition(run.id, "failed", "workspace.setup_failed", {
            code: failure.code,
          });
        }
      } catch (cleanupError) {
        failure = new MillError(
          "WORKSPACE_SETUP_CLEANUP_FAILED",
          "Candidate workspace setup failed and its provisional Git state could not be removed safely.",
          ExitCode.io,
          {
            primaryCode: failure.code,
            cleanupCause: String(cleanupError),
          },
        );
      }
    }
    if (run !== undefined) {
      settleFailure(store, run.id, failure);
    }
    throw failure;
  } finally {
    signals.dispose();
    try {
      await lease?.release();
    } finally {
      store.close();
    }
  }
}

export async function qualifyBaseline(input: {
  root: string;
  taskPath: string;
  signal?: AbortSignal;
}): Promise<{ approvalDigest: string | null; evidence: ValidationEvidence }> {
  const inputs = await loadRuntimeInputs(input.root, input.taskPath);
  assertNewRunTaskContract(inputs.task);
  assertBuildAuthorized(inputs);
  const signals = processCancellationScope();
  const signal =
    input.signal === undefined
      ? signals.signal
      : AbortSignal.any([signals.signal, input.signal]);
  try {
    const qualified = await qualifyRepositoryForBuild(
      input.root,
      inputs.task.baseRef,
      inputs.config.sensitivePaths,
    );
    const store = await StateStore.open(
      inputs.config.repositoryId,
      qualified.commonDirectory,
    );
    let lease: Awaited<ReturnType<typeof acquireWriterLease>> | undefined;
    const destination = path.join(
      store.worktreesDirectory,
      `baseline-${randomUUID()}`,
    );
    try {
      lease = await acquireWriterLease(store);
      await createDetachedWorktree(
        input.root,
        destination,
        qualified.baseCommit,
      );
      const dependencyRoot = await dependencySnapshotDirectory({
        root: input.root,
        stateDirectory: store.directory,
        config: inputs.config,
      });
      const evidence = await verifyDeclaredCommands({
        root: destination,
        ...(dependencyRoot === undefined ? {} : { dependencyRoot }),
        candidateCommit: qualified.baseCommit,
        config: inputs.config,
        task: inputs.task,
        deadlineMs: operationDeadline(inputs.task.budget.deadlineSeconds),
        maxOutputBytes: inputs.task.budget.maxOutputBytes,
        signal,
      });
      if (!evidence.passed) return { approvalDigest: null, evidence };
      const evidenceDigest = baselineEvidenceDigest(evidence);
      const approvalDigest = baselineApprovalDigest({
        taskDigest: inputs.taskDigest,
        configDigest: inputs.configDigest,
        baseCommit: qualified.baseCommit,
        evidenceDigest,
      });
      store.recordBaselineQualification({
        approvalDigest,
        repositoryId: inputs.config.repositoryId,
        taskDigest: inputs.taskDigest,
        configDigest: inputs.configDigest,
        baseCommit: qualified.baseCommit,
        evidenceDigest,
      });
      return { approvalDigest, evidence };
    } finally {
      try {
        if (lease !== undefined) {
          await removeCandidateWorktree(input.root, destination);
        }
      } finally {
        try {
          await lease?.release();
        } finally {
          store.close();
        }
      }
    }
  } finally {
    signals.dispose();
  }
}

export async function verifyRun(input: {
  root: string;
  taskPath: string;
  runId: string;
}): Promise<{ run: PublicRunRecord; evidence: ValidationEvidence }> {
  const context = await openRunContext(input.root, input.taskPath);
  const { inputs, store } = context;
  let lease: Awaited<ReturnType<typeof acquireWriterLease>> | undefined;
  const signals = processCancellationScope();
  try {
    lease = await acquireWriterLease(store);
    const run = store.getRun(input.runId);
    if (run.status !== "committed") {
      throw new MillError(
        "RUN_NOT_COMMITTED",
        "Only a committed candidate can be verified.",
        ExitCode.configuration,
      );
    }
    const deadlineMs = persistedRunDeadline(run);
    const candidate = await assertRunBindings(input.root, run, inputs);
    const hooks = lifecycleHooks(store, run.id);
    const dependencyRoot = await dependencySnapshotDirectory({
      root: input.root,
      stateDirectory: store.directory,
      config: inputs.config,
    });
    const evidence = await verifyDeclaredCommands({
      root: candidate.worktree,
      ...(dependencyRoot === undefined ? {} : { dependencyRoot }),
      candidateCommit: candidate.commit,
      config: inputs.config,
      task: inputs.task,
      ...(inputs.continuity === undefined
        ? {}
        : {
            impact: inputs.continuity.impact,
            product: inputs.continuity.product,
            scenarios: inputs.continuity.scenarios,
          }),
      deadlineMs,
      maxOutputBytes: inputs.task.budget.maxOutputBytes,
      signal: signals.signal,
      ...hooks,
    });
    assertNotCancelled(store, run.id);
    await resetCandidateWorktree(candidate.worktree, candidate.commit);
    await assertCandidateIdentity(candidate.worktree, candidate);
    return {
      run: publicRunRecord(
        store.completeValidation(
          run.id,
          JSON.stringify(evidence),
          evidence.passed,
        ),
      ),
      evidence,
    };
  } catch (error) {
    const failure = asMillError(error);
    if (lease !== undefined) settleFailure(store, input.runId, failure);
    throw failure;
  } finally {
    signals.dispose();
    try {
      await lease?.release();
    } finally {
      store.close();
    }
  }
}

export async function reviewRun(input: {
  root: string;
  taskPath: string;
  runId: string;
  refresh?: boolean;
  baseCommit?: string;
  attended?: boolean;
}): Promise<{
  run: PublicRunRecord;
  review: ReturnType<typeof reviewResultSchema.parse>;
  usage: ProviderUsage;
}> {
  const context = await openRunContext(input.root, input.taskPath);
  const { inputs, store } = context;
  let lease: Awaited<ReturnType<typeof acquireWriterLease>> | undefined;
  const signals = processCancellationScope();
  let reviewPrepared = false;
  try {
    lease = await acquireWriterLease(store);
    let run = store.getRun(input.runId);
    assertEffectAllowsNewWork(run);
    const deadlineMs = persistedRunDeadline(run);
    if (input.refresh === true) {
      if (input.attended !== true)
        throw new MillError(
          "ATTENDANCE_REQUIRED",
          "Review refresh requires the attended operator.",
          ExitCode.configuration,
        );
      if (
        input.baseCommit === undefined ||
        !/^[a-f0-9]{40}$/u.test(input.baseCommit)
      )
        throw new MillError(
          "REVIEW_BASE_REQUIRED",
          "Review refresh requires an exact locally available base commit.",
          ExitCode.configuration,
        );
      if (run.reviewJson === undefined)
        throw new MillError(
          "REVIEW_REFRESH_UNAVAILABLE",
          "No completed review exists to refresh; resume an already prepared review without --refresh.",
          ExitCode.configuration,
        );
      const candidate = await assertRunBindings(input.root, run, inputs);
      const scope = await captureReviewScope(
        candidate.worktree,
        input.baseCommit,
        candidate.commit,
      );
      run = store.prepareReviewRefresh(
        run.id,
        run.reviewJson,
        scope,
        inputs.task.budget.retryCount + 1,
      );
      reviewPrepared = true;
    } else if (input.baseCommit !== undefined)
      throw new MillError(
        "REVIEW_REFRESH_REQUIRED",
        "An explicit review base requires --refresh and --attended.",
        ExitCode.configuration,
      );
    const retryableReviewBlocks = new Set([
      "CODEX_CANCELLED",
      "CODEX_DEADLINE_EXCEEDED",
      "CODEX_OUTPUT_BUDGET_EXCEEDED",
      "CODEX_EXECUTION_FAILED",
      "CODEX_PROFILE_UNAVAILABLE",
      "INVALID_REVIEW_RESULT",
      "MALFORMED_WORKER_EVENT",
      "WORKER_SETTLEMENT_MISSING",
      "WORKER_SETTLEMENT_CONFLICT",
      "WORKER_RESULT_MISSING",
      "WORKER_RESULT_CONFLICT",
    ]);
    if (
      run.status === "blocked" &&
      run.blockCode !== undefined &&
      retryableReviewBlocks.has(run.blockCode) &&
      run.validationJson !== undefined
    ) {
      run = store.transition(run.id, "verified", "review.retry_ready");
    }
    if (run.status !== "verified" || run.validationJson === undefined) {
      throw new MillError(
        "RUN_NOT_VERIFIED",
        "Only an exact verified candidate can be reviewed.",
        ExitCode.configuration,
      );
    }
    let evidence: ValidationEvidence;
    try {
      const parsed = validationEvidenceSchema.safeParse(
        JSON.parse(run.validationJson),
      );
      if (!parsed.success) throw parsed.error;
      evidence = parsed.data;
    } catch (error) {
      throw new MillError(
        "VALIDATION_EVIDENCE_INVALID",
        "Stored validation evidence is not valid schema-versioned JSON.",
        ExitCode.data,
        { cause: String(error) },
      );
    }
    if (!evidence.passed || evidence.candidateCommit !== run.candidateCommit) {
      throw new MillError(
        "VALIDATION_EVIDENCE_STALE",
        "Validation evidence is missing, failed, or bound to another candidate.",
        ExitCode.configuration,
      );
    }
    const candidate = await assertRunBindings(input.root, run, inputs);
    const refreshedScope = store.reviewRefreshScope(run.id);
    const reviewScope = await captureReviewScope(
      candidate.worktree,
      refreshedScope?.baseCommit ??
        (inputs.config.propose === undefined
          ? run.baseCommit
          : `refs/heads/${inputs.config.propose.baseBranch}`),
      candidate.commit,
    );
    if (
      refreshedScope !== undefined &&
      reviewScope.digest !== refreshedScope.digest
    )
      throw new MillError(
        "REVIEW_SCOPE_STALE",
        "The prepared review scope no longer matches the candidate.",
        ExitCode.configuration,
      );
    const reviewAttempt = store.beginReviewAttempt(
      run.id,
      inputs.task.budget.retryCount + 1,
    );
    reviewPrepared = true;
    const admission = await admitWorker({
      store,
      run,
      inputs,
      manifest: candidate.manifest,
      root: candidate.worktree,
      phase: "review",
      role: "reviewer",
      attempt: reviewAttempt,
      candidateCommit: candidate.commit,
    });
    let result: Awaited<ReturnType<typeof codexWorkerAdapter.runReviewer>>;
    try {
      result = await codexWorkerAdapter.runReviewer({
        root: candidate.worktree,
        task: inputs.task,
        manifest: candidate.manifest,
        candidateCommit: candidate.commit,
        reviewScope,
        deadlineMs,
        maxOutputBytes: inputs.task.budget.maxOutputBytes,
        signal: signals.signal,
        ...admission.hooks,
      });
      assertNotCancelled(store, run.id);
      await assertCandidateIdentity(candidate.worktree, candidate);
      const completed = store.completeReview(
        run.id,
        JSON.stringify(result.review),
        result.review.findings.length,
        run.repairCount >= 1,
        admission.invocationId,
        {
          usageSource: result.usage.source,
          costSource: result.usage.cost,
          inputTokens: result.usage.inputTokens ?? null,
          outputTokens: result.usage.outputTokens ?? null,
        },
      );
      return {
        run: publicRunRecord(completed),
        review: result.review,
        usage: result.usage,
      };
    } catch (error) {
      settleWorkerFailure(store, admission.invocationId, "reviewer", error);
      throw error;
    }
  } catch (error) {
    const failure = asMillError(error);
    if (lease !== undefined && (input.refresh !== true || reviewPrepared))
      settleFailure(store, input.runId, failure);
    throw failure;
  } finally {
    signals.dispose();
    try {
      await lease?.release();
    } finally {
      store.close();
    }
  }
}

export async function resumeRun(input: {
  root: string;
  taskPath: string;
  runId: string;
}): Promise<PublicRunRecord> {
  const context = await openRunContext(input.root, input.taskPath);
  const { inputs, store } = context;
  let lease: Awaited<ReturnType<typeof acquireWriterLease>> | undefined;
  const signals = processCancellationScope();
  try {
    lease = await acquireWriterLease(store);
    let run = store.getRun(input.runId);
    const active = storedActiveProcess(run);
    reconcileMutatingWorkerAdmissions(store, run, active);
    run = store.getRun(run.id);
    assertEffectAllowsNewWork(run);
    if (run.cancelRequested && !isTerminalRun(run.status)) {
      return publicRunRecord(
        store.transition(run.id, "cancelled", "run.cancelled", {
          code: "OPERATOR_CANCELLED",
        }),
      );
    }
    const deadlineMs = persistedRunDeadline(run);
    if (run.status === "running") {
      run = store.transition(run.id, "blocked", "run.interrupted", {
        code: "INTERRUPTED_RUN",
      });
    }
    if (run.status !== "blocked" || run.worktreePath === undefined) {
      throw new MillError(
        "RUN_NOT_RESUMABLE",
        "Only a blocked run with a preserved worktree can resume.",
        ExitCode.configuration,
      );
    }
    const worktreePath = run.worktreePath;
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
    const manifest = storedManifest(run);
    const gitControl = storedGitControl(run);
    await assertGitControlState(worktreePath, gitControl);
    const findings = storedReviewFindings(run) ?? validationRepairFindings(run);
    if (findings !== undefined) {
      if (run.repairCount >= 1) {
        throw new MillError(
          "REVIEW_NON_CONVERGENCE",
          "A second review repair is not permitted.",
          ExitCode.configuration,
        );
      }
      const reviewedCandidate = await assertRunBindings(
        input.root,
        run,
        inputs,
      );
      const base = reviewedCandidate.commit;
      run = store.beginRepair(run.id);
      const admission = await admitWorker({
        store,
        run,
        inputs,
        manifest,
        root: worktreePath,
        phase: "repair",
        role: "builder",
        attempt: run.repairCount,
        candidateCommit: base,
      });
      let invocation: Awaited<ReturnType<typeof codexWorkerAdapter.runBuilder>>;
      let candidate: Awaited<ReturnType<typeof commitCandidate>>;
      try {
        invocation = await codexWorkerAdapter.runBuilder({
          root: worktreePath,
          task: inputs.task,
          manifest,
          repairFindings: findings,
          deadlineMs,
          maxOutputBytes: inputs.task.budget.maxOutputBytes,
          signal: signals.signal,
          ...admission.hooks,
        });
        assertNotCancelled(store, run.id);
        await assertGitControlState(worktreePath, gitControl);
        candidate = await commitCandidate(
          worktreePath,
          base,
          inputs.task,
          inputs.protectedPaths,
        );
        store.commitCandidate(
          run.id,
          candidate.commit,
          candidate.tree,
          admission.invocationId,
        );
      } catch (error) {
        settleWorkerFailure(store, admission.invocationId, "builder", error);
        throw error;
      }
      recordProviderUsage(
        store,
        run.id,
        "repair.builder_completed",
        invocation.usage,
      );
      return publicRunRecord(store.getRun(run.id));
    }
    if (run.candidateCommit !== undefined) {
      throw new MillError(
        "RUN_REQUIRES_HUMAN_DISPOSITION",
        "A blocked committed candidate without review findings cannot be retried automatically.",
        ExitCode.configuration,
      );
    }
    store.beginBuilderAttempt(run.id, inputs.task.budget.retryCount + 1);
    await resetCandidateWorktree(worktreePath, run.baseCommit);
    run = store.transition(run.id, "running", "builder.resumed");
    run = store.getRun(run.id);
    const admission = await admitWorker({
      store,
      run,
      inputs,
      manifest,
      root: worktreePath,
      phase: "build",
      role: "builder",
      attempt: run.attemptCount,
    });
    let invocation: Awaited<ReturnType<typeof codexWorkerAdapter.runBuilder>>;
    let candidate: Awaited<ReturnType<typeof commitCandidate>>;
    try {
      invocation = await codexWorkerAdapter.runBuilder({
        root: worktreePath,
        task: inputs.task,
        manifest,
        deadlineMs,
        maxOutputBytes: inputs.task.budget.maxOutputBytes,
        signal: signals.signal,
        ...admission.hooks,
      });
      assertNotCancelled(store, run.id);
      await assertGitControlState(worktreePath, gitControl);
      candidate = await commitCandidate(
        worktreePath,
        run.baseCommit,
        inputs.task,
        inputs.protectedPaths,
      );
      store.commitCandidate(
        run.id,
        candidate.commit,
        candidate.tree,
        admission.invocationId,
      );
    } catch (error) {
      settleWorkerFailure(store, admission.invocationId, "builder", error);
      throw error;
    }
    recordProviderUsage(
      store,
      run.id,
      "builder.resume_completed",
      invocation.usage,
    );
    return publicRunRecord(store.getRun(run.id));
  } catch (error) {
    const failure = asMillError(error);
    if (lease !== undefined) settleFailure(store, input.runId, failure);
    throw failure;
  } finally {
    signals.dispose();
    try {
      await lease?.release();
    } finally {
      store.close();
    }
  }
}

export async function cancelRun(input: {
  root: string;
  runId: string;
}): Promise<PublicRunRecord> {
  const config = await loadMillConfig(input.root);
  const commonDirectory = await commonGitDirectory(input.root);
  const store = await StateStore.open(config.repositoryId, commonDirectory);
  let lease: Awaited<ReturnType<typeof acquireWriterLease>> | undefined;
  try {
    const run = store.requestCancellation(input.runId);
    try {
      lease = await acquireWriterLease(store);
    } catch (error) {
      if (
        error instanceof MillError &&
        error.code === "WRITER_ALREADY_ACTIVE"
      ) {
        return publicRunRecord(store.getRun(run.id));
      }
      throw error;
    }
    const current = store.getRun(run.id);
    const boundary = externalEffectBoundary(current);
    if (boundary.unresolved || boundary.merged) {
      store.recordEvent(current.id, "run.cancellation_pending", {
        code: boundary.unresolved
          ? "GITHUB_RECONCILIATION_REQUIRED"
          : "MERGE_FINALIZATION_REQUIRED",
      });
      return publicRunRecord(current);
    }
    if (isTerminalRun(current.status)) return publicRunRecord(current);
    const active = storedActiveProcess(current);
    try {
      reconcileMutatingWorkerAdmissions(store, current, active);
    } catch (error) {
      const failure = asMillError(error);
      if (
        failure.code !== "ORPHANED_EXECUTION_RECONCILIATION_REQUIRED" &&
        failure.code !== "WORKER_INVOCATION_RECONCILIATION_REQUIRED"
      ) {
        throw failure;
      }
      store.recordEvent(current.id, "run.cancellation_pending", {
        code: failure.code,
      });
      return publicRunRecord(current);
    }
    return publicRunRecord(
      store.transition(current.id, "cancelled", "run.cancelled", {
        code: "OPERATOR_CANCELLED",
      }),
    );
  } finally {
    try {
      await lease?.release();
    } finally {
      store.close();
    }
  }
}

export async function runStatus(input: {
  root: string;
  runId?: string;
}): Promise<{
  run?: PublicRunRecord;
  interrupted?: boolean;
  reconciliationRequired?: boolean;
  usage?: ReturnType<typeof summarizeUsage>;
  continuation?: ReturnType<typeof continuationPacket>;
}> {
  const config = await loadMillConfig(input.root);
  const commonDirectory = await commonGitDirectory(input.root);
  const store = await StateStore.open(config.repositoryId, commonDirectory);
  let lease: Awaited<ReturnType<typeof acquireWriterLease>> | undefined;
  try {
    const run =
      input.runId === undefined ? store.latestRun() : store.getRun(input.runId);
    if (run === undefined) return {};
    let interrupted = false;
    let reconciliationRequired =
      externalEffectBoundary(run).unresolved ||
      store.unresolvedMutatingWorkerInvocations(run.id).length > 0;
    const active = storedActiveProcess(run);
    let controllerAbsent = false;
    if (
      !isTerminalRun(run.status) &&
      (run.status === "running" || active !== undefined)
    ) {
      try {
        lease = await acquireWriterLease(store);
        controllerAbsent = true;
      } catch (error) {
        if (!(
          error instanceof MillError && error.code === "WRITER_ALREADY_ACTIVE"
        )) {
          throw error;
        }
      }
    }
    if (controllerAbsent) {
      if (
        active !== undefined &&
        processIdentityStatus(active) !== "mismatch"
      ) {
        reconciliationRequired = true;
      } else if (run.status === "running") {
        interrupted = true;
      }
    }
    const publicRun = publicRunRecord(run);
    const usage = summarizeUsage(store.events(run.id));
    const status = {
      run: publicRun,
      usage,
      ...(interrupted ? { interrupted: true } : {}),
      ...(reconciliationRequired ? { reconciliationRequired: true } : {}),
    };
    return {
      ...status,
      continuation: continuationPacket({
        run: publicRun,
        usage,
        ...(interrupted ? { interrupted } : {}),
        ...(reconciliationRequired ? { reconciliationRequired } : {}),
      }),
    };
  } finally {
    try {
      await lease?.release();
    } finally {
      store.close();
    }
  }
}

export async function runInventory(input: {
  root: string;
}): Promise<PublicRunRecord[]> {
  const config = await loadMillConfig(input.root);
  const commonDirectory = await commonGitDirectory(input.root);
  const store = await StateStore.open(config.repositoryId, commonDirectory);
  try {
    return store.runs().map(publicRunRecord);
  } finally {
    store.close();
  }
}

export async function stateBackup(input: { root: string }): Promise<string> {
  const config = await loadMillConfig(input.root);
  const commonDirectory = await commonGitDirectory(input.root);
  const store = await StateStore.open(config.repositoryId, commonDirectory);
  try {
    return await store.backup();
  } finally {
    store.close();
  }
}

export async function stateRestore(input: {
  root: string;
  backupPath: string;
}): Promise<Awaited<ReturnType<typeof restoreStateBackup>>> {
  const config = await loadMillConfig(input.root);
  const commonDirectory = await commonGitDirectory(input.root);
  const store = await StateStore.open(config.repositoryId, commonDirectory);
  let lease: Awaited<ReturnType<typeof acquireWriterLease>> | undefined;
  try {
    lease = await acquireWriterLease(store);
    store.close();
    return await restoreStateBackup(
      config.repositoryId,
      commonDirectory,
      input.backupPath,
    );
  } finally {
    store.close();
    await lease?.release();
  }
}

export async function statePurge(input: {
  root: string;
  confirmation: string;
}): Promise<void> {
  const config = await loadMillConfig(input.root);
  if (input.confirmation !== config.repositoryId) {
    throw new MillError(
      "PURGE_CONFIRMATION_MISMATCH",
      "Purge confirmation does not match the managed repository UUID.",
      ExitCode.configuration,
    );
  }
  const commonDirectory = await commonGitDirectory(input.root);
  const store = await StateStore.open(config.repositoryId, commonDirectory);
  let lease: Awaited<ReturnType<typeof acquireWriterLease>> | undefined;
  let storeClosed = false;
  try {
    lease = await acquireWriterLease(store);
    const runs = store.runs();
    for (const run of runs) assertEffectAllowsNewWork(run);
    const plans = store.authorityPlans();
    if (plans.some((plan) => !isSettledAuthorityPlan(plan)))
      throw new MillError(
        "AUTHORITY_PLANS_BLOCK_PURGE",
        "Commit generated authority and run state reconcile-plans before purge.",
        ExitCode.configuration,
      );
    if (runs.some((run) => !isPurgeSafeRun(run.status))) {
      throw new MillError(
        "ACTIVE_RUNS_BLOCK_PURGE",
        "All runs must be locally reviewed or terminal before state can be purged.",
        ExitCode.configuration,
      );
    }
    for (const plan of plans) {
      const evidence = await verifyAuthorityPlanPurge(
        plan,
        input.root,
        commonDirectory,
      );
      store.beginAuthorityPlanPurge(
        plan.approvalDigest,
        evidence.committedCommit,
      );
    }
    store.close();
    storeClosed = true;
    for (const plan of plans)
      await removeVerifiedAuthorityWorktree(input.root, plan.worktreePath);
    for (const run of runs) {
      if (run.worktreePath !== undefined) {
        await removeCandidateWorktree(input.root, run.worktreePath);
      }
    }
    await purgeRepositoryState(config.repositoryId, commonDirectory);
  } finally {
    if (!storeClosed) store.close();
    await lease?.release();
  }
}

export async function supportBundle(input: {
  root: string;
  runId?: string;
}): Promise<Record<string, unknown>> {
  const config = await loadMillConfig(input.root);
  const commonDirectory = await commonGitDirectory(input.root);
  const store = await StateStore.open(config.repositoryId, commonDirectory);
  try {
    const selected =
      input.runId === undefined ? store.latestRun() : store.getRun(input.runId);
    return {
      schemaVersion: "1",
      millVersion: MILL_VERSION,
      runtime: {
        node: process.versions.node,
        platform: process.platform,
        arch: process.arch,
      },
      repositoryId: config.repositoryId,
      ...(selected === undefined
        ? { run: null, events: [] }
        : {
            run: {
              id: selected.id,
              taskId: selected.taskId,
              status: selected.status,
              baseCommit: selected.baseCommit,
              candidateCommit: selected.candidateCommit ?? null,
              blockCode: selected.blockCode ?? null,
              repairCount: selected.repairCount,
              attemptCount: selected.attemptCount,
            },
            events: store.events(selected.id),
          }),
      redaction:
        "credentials, prompts, model streams, command output, and host paths are excluded",
    };
  } finally {
    store.close();
  }
}

export { codexAuthStatus };
