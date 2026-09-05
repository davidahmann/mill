import type { z } from "zod";
import { canonicalDigest } from "../contracts/canonical.js";
import { assessImpactManifest } from "../planning/impact.js";
import {
  deliveryRecordSchema,
  mergeApprovalPlanSchema,
  reviewResultSchema,
  validationEvidenceSchema,
} from "../contracts/schemas.js";
import { ExitCode, MillError } from "../errors.js";
import {
  actionableFeedback,
  checkDecision,
  reviewsPassed,
  type DeliveryRecord,
} from "./delivery.js";
import {
  createGitHubAdapter,
  type GitHubAdapter,
  type GitHubObservation,
  type ProposeConfig,
} from "./github.js";
import { loadRuntimeInputs, type RuntimeInputs } from "./inputs.js";
import { assertRunBindings } from "./lifecycle.js";
import {
  captureReviewScope,
  commonGitDirectory,
  repositoryRemoteUrl,
} from "./repository.js";
import { acquireWriterLease, StateStore } from "./state.js";

type MergePlan = z.infer<typeof mergeApprovalPlanSchema>;
type Approval = NonNullable<DeliveryRecord["mergeApproval"]>;
interface MergeInput {
  root: string;
  taskPath: string;
  runId: string;
  adapter?: GitHubAdapter;
}
interface MergeContext {
  store: StateStore;
  delivery: DeliveryRecord;
  adapter: GitHubAdapter;
  inputs: RuntimeInputs;
  config: ProposeConfig;
  save(value: Approval): void;
}

function authorityDeadline(inputs: RuntimeInputs): number {
  return Math.min(
    Infinity,
    ...(inputs.continuity?.impact.exceptions ?? []).map((item) =>
      Date.parse(item.expiresAt),
    ),
    ...(inputs.task.schemaVersion === "2" ? inputs.task.attestations : []).map(
      (item) => Date.parse(item.expiresAt),
    ),
  );
}

function assertCurrentAuthority(inputs: RuntimeInputs): void {
  const continuity = inputs.continuity;
  if (
    Date.now() >= authorityDeadline(inputs) ||
    (continuity !== undefined &&
      !assessImpactManifest({
        manifest: continuity.impact,
        product: continuity.product,
        scenarios: continuity.scenarios,
        authorityMode: "authorize",
      }).approved)
  )
    throw new MillError(
      "MERGE_AUTHORITY_EXPIRED",
      "Current task and impact authority must remain valid before each merge effect.",
      ExitCode.configuration,
    );
}

async function withMergeContext<T>(
  input: MergeInput,
  readback: boolean,
  action: (context: MergeContext) => Promise<T>,
): Promise<T> {
  const inputs = await loadRuntimeInputs(
    input.root,
    input.taskPath,
    readback ? "readback" : "authorize",
  );
  const store = await StateStore.open(
    inputs.config.repositoryId,
    await commonGitDirectory(input.root),
  );
  let lease: Awaited<ReturnType<typeof acquireWriterLease>> | undefined;
  try {
    lease = await acquireWriterLease(store);
    const run = store.getRun(input.runId);
    if (run.deliveryJson === undefined)
      throw new MillError(
        "DELIVERY_PLAN_MISSING",
        "Merge requires an existing reviewed delivery.",
        ExitCode.configuration,
      );
    const delivery = deliveryRecordSchema.parse(JSON.parse(run.deliveryJson));
    const config = inputs.config.propose;
    if (
      config !== undefined &&
      (config.owner !== delivery.target.owner ||
        config.repository !== delivery.target.repository ||
        config.repositoryNodeId !== delivery.target.repositoryNodeId ||
        config.remoteName !== delivery.target.remoteName ||
        config.baseBranch !== delivery.target.baseBranch ||
        run.taskDigest !== inputs.taskDigest)
    )
      throw new MillError(
        "MERGE_IDENTITY_MISMATCH",
        "Readback must use the original delivery repository and task identity.",
        ExitCode.configuration,
      );
    if (
      inputs.config.trustCeiling !== "propose" ||
      config === undefined ||
      (!readback && config.attendedMerge !== true)
    )
      throw new MillError(
        "ATTENDED_MERGE_DISABLED",
        "The repository has not explicitly enabled attended merge.",
        ExitCode.configuration,
      );
    if (
      !readback &&
      (run.status !== "awaiting_human" ||
        run.cancelRequested ||
        run.configDigest !== inputs.configDigest ||
        run.taskDigest !== inputs.taskDigest)
    )
      throw new MillError(
        "MERGE_NOT_READY",
        "Merge requires unchanged approved policy and an uncancelled human-ready run.",
        ExitCode.configuration,
      );
    return await action({
      store,
      delivery,
      inputs,
      config,
      adapter: input.adapter ?? createGitHubAdapter(input.root),
      save(value) {
        delivery.mergeApproval = value;
        delivery.updatedAt = new Date().toISOString();
        store.setDelivery(
          run.id,
          JSON.stringify(deliveryRecordSchema.parse(delivery)),
          `merge.${value.state}`,
          { approvalDigest: value.digest },
        );
      },
    });
  } finally {
    try {
      await lease?.release();
    } finally {
      store.close();
    }
  }
}

