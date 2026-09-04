import type { z } from "zod";

import { canonicalDigest } from "../contracts/canonical.js";
import {
  deliveryRecordSchema,
  reviewResultSchema,
  validationEvidenceSchema,
} from "../contracts/schemas.js";
import { ExitCode, MillError, asMillError } from "../errors.js";
import {
  createGitHubAdapter,
  type GitHubAdapter,
  type GitHubBinding,
  type GitHubCheck,
  type GitHubFeedback,
  type GitHubObservation,
  type GitHubPullRequest,
  type ProposeConfig,
} from "./github.js";
import { loadRuntimeInputs, type RuntimeInputs } from "./inputs.js";
import { assertRunBindings } from "./lifecycle.js";
import { commonGitDirectory, repositoryRemoteUrl } from "./repository.js";
import {
  acquireWriterLease,
  publicRunRecord,
  StateStore,
  type PublicRunRecord,
  type RunRecord,
} from "./state.js";

export type DeliveryRecord = z.infer<typeof deliveryRecordSchema>;
type RemoteEffect = DeliveryRecord["effects"][number];
const maximumRemoteEffectAttempts = 2;

interface DeliveryContext {
  inputs: RuntimeInputs;
  config: ProposeConfig;
  store: StateStore;
}

function operationDeadline(config: ProposeConfig): number {
  return Date.now() + config.pollTimeoutSeconds * 1000;
}

async function openDeliveryContext(
  root: string,
  taskPath: string,
  authorityMode: "authorize" | "readback" = "authorize",
): Promise<DeliveryContext> {
  const inputs = await loadRuntimeInputs(root, taskPath, authorityMode);
  if (
    inputs.config.trustCeiling !== "propose" ||
    inputs.config.propose === undefined
  ) {
    throw new MillError(
      "PROPOSE_NOT_AUTHORIZED",
      "mill.yaml does not grant the propose trust ceiling and exact GitHub policy.",
      ExitCode.configuration,
    );
  }
  const commonDirectory = await commonGitDirectory(root);
  return {
    inputs,
    config: inputs.config.propose,
    store: await StateStore.open(inputs.config.repositoryId, commonDirectory),
  };
}

function storedDelivery(run: RunRecord): DeliveryRecord {
  if (run.deliveryJson === undefined) {
    throw new MillError(
      "DELIVERY_PLAN_MISSING",
      "Run has no approved draft-PR delivery plan.",
      ExitCode.configuration,
    );
  }
  try {
    return deliveryRecordSchema.parse(JSON.parse(run.deliveryJson));
  } catch (error) {
    throw new MillError(
      "DELIVERY_RECORD_INVALID",
      "Stored draft-PR delivery state is invalid.",
      ExitCode.data,
      { cause: String(error) },
    );
  }
}

function persistDelivery(
  store: StateStore,
  runId: string,
  value: DeliveryRecord,
  eventType: string,
  details: Record<string, string | number | boolean | null> = {},
): DeliveryRecord {
  const parsed = deliveryRecordSchema.parse({
    ...value,
    updatedAt: new Date().toISOString(),
  });
  store.setDelivery(runId, JSON.stringify(parsed), eventType, details);
  return parsed;
}

function cancellationRequested(store: StateStore, runId: string): boolean {
  return store.getRun(runId).cancelRequested;
}

function stopCancelledDelivery(
  store: StateStore,
  runId: string,
  delivery: DeliveryRecord,
): never {
  const current = store.getRun(runId);
  if (!current.cancelRequested) {
    throw new MillError(
      "CANCELLATION_STATE_INVALID",
      "Remote delivery cancellation was requested without durable state.",
      ExitCode.data,
    );
  }
  persistDelivery(
    store,
    runId,
    { ...delivery, state: "cancelled", lastErrorCode: "OPERATOR_CANCELLED" },
    "delivery.cancelled",
  );
  if (current.status !== "cancelled") {
    store.transition(runId, "cancelled", "run.cancelled", {
      code: "OPERATOR_CANCELLED",
    });
  }
  throw new MillError(
    "OPERATOR_CANCELLED",
    "The operator cancelled remote delivery before another external effect.",
    ExitCode.temporary,
  );
}

function assertRemoteMutationNotCancelled(
  store: StateStore,
  runId: string,
  delivery: DeliveryRecord,
): void {
  if (cancellationRequested(store, runId)) {
    stopCancelledDelivery(store, runId, delivery);
  }
}

function setRunBlocker(
  store: StateStore,
  run: RunRecord,
  code: string,
  eventType: string,
  details: Record<string, string | number | boolean | null> = {},
): RunRecord {
  return run.status === "blocked"
    ? store.replaceBlocker(run.id, code, eventType, details)
    : store.transition(run.id, "blocked", eventType, { code, ...details });
}

function reconcileAbsentEffect(
  store: StateStore,
  run: RunRecord,
  delivery: DeliveryRecord,
  effectValue: RemoteEffect,
): { run: PublicRunRecord; delivery: DeliveryRecord } {
  if (cancellationRequested(store, run.id)) {
    stopCancelledDelivery(store, run.id, delivery);
  }
  if (effectValue.attemptCount >= maximumRemoteEffectAttempts) {
    const blocked = persistDelivery(
      store,
      run.id,
      {
        ...upsertEffect(delivery, {
          ...effectValue,
          status: "blocked",
          errorCode: "REMOTE_EFFECT_RETRY_EXHAUSTED",
          updatedAt: new Date().toISOString(),
        }),
        state: "blocked",
        lastErrorCode: "REMOTE_EFFECT_RETRY_EXHAUSTED",
      },
      "delivery.retry_exhausted",
      { effectId: effectValue.id },
    );
    const blockedRun = setRunBlocker(
      store,
      run,
      "REMOTE_EFFECT_RETRY_EXHAUSTED",
      "delivery.blocked",
    );
    return { run: publicRunRecord(blockedRun), delivery: blocked };
  }
  const retryable = persistDelivery(
    store,
    run.id,
    {
      ...upsertEffect(delivery, {
        ...effectValue,
        status: "retryable_absent",
        errorCode: null,
        updatedAt: new Date().toISOString(),
      }),
      state: "proposing",
      lastErrorCode: null,
    },
    "delivery.effect_absent",
    { effectId: effectValue.id, attemptCount: effectValue.attemptCount },
  );
  const retryableRun = store.transition(
    run.id,
    "proposing",
    "delivery.retry_authorized",
  );
  return { run: publicRunRecord(retryableRun), delivery: retryable };
}