async function preflight(
  input: MergeInput,
  context: MergeContext,
  limit?: number,
) {
  const { inputs, config, delivery, adapter, store } = context;
  assertCurrentAuthority(inputs);
  const deadlineMs = Math.min(
    Date.now() + config.pollTimeoutSeconds * 1000,
    limit ?? Infinity,
    authorityDeadline(inputs),
  );
  const binding = await adapter.inspect({ config, deadlineMs });
  const remote = await repositoryRemoteUrl(input.root, config.remoteName);
  if (
    binding.repositoryNodeId !== delivery.target.repositoryNodeId ||
    binding.actorLogin !== delivery.target.actorLogin ||
    binding.actorId !== delivery.target.actorId ||
    binding.fullName !== `${config.owner}/${config.repository}` ||
    binding.fork ||
    binding.defaultBranch !== config.baseBranch ||
    !config.allowedActors.includes(binding.actorLogin) ||
    !config.allowedMergerLogins.includes(binding.actorLogin) ||
    ![
      binding.cloneUrl,
      `git@${config.host}:${config.owner}/${config.repository}.git`,
      `ssh://git@${config.host}/${config.owner}/${config.repository}.git`,
    ].includes(remote)
  )
    throw new MillError(
      "MERGE_IDENTITY_MISMATCH",
      "Repository, operator or merge authority no longer matches the delivery.",
      ExitCode.configuration,
    );
  if (
    config.requiredChecks.length === 0 ||
    config.requiredChecks.some(
      (name) => config.checkProducers?.[name] === undefined,
    ) ||
    (await adapter.strictChecks?.({ config, deadlineMs })) !== true
  )
    throw new MillError(
      "MERGE_PROTECTION_REQUIRED",
      "Attended merge requires producer-bound checks and strict up-to-date branch protection. Mill never bypasses protection.",
      ExitCode.configuration,
    );
  const run = store.getRun(input.runId);
  const candidate = await assertRunBindings(input.root, run, inputs);
  const validation = validationEvidenceSchema.parse(
    JSON.parse(run.validationJson ?? "null"),
  );
  const review = reviewResultSchema.parse(JSON.parse(run.reviewJson ?? "null"));
  if (
    !validation.passed ||
    validation.candidateCommit !== candidate.commit ||
    review.candidateCommit !== candidate.commit ||
    review.findings.length !== 0 ||
    candidate.commit !== delivery.candidateCommit ||
    candidate.tree !== delivery.candidateTree
  )
    throw new MillError(
      "MERGE_EVIDENCE_STALE",
      "Merge requires exact validation and complete-diff review of the delivered candidate.",
      ExitCode.configuration,
    );
  if (delivery.pullRequest === null)
    throw new MillError(
      "PULL_REQUEST_MISSING",
      "No pull request is bound to the delivery.",
      ExitCode.configuration,
    );
  const observation = await adapter.observe({
    config,
    pullRequestNumber: delivery.pullRequest.number,
    deadlineMs,
  });
  const pull = observation.pullRequest;
  const scope = await captureReviewScope(
    candidate.worktree,
    observation.defaultBranchHead,
    candidate.commit,
  );
  if (review.scope?.digest !== scope.digest)
    throw new MillError(
      "MERGE_EVIDENCE_STALE",
      "The reviewed diff differs from GitHub's authoritative merge base.",
      ExitCode.configuration,
    );
  if (
    pull.nodeId !== delivery.pullRequest.nodeId ||
    pull.number !== delivery.pullRequest.number ||
    pull.headSha !== candidate.commit ||
    observation.branchSha !== candidate.commit ||
    pull.headRef !== delivery.branchName ||
    pull.baseRef !== config.baseBranch ||
    pull.state !== "open" ||
    pull.merged
  )
    throw new MillError(
      "MERGE_IDENTITY_MISMATCH",
      "The open PR identity or head changed.",
      ExitCode.configuration,
    );
  if (
    checkDecision(
      config.requiredChecks,
      observation.checks,
      config.checkProducers,
      "pull_request",
      candidate.commit,
    ).status !== "passed" ||
    !reviewsPassed(observation, config.reviewPolicy, candidate.commit) ||
    actionableFeedback(observation, config.reviewPolicy, candidate.commit)
      .length !== 0
  )
    throw new MillError(
      "MERGE_CHECKS_NOT_GREEN",
      "Current producer-bound checks and review must pass before any merge effect.",
      ExitCode.configuration,
    );
  return { config, binding, candidate, observation, deadlineMs };
}