async function assertReviewedCandidate(
  root: string,
  run: RunRecord,
  inputs: RuntimeInputs,
): Promise<{ commit: string; tree: string }> {
  if (run.status !== "reviewed" && run.status !== "proposing") {
    throw new MillError(
      "RUN_NOT_REVIEWED",
      "Only an exact locally reviewed candidate may enter draft-PR delivery.",
      ExitCode.configuration,
    );
  }
  if (run.validationJson === undefined || run.reviewJson === undefined) {
    throw new MillError(
      "LOCAL_EVIDENCE_MISSING",
      "Draft-PR delivery requires exact validation and local review evidence.",
      ExitCode.configuration,
    );
  }
  let validation: z.infer<typeof validationEvidenceSchema>;
  let review: z.infer<typeof reviewResultSchema>;
  try {
    validation = validationEvidenceSchema.parse(JSON.parse(run.validationJson));
    review = reviewResultSchema.parse(JSON.parse(run.reviewJson));
  } catch (error) {
    throw new MillError(
      "LOCAL_EVIDENCE_INVALID",
      "Stored validation or local review evidence is invalid.",
      ExitCode.data,
      { cause: String(error) },
    );
  }
  if (
    !validation.passed ||
    validation.candidateCommit !== run.candidateCommit ||
    review.candidateCommit !== run.candidateCommit ||
    review.findings.length > 0
  ) {
    throw new MillError(
      "LOCAL_EVIDENCE_STALE",
      "Validation and local review must pass on the exact candidate head.",
      ExitCode.configuration,
    );
  }
  const candidate = await assertRunBindings(root, run, inputs);
  return { commit: candidate.commit, tree: candidate.tree };
}

function expectedRemoteUrls(
  config: ProposeConfig,
  cloneUrl: string,
): Set<string> {
  return new Set([
    cloneUrl,
    `git@${config.host}:${config.owner}/${config.repository}.git`,
    `ssh://git@${config.host}/${config.owner}/${config.repository}.git`,
  ]);
}

async function assertBinding(
  root: string,
  config: ProposeConfig,
  binding: GitHubBinding,
): Promise<void> {
  const expectedFullName = `${config.owner}/${config.repository}`;
  const remote = await repositoryRemoteUrl(root, config.remoteName);
  if (
    binding.repositoryNodeId !== config.repositoryNodeId ||
    binding.fullName !== expectedFullName ||
    binding.defaultBranch !== config.baseBranch ||
    binding.fork ||
    !config.allowedActors.includes(binding.actorLogin) ||
    !expectedRemoteUrls(config, binding.cloneUrl).has(remote)
  ) {
    throw new MillError(
      "GITHUB_BINDING_MISMATCH",
      "The live actor, repository, default branch, node identity, or local remote does not match mill.yaml.",
      ExitCode.configuration,
      {
        actorLogin: binding.actorLogin,
        fullName: binding.fullName,
        repositoryNodeId: binding.repositoryNodeId,
      },
    );
  }
}

function branchName(config: ProposeConfig, run: RunRecord): string {
  return `${config.branchPrefix}${run.taskId.slice(0, 32)}-${run.id.slice(0, 8)}`;
}

function target(
  config: ProposeConfig,
  binding: GitHubBinding,
): DeliveryRecord["target"] {
  return {
    forge: "github",
    host: config.host,
    owner: config.owner,
    repository: config.repository,
    repositoryNodeId: binding.repositoryNodeId,
    cloneUrl: binding.cloneUrl,
    remoteName: config.remoteName,
    baseBranch: config.baseBranch,
    actorLogin: binding.actorLogin,
    actorId: binding.actorId,
  };
}

function postMergeRequiredChecks(config: ProposeConfig): string[] {
  return config.postMergeRequiredChecks ?? config.requiredChecks;
}

function isCheckSubset(
  candidate: readonly string[],
  required: readonly string[],
): boolean {
  return candidate.every((check) => required.includes(check));
}

function proposalDigest(input: {
  run: RunRecord;
  candidate: { commit: string; tree: string };
  target: DeliveryRecord["target"];
  branchName: string;
  approvalExpiresAt: string;
  config: ProposeConfig;
}): string {
  return canonicalDigest({
    schemaVersion: "1",
    runId: input.run.id,
    taskDigest: input.run.taskDigest,
    configDigest: input.run.configDigest,
    candidateCommit: input.candidate.commit,
    candidateTree: input.candidate.tree,
    target: input.target,
    branchName: input.branchName,
    approvalExpiresAt: input.approvalExpiresAt,
    requiredChecks: input.config.requiredChecks,
    postMergeRequiredChecks: postMergeRequiredChecks(input.config),
    reviewPolicy: input.config.reviewPolicy,
    allowedMergeMethods: input.config.allowedMergeMethods,
    allowedMergerLogins: input.config.allowedMergerLogins,
    effects: ["push_exact_candidate", "create_draft_pull_request"],
  });
}

function effectId(
  deliveryKey: string,
  kind: RemoteEffect["kind"],
  candidateCommit: string,
): string {
  return canonicalDigest({
    schemaVersion: "1",
    deliveryKey,
    kind,
    candidateCommit,
  });
}

function effect(
  delivery: DeliveryRecord,
  kind: RemoteEffect["kind"],
  candidateCommit: string,
): RemoteEffect | undefined {
  return delivery.effects.find(
    (item) => item.id === effectId(delivery.deliveryKey, kind, candidateCommit),
  );
}

function upsertEffect(
  delivery: DeliveryRecord,
  value: RemoteEffect,
): DeliveryRecord {
  return {
    ...delivery,
    effects: [
      ...delivery.effects.filter((item) => item.id !== value.id),
      value,
    ],
  };
}

function deliveryMarker(deliveryKey: string): string {
  return `<!-- mill-delivery-key:${deliveryKey} -->`;
}

function exactPullRequest(
  pullRequest: GitHubPullRequest,
  delivery: DeliveryRecord,
): boolean {
  return (
    pullRequest.headRef === delivery.branchName &&
    pullRequest.baseRef === delivery.target.baseBranch &&
    pullRequest.body.includes(deliveryMarker(delivery.deliveryKey))
  );
}

function assertExactPullRequest(
  pullRequest: GitHubPullRequest,
  delivery: DeliveryRecord,
  requireDraft: boolean,
): void {
  const recorded = delivery.pullRequest;
  if (
    !exactPullRequest(pullRequest, delivery) ||
    (recorded !== null &&
      (pullRequest.number !== recorded.number ||
        pullRequest.nodeId !== recorded.nodeId)) ||
    pullRequest.headSha !== delivery.candidateCommit ||
    pullRequest.state !== "open" ||
    (requireDraft && !pullRequest.draft)
  ) {
    throw new MillError(
      "PULL_REQUEST_IDENTITY_MISMATCH",
      "GitHub pull request identity does not match the exact delivery plan.",
      ExitCode.configuration,
    );
  }
}

function assertPushBoundaryPullRequest(
  pullRequest: GitHubPullRequest | null,
  delivery: DeliveryRecord,
  expectedOldCommit: string | null,
): void {
  const recorded = delivery.pullRequest;
  if (recorded === null) {
    if (pullRequest !== null) {
      throw new MillError(
        "PULL_REQUEST_IDENTITY_MISMATCH",
        "An unrecorded pull request conflicts with the push boundary readback.",
        ExitCode.configuration,
      );
    }
    return;
  }
  if (
    pullRequest === null ||
    !exactPullRequest(pullRequest, delivery) ||
    pullRequest.number !== recorded.number ||
    pullRequest.nodeId !== recorded.nodeId ||
    pullRequest.headSha !== expectedOldCommit ||
    pullRequest.state !== "open" ||
    !pullRequest.draft
  ) {
    throw new MillError(
      "PULL_REQUEST_IDENTITY_MISMATCH",
      "The recorded pull request is no longer the expected open draft at the observed branch head.",
      ExitCode.configuration,
    );
  }
}

function assertDeliveryContinuity(input: {
  run: RunRecord;
  inputs: RuntimeInputs;
  config: ProposeConfig;
  delivery: DeliveryRecord;
  binding: GitHubBinding;
  allowLegacyPostMergePolicy?: boolean;
}): { bindLegacyPostMergePolicy: boolean } {
  const { run, inputs, config, delivery, binding } = input;
  const configuredPostMergeChecks = postMergeRequiredChecks(config);
  const bindLegacyPostMergePolicy =
    input.allowLegacyPostMergePolicy === true &&
    delivery.postMergeRequiredChecks === undefined &&
    delivery.legacyPostMergePolicyConfigDigest === undefined &&
    config.postMergeRequiredChecks !== undefined &&
    isCheckSubset(config.postMergeRequiredChecks, delivery.requiredChecks);
  const hasBoundLegacyPostMergePolicy =
    input.allowLegacyPostMergePolicy === true &&
    delivery.postMergeRequiredChecks !== undefined &&
    delivery.legacyPostMergePolicyConfigDigest === inputs.configDigest;
  const configDigestMatches =
    bindLegacyPostMergePolicy ||
    hasBoundLegacyPostMergePolicy ||
    run.configDigest === inputs.configDigest;
  if (
    run.taskDigest !== inputs.taskDigest ||
    !configDigestMatches ||
    delivery.runId !== run.id ||
    delivery.candidateCommit !== run.candidateCommit ||
    delivery.candidateTree !== run.candidateTree ||
    delivery.target.owner !== config.owner ||
    delivery.target.repository !== config.repository ||
    delivery.target.repositoryNodeId !== config.repositoryNodeId ||
    delivery.target.remoteName !== config.remoteName ||
    delivery.target.baseBranch !== config.baseBranch ||
    delivery.target.actorLogin !== binding.actorLogin ||
    delivery.target.actorId !== binding.actorId ||
    delivery.target.repositoryNodeId !== binding.repositoryNodeId ||
    delivery.target.cloneUrl !== binding.cloneUrl ||
    JSON.stringify(delivery.requiredChecks) !==
      JSON.stringify(config.requiredChecks) ||
    (delivery.postMergeRequiredChecks !== undefined &&
      JSON.stringify(delivery.postMergeRequiredChecks) !==
        JSON.stringify(configuredPostMergeChecks)) ||
    (delivery.legacyPostMergePolicyConfigDigest !== undefined &&
      !hasBoundLegacyPostMergePolicy) ||
    JSON.stringify(delivery.reviewPolicy) !==
      JSON.stringify(config.reviewPolicy) ||
    JSON.stringify(delivery.allowedMergerLogins) !==
      JSON.stringify(config.allowedMergerLogins) ||
    JSON.stringify(delivery.allowedMergeMethods) !==
      JSON.stringify(config.allowedMergeMethods)
  ) {
    throw new MillError(
      "DELIVERY_AUTHORITY_DRIFT",
      "The task, configuration, candidate, actor, or repository changed after delivery approval.",
      ExitCode.configuration,
    );
  }
  return { bindLegacyPostMergePolicy };
}

function checkDecision(
  required: readonly string[],
  checks: readonly GitHubCheck[],
): {
  status: "passed" | "pending" | "failed";
  missing: string[];
  failed: string[];
} {
  const missing: string[] = [];
  const failed: string[] = [];
  let pending = false;
  for (const name of required) {
    const matching = checks.filter((check) => check.name === name);
    if (matching.length === 0) {
      missing.push(name);
      pending = true;
      continue;
    }
    if (
      matching.some(
        (check) => check.status !== "completed" || check.conclusion === null,
      )
    ) {
      pending = true;
      continue;
    }
    if (!matching.every((check) => check.conclusion === "success")) {
      failed.push(name);
    }
  }
  return {
    status: failed.length > 0 ? "failed" : pending ? "pending" : "passed",
    missing,
    failed,
  };
}

function actionableFeedback(
  observation: GitHubObservation,
  reviewPolicy: DeliveryRecord["reviewPolicy"],
  candidateCommit: string,
): GitHubFeedback[] {
  if (reviewPolicy.mode !== "github_required") return [];
  return observation.feedback.filter(
    (item) =>
      item.commitId === candidateCommit &&
      reviewPolicy.requiredReviewerLogins.includes(item.actorLogin) &&
      item.priority !== "P3",
  );
}

function reviewsPassed(
  observation: GitHubObservation,
  reviewPolicy: DeliveryRecord["reviewPolicy"],
  candidateCommit: string,
): boolean {
  if (reviewPolicy.mode === "local_only") return true;
  return reviewPolicy.requiredReviewerLogins.every((login) => {
    const latest = observation.reviews
      .filter(
        (review) =>
          review.actorLogin === login && review.commitId === candidateCommit,
      )
      .at(-1);
    return latest?.state === "APPROVED" || latest?.state === "COMMENTED";
  });
}

function feedbackAsReview(
  candidateCommit: string,
  feedback: readonly GitHubFeedback[],
): z.infer<typeof reviewResultSchema> {
  return reviewResultSchema.parse({
    schemaVersion: "1",
    candidateCommit,
    summary: "GitHub review requires one attended systemic repair.",
    findings: feedback.map((item) => ({
      id: `github-${item.id}`,
      severity: item.priority === "unclassified" ? "P1" : item.priority,
      class: "correctness",
      title:
        item.body.split("\n", 1)[0]?.slice(0, 200) ?? "GitHub review finding",
      body: `${item.body}\n\nSource: ${item.url}`,
      file: item.path,
      line: item.line,
    })),
  });
}