export async function planMerge(
  input: MergeInput & { method: "merge" | "squash" },
) {
  return withMergeContext(input, false, async (context) => {
    const prior = context.delivery.mergeApproval;
    if (
      prior !== undefined &&
      prior.state !== "planned" &&
      prior.state !== "ready_verified"
    )
      throw new MillError(
        "MERGE_RECONCILIATION_REQUIRED",
        "An attempted merge plan must be reconciled, not overwritten.",
        ExitCode.configuration,
      );
    const current = await preflight(input, context);
    if (
      !current.config.allowedMergeMethods.includes(
        input.method === "squash" ? "linear_tree_preserving" : "merge",
      )
    )
      throw new MillError(
        "MERGE_METHOD_FORBIDDEN",
        "The selected merge method is outside repository policy.",
        ExitCode.configuration,
      );
    const plan: MergePlan = mergeApprovalPlanSchema.parse({
      schemaVersion: "1",
      repositoryNodeId: current.binding.repositoryNodeId,
      pullRequestNumber: current.observation.pullRequest.number,
      pullRequestNodeId: current.observation.pullRequest.nodeId,
      headCommit: current.candidate.commit,
      baseCommit: current.observation.defaultBranchHead,
      candidateTree: current.candidate.tree,
      actorLogin: current.binding.actorLogin,
      actorId: current.binding.actorId,
      policyDigest: context.inputs.configDigest,
      method: input.method,
      markReady: current.observation.pullRequest.draft,
      expiresAt: new Date(
        Math.min(
          Date.now() + current.config.approvalTtlSeconds * 1000,
          authorityDeadline(context.inputs),
        ),
      ).toISOString(),
    });
    const approval = {
      plan,
      digest: canonicalDigest(plan),
      state: "planned" as const,
    };
    context.save(approval);
    return approval;
  });
}

function readbackMatches(
  observation: GitHubObservation,
  plan: MergePlan,
): boolean {
  return (
    observation.pullRequest.nodeId === plan.pullRequestNodeId &&
    observation.pullRequest.number === plan.pullRequestNumber &&
    observation.pullRequest.headSha === plan.headCommit
  );
}