async function reconcileReadback(input: {
  adapter: GitHubAdapter;
  config: ProposeConfig;
  delivery: DeliveryRecord;
  deadlineMs: number;
  signal?: AbortSignal;
}): Promise<{
  branchSha: string | null;
  pullRequest: GitHubPullRequest | null;
}> {
  const [branchSha, pullRequests] = await Promise.all([
    input.adapter.readBranch({
      config: input.config,
      branch: input.delivery.branchName,
      deadlineMs: input.deadlineMs,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    }),
    input.adapter.findPullRequests({
      config: input.config,
      branch: input.delivery.branchName,
      deadlineMs: input.deadlineMs,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    }),
  ]);
  const matching = pullRequests.filter((item) =>
    exactPullRequest(item, input.delivery),
  );
  if (matching.length > 1) {
    throw new MillError(
      "DUPLICATE_PULL_REQUESTS",
      "More than one pull request carries the immutable delivery identity.",
      ExitCode.configuration,
    );
  }
  return { branchSha, pullRequest: matching[0] ?? null };
}

export async function planDraftPr(input: {
  root: string;
  taskPath: string;
  runId: string;
  adapter?: GitHubAdapter;
  signal?: AbortSignal;
}): Promise<{ run: PublicRunRecord; delivery: DeliveryRecord }> {
  const context = await openDeliveryContext(input.root, input.taskPath);
  const { inputs, config, store } = context;
  let lease: Awaited<ReturnType<typeof acquireWriterLease>> | undefined;
  try {
    lease = await acquireWriterLease(store);
    const run = store.getRun(input.runId);
    const candidate = await assertReviewedCandidate(input.root, run, inputs);
    const adapter = input.adapter ?? createGitHubAdapter(input.root);
    const binding = await adapter.inspect({
      config,
      deadlineMs: operationDeadline(config),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    await assertBinding(input.root, config, binding);
    const plannedBranch = branchName(config, run);
    const approvalExpiresAt = new Date(
      Date.now() + config.approvalTtlSeconds * 1000,
    ).toISOString();
    const plannedTarget = target(config, binding);
    const existing =
      run.deliveryJson === undefined ? undefined : storedDelivery(run);
    const deliveryKey =
      existing?.deliveryKey ??
      canonicalDigest({
        schemaVersion: "1",
        repositoryId: inputs.config.repositoryId,
        runId: run.id,
        repositoryNodeId: binding.repositoryNodeId,
        branchName: plannedBranch,
      });
    const now = new Date().toISOString();
    const delivery = deliveryRecordSchema.parse({
      schemaVersion: "1",
      runId: run.id,
      deliveryKey,
      proposalDigest: proposalDigest({
        run,
        candidate,
        target: plannedTarget,
        branchName: plannedBranch,
        approvalExpiresAt,
        config,
      }),
      approvalExpiresAt,
      state: "planned",
      target: plannedTarget,
      branchName: plannedBranch,
      candidateCommit: candidate.commit,
      candidateTree: candidate.tree,
      requiredChecks: config.requiredChecks,
      postMergeRequiredChecks: postMergeRequiredChecks(config),
      reviewPolicy: config.reviewPolicy,
      allowedMergerLogins: config.allowedMergerLogins,
      allowedMergeMethods: config.allowedMergeMethods,
      effects: existing?.effects ?? [],
      remoteHeadCommit: existing?.remoteHeadCommit ?? null,
      pullRequest: existing?.pullRequest ?? null,
      observation: null,
      merge: null,
      lastErrorCode: null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    const persisted = persistDelivery(
      store,
      run.id,
      delivery,
      "delivery.planned",
      { candidateCommit: candidate.commit, deliveryKey },
    );
    const updatedRun =
      run.status === "reviewed"
        ? store.transition(run.id, "proposing", "delivery.awaiting_approval")
        : store.getRun(run.id);
    return { run: publicRunRecord(updatedRun), delivery: persisted };
  } finally {
    try {
      await lease?.release();
    } finally {
      store.close();
    }
  }
}

function markUnknown(
  store: StateStore,
  run: RunRecord,
  delivery: DeliveryRecord,
  effectValue: RemoteEffect,
  code: string,
): never {
  const unknown = persistDelivery(
    store,
    run.id,
    {
      ...upsertEffect(delivery, {
        ...effectValue,
        status: "effect_unknown",
        errorCode: code,
        updatedAt: new Date().toISOString(),
      }),
      state: "effect_unknown",
      lastErrorCode: code,
    },
    "delivery.effect_unknown",
    { effectId: effectValue.id, code },
  );
  const current = store.getRun(run.id);
  if (current.status !== "effect_unknown") {
    store.transition(
      run.id,
      "effect_unknown",
      "delivery.reconciliation_required",
      {
        code,
      },
    );
  }
  throw new MillError(
    code,
    "A GitHub effect has an unknown outcome; run pr reconcile before any further mutation.",
    ExitCode.temporary,
    { deliveryKey: unknown.deliveryKey, effectId: effectValue.id },
  );
}

export async function openDraftPr(input: {
  root: string;
  taskPath: string;
  runId: string;
  approvalDigest: string;
  attended: boolean;
  adapter?: GitHubAdapter;
  signal?: AbortSignal;
}): Promise<{ run: PublicRunRecord; delivery: DeliveryRecord }> {
  if (!input.attended) {
    throw new MillError(
      "ATTENDED_ACKNOWLEDGEMENT_REQUIRED",
      "Draft-PR mutation requires an explicit attended acknowledgement.",
      ExitCode.configuration,
    );
  }
  const context = await openDeliveryContext(input.root, input.taskPath);
  const { inputs, config, store } = context;
  let lease: Awaited<ReturnType<typeof acquireWriterLease>> | undefined;
  try {
    lease = await acquireWriterLease(store);
    let run = store.getRun(input.runId);
    if (run.status !== "proposing") {
      throw new MillError(
        "DELIVERY_NOT_APPLICABLE",
        "Draft-PR open requires an approved plan with no unknown external effect.",
        ExitCode.configuration,
      );
    }
    const candidate = await assertReviewedCandidate(input.root, run, inputs);
    let delivery = storedDelivery(run);
    assertRemoteMutationNotCancelled(store, run.id, delivery);
    if (
      delivery.candidateCommit !== candidate.commit ||
      delivery.candidateTree !== candidate.tree ||
      delivery.proposalDigest !== input.approvalDigest ||
      Date.parse(delivery.approvalExpiresAt) <= Date.now()
    ) {
      throw new MillError(
        "DELIVERY_APPROVAL_MISMATCH",
        "Approval is missing, expired, or bound to another candidate or delivery plan.",
        ExitCode.configuration,
      );
    }
    const adapter = input.adapter ?? createGitHubAdapter(input.root);
    const deadlineMs = operationDeadline(config);
    const binding = await adapter.inspect({
      config,
      deadlineMs,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    await assertBinding(input.root, config, binding);
    const liveDigest = proposalDigest({
      run,
      candidate,
      target: target(config, binding),
      branchName: delivery.branchName,
      approvalExpiresAt: delivery.approvalExpiresAt,
      config,
    });
    if (liveDigest !== input.approvalDigest) {
      throw new MillError(
        "DELIVERY_BINDING_DRIFT",
        "Live GitHub identity or proposal policy changed after approval.",
        ExitCode.configuration,
      );
    }
    delivery = persistDelivery(
      store,
      run.id,
      { ...delivery, state: "proposing", lastErrorCode: null },
      "delivery.started",
    );
    let readback = await reconcileReadback({
      adapter,
      config,
      delivery,
      deadlineMs,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    assertPushBoundaryPullRequest(
      readback.pullRequest,
      delivery,
      readback.branchSha,
    );
    let push = effect(delivery, "push", candidate.commit);
    if (readback.branchSha !== candidate.commit) {
      if (
        readback.branchSha !== null &&
        readback.branchSha !== delivery.remoteHeadCommit
      ) {
        throw new MillError(
          "REMOTE_BRANCH_CONFLICT",
          "The Mill delivery branch moved outside the exact expected-head precondition.",
          ExitCode.configuration,
        );
      }
      if (
        push !== undefined &&
        (push.status === "call_started" || push.status === "effect_unknown")
      ) {
        markUnknown(store, run, delivery, push, "GITHUB_PUSH_OUTCOME_UNKNOWN");
      }
      if (push?.status === "verified") {
        throw new MillError(
          "REMOTE_BRANCH_CONFLICT",
          "A previously verified Mill branch no longer has its bound candidate head.",
          ExitCode.configuration,
        );
      }
      if ((push?.attemptCount ?? 0) >= maximumRemoteEffectAttempts) {
        throw new MillError(
          "REMOTE_EFFECT_RETRY_EXHAUSTED",
          "The exact push retry budget is exhausted.",
          ExitCode.configuration,
        );
      }
      push = {
        ...(push ?? {
          id: effectId(delivery.deliveryKey, "push", candidate.commit),
          kind: "push" as const,
          candidateCommit: candidate.commit,
          attemptCount: 0,
          expectedOldCommit: delivery.remoteHeadCommit,
        }),
        status: "intent",
        errorCode: null,
        updatedAt: new Date().toISOString(),
      };
      delivery = persistDelivery(
        store,
        run.id,
        upsertEffect(delivery, push),
        "delivery.push_intent",
        { effectId: push.id },
      );
      readback = await reconcileReadback({
        adapter,
        config,
        delivery,
        deadlineMs,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      if (readback.branchSha !== push.expectedOldCommit) {
        throw new MillError(
          "REMOTE_BRANCH_CONFLICT",
          "The Mill delivery branch changed after push intent and before the mutation boundary.",
          ExitCode.configuration,
        );
      }
      assertPushBoundaryPullRequest(
        readback.pullRequest,
        delivery,
        push.expectedOldCommit,
      );
      push = {
        ...push,
        status: "call_started",
        attemptCount: push.attemptCount + 1,
        updatedAt: new Date().toISOString(),
      };
      delivery = persistDelivery(
        store,
        run.id,
        upsertEffect(delivery, push),
        "delivery.push_started",
        { effectId: push.id },
      );
      assertRemoteMutationNotCancelled(store, run.id, delivery);
      try {
        await adapter.pushExact({
          root: input.root,
          config,
          cloneUrl: delivery.target.cloneUrl,
          branch: delivery.branchName,
          candidateCommit: candidate.commit,
          expectedOldCommit: push.expectedOldCommit,
          deadlineMs,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
          cancellationRequested: () => cancellationRequested(store, run.id),
        });
      } catch (error) {
        const failure = asMillError(error);
        try {
          readback = await reconcileReadback({
            adapter,
            config,
            delivery,
            deadlineMs,
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          });
        } catch {
          markUnknown(store, run, delivery, push, failure.code);
        }
        if (readback.branchSha !== candidate.commit) {
          markUnknown(store, run, delivery, push, failure.code);
        }
      }
      readback = await reconcileReadback({
        adapter,
        config,
        delivery,
        deadlineMs,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      assertPushBoundaryPullRequest(
        readback.pullRequest,
        delivery,
        readback.branchSha,
      );
      if (readback.branchSha !== candidate.commit) {
        markUnknown(
          store,
          run,
          delivery,
          push,
          "GITHUB_PUSH_READBACK_MISMATCH",
        );
      }
    }
    if (push === undefined) {
      push = {
        id: effectId(delivery.deliveryKey, "push", candidate.commit),
        kind: "push",
        candidateCommit: candidate.commit,
        status: "verified",
        attemptCount: 0,
        expectedOldCommit: delivery.remoteHeadCommit,
        errorCode: null,
        updatedAt: new Date().toISOString(),
      };
    } else {
      push = {
        ...push,
        status: "verified",
        errorCode: null,
        updatedAt: new Date().toISOString(),
      };
    }
    delivery = persistDelivery(
      store,
      run.id,
      {
        ...upsertEffect(delivery, push),
        remoteHeadCommit: candidate.commit,
      },
      "delivery.push_verified",
      { effectId: push.id, candidateCommit: candidate.commit },
    );
    assertRemoteMutationNotCancelled(store, run.id, delivery);
    readback = await reconcileReadback({
      adapter,
      config,
      delivery,
      deadlineMs,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    let pullRequest = readback.pullRequest;
    let prEffect = effect(delivery, "pull_request", candidate.commit);
    if (pullRequest === null && delivery.pullRequest !== null) {
      throw new MillError(
        "PULL_REQUEST_DISAPPEARED",
        "The recorded pull request cannot be found by immutable delivery identity.",
        ExitCode.configuration,
      );
    }
    if (pullRequest === null) {
      if (
        prEffect !== undefined &&
        (prEffect.status === "call_started" ||
          prEffect.status === "effect_unknown")
      ) {
        markUnknown(
          store,
          run,
          delivery,
          prEffect,
          "GITHUB_PR_OUTCOME_UNKNOWN",
        );
      }
      if (prEffect?.status === "verified" || delivery.pullRequest !== null) {
        throw new MillError(
          "PULL_REQUEST_DISAPPEARED",
          "A previously verified pull request cannot be found by immutable delivery identity.",
          ExitCode.configuration,
        );
      }
      if ((prEffect?.attemptCount ?? 0) >= maximumRemoteEffectAttempts) {
        throw new MillError(
          "REMOTE_EFFECT_RETRY_EXHAUSTED",
          "The draft pull-request retry budget is exhausted.",
          ExitCode.configuration,
        );
      }
      prEffect = {
        ...(prEffect ?? {
          id: effectId(delivery.deliveryKey, "pull_request", candidate.commit),
          kind: "pull_request" as const,
          candidateCommit: candidate.commit,
          attemptCount: 0,
          expectedOldCommit: null,
        }),
        status: "intent",
        errorCode: null,
        updatedAt: new Date().toISOString(),
      };
      delivery = persistDelivery(
        store,
        run.id,
        upsertEffect(delivery, prEffect),
        "delivery.pull_request_intent",
        { effectId: prEffect.id },
      );
      prEffect = {
        ...prEffect,
        status: "call_started",
        attemptCount: prEffect.attemptCount + 1,
        updatedAt: new Date().toISOString(),
      };
      delivery = persistDelivery(
        store,
        run.id,
        upsertEffect(delivery, prEffect),
        "delivery.pull_request_started",
        { effectId: prEffect.id },
      );
      assertRemoteMutationNotCancelled(store, run.id, delivery);
      try {
        pullRequest = await adapter.createDraftPullRequest({
          config,
          branch: delivery.branchName,
          title: inputs.task.commit.message.slice(0, 240),
          body: `${deliveryMarker(delivery.deliveryKey)}\n\nGenerated by Mill from an attended, locally validated and reviewed run. The current candidate identity is the pull-request head; configured human merge authority remains external.`,
          deadlineMs,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
          cancellationRequested: () => cancellationRequested(store, run.id),
        });
      } catch (error) {
        const failure = asMillError(error);
        try {
          readback = await reconcileReadback({
            adapter,
            config,
            delivery,
            deadlineMs,
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          });
          pullRequest = readback.pullRequest;
        } catch {
          markUnknown(store, run, delivery, prEffect, failure.code);
        }
        if (pullRequest === null) {
          markUnknown(store, run, delivery, prEffect, failure.code);
        }
      }
      assertExactPullRequest(pullRequest, delivery, true);
      prEffect = {
        ...prEffect,
        status: "verified",
        errorCode: null,
        updatedAt: new Date().toISOString(),
      };
      delivery = upsertEffect(delivery, prEffect);
    } else {
      assertExactPullRequest(pullRequest, delivery, true);
      prEffect = {
        ...(prEffect ?? {
          id: effectId(delivery.deliveryKey, "pull_request", candidate.commit),
          kind: "pull_request" as const,
          candidateCommit: candidate.commit,
          attemptCount: 0,
          expectedOldCommit: null,
        }),
        status: "verified",
        errorCode: null,
        updatedAt: new Date().toISOString(),
      };
      delivery = upsertEffect(delivery, prEffect);
    }
    delivery = persistDelivery(
      store,
      run.id,
      {
        ...delivery,
        state: "awaiting_ci",
        pullRequest: {
          number: pullRequest.number,
          nodeId: pullRequest.nodeId,
          url: pullRequest.url,
        },
        observation: null,
        lastErrorCode: null,
      },
      "delivery.pull_request_verified",
      { pullRequestNumber: pullRequest.number },
    );
    assertRemoteMutationNotCancelled(store, run.id, delivery);
    run = store.getRun(run.id);
    if (run.status !== "awaiting_ci") {
      run = store.transition(run.id, "awaiting_ci", "delivery.awaiting_ci");
    }
    return { run: publicRunRecord(run), delivery };
  } finally {
    try {
      await lease?.release();
    } finally {
      store.close();
    }
  }
}

export async function reconcileDraftPr(input: {
  root: string;
  taskPath: string;
  runId: string;
  adapter?: GitHubAdapter;
  signal?: AbortSignal;
}): Promise<{ run: PublicRunRecord; delivery: DeliveryRecord }> {
  const context = await openDeliveryContext(
    input.root,
    input.taskPath,
    "readback",
  );
  const { inputs, config, store } = context;
  let lease: Awaited<ReturnType<typeof acquireWriterLease>> | undefined;
  try {
    lease = await acquireWriterLease(store);
    let run = store.getRun(input.runId);
    if (run.status !== "effect_unknown") {
      throw new MillError(
        "RECONCILIATION_NOT_REQUIRED",
        "The run has no unknown GitHub effect to reconcile.",
        ExitCode.configuration,
      );
    }
    let delivery = storedDelivery(run);
    const adapter = input.adapter ?? createGitHubAdapter(input.root);
    const deadlineMs = operationDeadline(config);
    const binding = await adapter.inspect({
      config,
      deadlineMs,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    await assertBinding(input.root, config, binding);
    assertDeliveryContinuity({ run, inputs, config, delivery, binding });
    const readback = await reconcileReadback({
      adapter,
      config,
      delivery,
      deadlineMs,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    const unknownEffects = delivery.effects.filter(
      (item) => item.status === "effect_unknown",
    );
    if (unknownEffects.length !== 1) {
      throw new MillError(
        "GITHUB_RECONCILIATION_STATE_INVALID",
        "Exactly one external effect must be unknown before reconciliation.",
        ExitCode.data,
      );
    }
    const unknownEffect = unknownEffects[0];
    if (unknownEffect === undefined) {
      throw new MillError(
        "GITHUB_RECONCILIATION_STATE_INVALID",
        "The unknown external effect could not be identified.",
        ExitCode.data,
      );
    }
    if (
      unknownEffect.kind === "push" &&
      (readback.branchSha === unknownEffect.expectedOldCommit ||
        readback.branchSha === delivery.candidateCommit)
    ) {
      assertPushBoundaryPullRequest(
        readback.pullRequest,
        delivery,
        readback.branchSha,
      );
    }
    let effectAbsent = false;
    if (unknownEffect.kind === "pull_request") {
      effectAbsent =
        readback.pullRequest === null &&
        readback.branchSha === delivery.candidateCommit;
    } else if (readback.branchSha === unknownEffect.expectedOldCommit) {
      effectAbsent = true;
    }
    if (effectAbsent) {
      return reconcileAbsentEffect(store, run, delivery, unknownEffect);
    }
    if (
      unknownEffect.kind === "push" &&
      readback.branchSha === delivery.candidateCommit &&
      readback.pullRequest === null
    ) {
      delivery = persistDelivery(
        store,
        run.id,
        {
          ...upsertEffect(delivery, {
            ...unknownEffect,
            status: "verified",
            errorCode: null,
            updatedAt: new Date().toISOString(),
          }),
          state: "proposing",
          remoteHeadCommit: readback.branchSha,
          lastErrorCode: null,
        },
        "delivery.push_reconciled",
        { effectId: unknownEffect.id },
      );
      assertRemoteMutationNotCancelled(store, run.id, delivery);
      run = store.transition(run.id, "proposing", "delivery.reconciled");
      return { run: publicRunRecord(run), delivery };
    }
    if (readback.branchSha !== delivery.candidateCommit) {
      throw new MillError(
        "REMOTE_BRANCH_CONFLICT",
        "Authoritative readback found a branch head outside the reconciled effect precondition.",
        ExitCode.configuration,
      );
    }
    if (readback.pullRequest === null) {
      throw new MillError(
        "GITHUB_RECONCILIATION_STATE_INVALID",
        "Reconciliation could not classify the pull-request effect.",
        ExitCode.data,
      );
    }
    assertExactPullRequest(readback.pullRequest, delivery, true);
    delivery = persistDelivery(
      store,
      run.id,
      {
        ...delivery,
        state: "awaiting_ci",
        remoteHeadCommit: readback.branchSha,
        pullRequest: {
          number: readback.pullRequest.number,
          nodeId: readback.pullRequest.nodeId,
          url: readback.pullRequest.url,
        },
        effects: delivery.effects.map((item) =>
          item.id === unknownEffect.id
            ? {
                ...item,
                status: "verified" as const,
                errorCode: null,
                updatedAt: new Date().toISOString(),
              }
            : item,
        ),
        lastErrorCode: null,
      },
      "delivery.reconciled",
      { pullRequestNumber: readback.pullRequest.number },
    );
    assertRemoteMutationNotCancelled(store, run.id, delivery);
    run = store.transition(run.id, "awaiting_ci", "delivery.awaiting_ci");
    return { run: publicRunRecord(run), delivery };
  } finally {
    try {
      await lease?.release();
    } finally {
      store.close();
    }
  }
}

function assertObservationIdentity(
  observation: GitHubObservation,
  delivery: DeliveryRecord,
  allowDeletedBranch: boolean,
): void {
  const pull = observation.pullRequest;
  if (
    !exactPullRequest(pull, delivery) ||
    pull.number !== delivery.pullRequest?.number ||
    pull.nodeId !== delivery.pullRequest.nodeId ||
    pull.headSha !== delivery.candidateCommit ||
    (!allowDeletedBranch &&
      observation.branchSha !== delivery.candidateCommit) ||
    (allowDeletedBranch &&
      observation.branchSha !== null &&
      observation.branchSha !== delivery.candidateCommit)
  ) {
    throw new MillError(
      "REMOTE_IDENTITY_DRIFT",
      "GitHub branch or pull request identity drifted from the exact delivery record.",
      ExitCode.configuration,
    );
  }
}

export async function observeDraftPr(input: {
  root: string;
  taskPath: string;
  runId: string;
  adapter?: GitHubAdapter;
  signal?: AbortSignal;
}): Promise<{ run: PublicRunRecord; delivery: DeliveryRecord }> {
  const context = await openDeliveryContext(
    input.root,
    input.taskPath,
    "readback",
  );
  const { inputs, config, store } = context;
  let lease: Awaited<ReturnType<typeof acquireWriterLease>> | undefined;
  try {
    lease = await acquireWriterLease(store);
    let run = store.getRun(input.runId);
    if (
      run.status !== "awaiting_ci" &&
      run.status !== "awaiting_human" &&
      !(
        run.status === "blocked" &&
        ["REMOTE_CHECKS_FAILED", "REMOTE_REVIEW_FINDINGS"].includes(
          run.blockCode ?? "",
        )
      )
    ) {
      throw new MillError(
        "DELIVERY_NOT_OBSERVABLE",
        "Run has no draft pull request awaiting policy observation.",
        ExitCode.configuration,
      );
    }
    let delivery = storedDelivery(run);
    if (delivery.pullRequest === null) {
      throw new MillError(
        "PULL_REQUEST_IDENTITY_MISSING",
        "Delivery has no verified pull request identity.",
        ExitCode.configuration,
      );
    }
    const pullRequest = delivery.pullRequest;
    const adapter = input.adapter ?? createGitHubAdapter(input.root);
    const deadlineMs = operationDeadline(config);
    const binding = await adapter.inspect({
      config,
      deadlineMs,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    await assertBinding(input.root, config, binding);
    assertDeliveryContinuity({ run, inputs, config, delivery, binding });
    const observation = await adapter.observe({
      config,
      pullRequestNumber: pullRequest.number,
      deadlineMs,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    assertObservationIdentity(observation, delivery, false);
    const checks = checkDecision(delivery.requiredChecks, observation.checks);
    const feedback = actionableFeedback(
      observation,
      delivery.reviewPolicy,
      delivery.candidateCommit,
    );
    const observationRecord = {
      headSha: observation.pullRequest.headSha,
      branchSha: observation.branchSha,
      checkDecision: checks,
      checks: observation.checks,
      reviews: observation.reviews,
      feedback,
      observedAt: new Date().toISOString(),
    };
    if (feedback.length > 0) {
      store.setRemoteFeedback(
        run.id,
        JSON.stringify(feedbackAsReview(delivery.candidateCommit, feedback)),
      );
      delivery = persistDelivery(
        store,
        run.id,
        {
          ...delivery,
          state: "blocked",
          observation: observationRecord,
          lastErrorCode: "REMOTE_REVIEW_FINDINGS",
        },
        "delivery.remote_review_blocked",
        { findings: feedback.length },
      );
      run = setRunBlocker(
        store,
        run,
        "REMOTE_REVIEW_FINDINGS",
        "delivery.blocked",
      );
      return { run: publicRunRecord(run), delivery };
    }
    if (checks.status === "failed") {
      delivery = persistDelivery(
        store,
        run.id,
        {
          ...delivery,
          state: "blocked",
          observation: observationRecord,
          lastErrorCode: "REMOTE_CHECKS_FAILED",
        },
        "delivery.remote_checks_failed",
        { failed: checks.failed.length },
      );
      run = setRunBlocker(
        store,
        run,
        "REMOTE_CHECKS_FAILED",
        "delivery.blocked",
      );
      return { run: publicRunRecord(run), delivery };
    }
    const ready =
      checks.status === "passed" &&
      reviewsPassed(
        observation,
        delivery.reviewPolicy,
        delivery.candidateCommit,
      );
    const nextState = ready ? "awaiting_human" : "awaiting_ci";
    delivery = persistDelivery(
      store,
      run.id,
      {
        ...delivery,
        state: nextState,
        observation: observationRecord,
        lastErrorCode: null,
      },
      ready ? "delivery.awaiting_human" : "delivery.policy_pending",
    );
    if (run.status === "blocked") {
      run = store.transition(run.id, "awaiting_ci", "delivery.reobserved");
    }
    if (ready && run.status !== "awaiting_human") {
      run = store.transition(
        run.id,
        "awaiting_human",
        "delivery.awaiting_human",
      );
    } else if (!ready && run.status !== "awaiting_ci") {
      run = store.transition(run.id, "awaiting_ci", "delivery.policy_pending");
    }
    return { run: publicRunRecord(run), delivery };
  } finally {
    try {
      await lease?.release();
    } finally {
      store.close();
    }
  }
}

function mergeMethod(
  observation: GitHubObservation,
): "merge" | "linear_tree_preserving" {
  const commit = observation.mergeCommit;
  if (commit === null) {
    throw new MillError(
      "MERGE_COMMIT_MISSING",
      "GitHub did not return the exact merge commit identity.",
      ExitCode.data,
    );
  }
  if (commit.parents.length >= 2) return "merge";
  if (commit.parents.length === 1) {
    return "linear_tree_preserving";
  }
  throw new MillError(
    "MERGE_TOPOLOGY_INVALID",
    "The observed merge commit has no parent and cannot be classified safely.",
    ExitCode.data,
  );
}

export async function finalizeDraftPr(input: {
  root: string;
  taskPath: string;
  runId: string;
  adapter?: GitHubAdapter;
  signal?: AbortSignal;
}): Promise<{ run: PublicRunRecord; delivery: DeliveryRecord }> {
  const context = await openDeliveryContext(
    input.root,
    input.taskPath,
    "readback",
  );
  const { inputs, config, store } = context;
  let lease: Awaited<ReturnType<typeof acquireWriterLease>> | undefined;
  try {
    lease = await acquireWriterLease(store);
    let run = store.getRun(input.runId);
    if (
      run.status !== "awaiting_human" &&
      run.status !== "merged" &&
      run.status !== "post_merge_verified" &&
      !(
        run.status === "blocked" && run.blockCode === "POST_MERGE_CHECKS_FAILED"
      )
    ) {
      throw new MillError(
        "DELIVERY_NOT_FINALIZABLE",
        "Run is not awaiting human merge or post-merge verification.",
        ExitCode.configuration,
      );
    }
    let delivery = storedDelivery(run);
    if (delivery.pullRequest === null) {
      throw new MillError(
        "PULL_REQUEST_IDENTITY_MISSING",
        "Delivery has no verified pull request identity.",
        ExitCode.configuration,
      );
    }
    const pullRequest = delivery.pullRequest;
    const adapter = input.adapter ?? createGitHubAdapter(input.root);
    const deadlineMs = operationDeadline(config);
    const binding = await adapter.inspect({
      config,
      deadlineMs,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    await assertBinding(input.root, config, binding);
    const continuity = assertDeliveryContinuity({
      run,
      inputs,
      config,
      delivery,
      binding,
      allowLegacyPostMergePolicy: true,
    });
    const observation = await adapter.observe({
      config,
      pullRequestNumber: pullRequest.number,
      deadlineMs,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    assertObservationIdentity(observation, delivery, true);
    if (!observation.pullRequest.merged) {
      if (observation.pullRequest.state === "closed") {
        throw new MillError(
          "PULL_REQUEST_CLOSED_UNMERGED",
          "The delivery pull request was closed without a merge.",
          ExitCode.configuration,
        );
      }
      throw new MillError(
        "HUMAN_MERGE_PENDING",
        "The draft pull request has not been merged by the human owner.",
        ExitCode.temporary,
      );
    }
    if (observation.mergeCommit === null) {
      throw new MillError(
        "MERGE_READBACK_MISMATCH",
        "GitHub readback cannot prove the exact merge commit.",
        ExitCode.configuration,
      );
    }
    const mergeCommit = observation.mergeCommit;
    if (
      observation.pullRequest.mergeCommitSha !== mergeCommit.sha ||
      observation.pullRequest.mergedByLogin === null ||
      observation.pullRequest.mergedAt === null ||
      !observation.mergeIsOnDefaultBranch
    ) {
      throw new MillError(
        "MERGE_READBACK_MISMATCH",
        "GitHub readback cannot prove the exact merge is contained by the default branch.",
        ExitCode.configuration,
      );
    }
    const mergedByLogin = observation.pullRequest.mergedByLogin;
    if (!delivery.allowedMergerLogins.includes(mergedByLogin)) {
      throw new MillError(
        "MERGER_NOT_ALLOWED",
        "The pull request was merged by an identity outside the approved human merge authority.",
        ExitCode.configuration,
        { mergedByLogin },
      );
    }
    const method = mergeMethod(observation);
    if (!delivery.allowedMergeMethods.includes(method)) {
      throw new MillError(
        "MERGE_METHOD_NOT_ALLOWED",
        "The observed merge method is outside the repository policy.",
        ExitCode.configuration,
      );
    }
    if (mergeCommit.tree !== delivery.candidateTree) {
      throw new MillError(
        "MERGE_TREE_REVALIDATION_REQUIRED",
        "The merged tree differs from the reviewed candidate and requires a fresh exact-tree validation before closure.",
        ExitCode.configuration,
      );
    }
    if (continuity.bindLegacyPostMergePolicy) {
      delivery = persistDelivery(
        store,
        run.id,
        {
          ...delivery,
          postMergeRequiredChecks: postMergeRequiredChecks(config),
          legacyPostMergePolicyConfigDigest: inputs.configDigest,
        },
        "delivery.legacy_post_merge_policy_bound",
        { checks: postMergeRequiredChecks(config).length },
      );
    }
    delivery = persistDelivery(
      store,
      run.id,
      {
        ...delivery,
        state: "merged",
        merge: {
          commit: mergeCommit.sha,
          tree: mergeCommit.tree,
          method,
          mergedByLogin,
          mergedAt: observation.pullRequest.mergedAt,
          defaultBranchHead: observation.defaultBranchHead,
        },
        observation: {
          mergeChecks: observation.mergeChecks,
          observedAt: new Date().toISOString(),
        },
        lastErrorCode: null,
      },
      "delivery.merge_verified",
      { mergeCommit: mergeCommit.sha, method },
    );
    if (run.status !== "merged" && run.status !== "post_merge_verified") {
      run = store.transition(run.id, "merged", "delivery.merged");
    }
    const checks = checkDecision(
      delivery.postMergeRequiredChecks ?? delivery.requiredChecks,
      observation.mergeChecks,
    );
    if (checks.status === "pending") {
      return { run: publicRunRecord(run), delivery };
    }
    if (checks.status === "failed") {
      delivery = persistDelivery(
        store,
        run.id,
        {
          ...delivery,
          state: "blocked",
          lastErrorCode: "POST_MERGE_CHECKS_FAILED",
        },
        "delivery.post_merge_checks_failed",
        { failed: checks.failed.length },
      );
      run = setRunBlocker(
        store,
        run,
        "POST_MERGE_CHECKS_FAILED",
        "delivery.blocked",
      );
      return { run: publicRunRecord(run), delivery };
    }
    if (run.status !== "post_merge_verified") {
      run = store.transition(
        run.id,
        "post_merge_verified",
        "delivery.post_merge_verified",
      );
    }
    delivery = persistDelivery(
      store,
      run.id,
      { ...delivery, state: "closed", lastErrorCode: null },
      "delivery.closed",
    );
    run = store.transition(run.id, "closed", "run.closed");
    return { run: publicRunRecord(run), delivery };
  } finally {
    try {
      await lease?.release();
    } finally {
      store.close();
    }
  }
}