export async function applyMerge(
  input: MergeInput & { approvalDigest: string; attended: boolean },
) {
  if (!input.attended)
    throw new MillError(
      "ATTENDANCE_REQUIRED",
      "Merge approval must be submitted at the trusted attended operator boundary.",
      ExitCode.configuration,
    );
  return withMergeContext(input, false, async (context) => {
    let approval = context.delivery.mergeApproval;
    if (
      approval?.state !== "planned" ||
      approval.digest !== input.approvalDigest ||
      canonicalDigest(approval.plan) !== input.approvalDigest ||
      Date.parse(approval.plan.expiresAt) <= Date.now()
    )
      throw new MillError(
        "MERGE_APPROVAL_INVALID",
        "Approval must match the unexpired, unattempted exact merge plan.",
        ExitCode.configuration,
      );
    const plan = approval.plan;
    const effectDeadline = Math.min(
      Date.now() + context.config.pollTimeoutSeconds * 1000,
      Date.parse(plan.expiresAt),
      authorityDeadline(context.inputs),
    );
    const current = await preflight(input, context, effectDeadline);
    if (
      !readbackMatches(current.observation, plan) ||
      current.observation.defaultBranchHead !== plan.baseCommit ||
      current.candidate.tree !== plan.candidateTree ||
      current.binding.actorId !== plan.actorId ||
      current.binding.actorLogin !== plan.actorLogin ||
      context.inputs.configDigest !== plan.policyDigest ||
      current.observation.pullRequest.draft !== plan.markReady
    )
      throw new MillError(
        "MERGE_PLAN_STALE",
        "The displayed merge plan changed; no effect was attempted.",
        ExitCode.configuration,
      );
    if (
      context.adapter.mergeExact === undefined ||
      (plan.markReady && context.adapter.markReady === undefined)
    )
      throw new MillError(
        "MERGE_ADAPTER_UNAVAILABLE",
        "The configured adapter does not implement attended merge.",
        ExitCode.unavailable,
      );
    const cancellationRequested = () =>
      context.store.getRun(input.runId).cancelRequested;
    const save = (state: Approval["state"]) => {
      approval = {
        plan,
        digest: input.approvalDigest,
        state,
        approvalSource: "attended_operator",
      };
      context.save(approval);
    };
    const observe = () =>
      context.adapter.observe({
        config: current.config,
        pullRequestNumber: plan.pullRequestNumber,
        deadlineMs: current.deadlineMs,
      });
    try {
      assertCurrentAuthority(context.inputs);
      if (Date.now() >= effectDeadline)
        throw new MillError(
          "MERGE_APPROVAL_INVALID",
          "The merge approval expired during preflight.",
          ExitCode.configuration,
        );
      if (cancellationRequested())
        throw new MillError(
          "OPERATOR_CANCELLED",
          "Merge was cancelled before execution.",
          ExitCode.temporary,
        );
      if (plan.markReady) {
        if (context.adapter.markReady === undefined)
          throw new MillError(
            "MERGE_ADAPTER_UNAVAILABLE",
            "The adapter cannot mark the PR ready.",
            ExitCode.unavailable,
          );
        save("ready_started");
        await context.adapter.markReady({
          config: current.config,
          pullRequestNodeId: plan.pullRequestNodeId,
          deadlineMs: current.deadlineMs,
          cancellationRequested,
        });
        const ready = await observe();
        if (!readbackMatches(ready, plan) || ready.pullRequest.draft)
          throw new MillError(
            "READY_READBACK_MISMATCH",
            "Readiness was not confirmed on the exact PR.",
            ExitCode.temporary,
          );
        save("ready_verified");
      }
      const fresh = await preflight(input, context, effectDeadline);
      if (
        fresh.observation.defaultBranchHead !== plan.baseCommit ||
        Date.now() >= effectDeadline ||
        cancellationRequested()
      )
        throw new MillError(
          "MERGE_PLAN_STALE",
          "Base changed or cancellation was requested before merge.",
          ExitCode.configuration,
        );
      assertCurrentAuthority(context.inputs);
      save("merge_started");
      await context.adapter.mergeExact({
        config: current.config,
        pullRequestNumber: plan.pullRequestNumber,
        headSha: plan.headCommit,
        method: plan.method,
        deadlineMs: current.deadlineMs,
        cancellationRequested,
      });
      const merged = await observe();
      if (
        !readbackMatches(merged, plan) ||
        !merged.pullRequest.merged ||
        merged.pullRequest.mergedByLogin !== plan.actorLogin ||
        !merged.mergeIsOnDefaultBranch ||
        merged.mergeCommit?.tree !== plan.candidateTree
      )
        throw new MillError(
          "MERGE_READBACK_MISMATCH",
          "Merge requires provider-authoritative identity and exact-tree readback.",
          ExitCode.temporary,
        );
      save("merged");
    } catch (error) {
      if (context.delivery.mergeApproval?.state === "merge_started")
        save("effect_unknown");
      throw error;
    }
    return approval;
  });
}

export async function reconcileMerge(input: MergeInput) {
  return withMergeContext(input, true, async (context) => {
    const approval = context.delivery.mergeApproval;
    if (approval === undefined)
      throw new MillError(
        "MERGE_PLAN_MISSING",
        "No merge plan has been recorded.",
        ExitCode.configuration,
      );
    const observed = await context.adapter.observe({
      config: context.config,
      pullRequestNumber: approval.plan.pullRequestNumber,
      deadlineMs: Date.now() + context.config.pollTimeoutSeconds * 1000,
    });
    if (
      approval.state === "ready_started" &&
      readbackMatches(observed, approval.plan) &&
      !observed.pullRequest.merged &&
      observed.pullRequest.state === "open" &&
      !observed.pullRequest.draft
    ) {
      context.save({ ...approval, state: "ready_verified" });
      return { ...approval, state: "ready_verified" as const };
    }
    if (
      readbackMatches(observed, approval.plan) &&
      observed.pullRequest.merged &&
      observed.pullRequest.mergedByLogin === approval.plan.actorLogin &&
      observed.mergeIsOnDefaultBranch &&
      observed.mergeCommit?.tree === approval.plan.candidateTree
    ) {
      context.save({ ...approval, state: "merged" });
      return { ...approval, state: "merged" as const };
    }
    return approval;
  });
}
