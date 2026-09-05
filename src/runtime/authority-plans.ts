import { lstat } from "node:fs/promises";
import { ExitCode, MillError } from "../errors.js";
import { loadMillConfig, textDigest } from "./inputs.js";
import {
  assertRepositoryWorktreeClean,
  captureGitControlState,
  commonGitDirectory,
  readCandidateIdentity,
  readCommittedFile,
  resolveCommit,
  verifyPartiallyRemovedWorktree,
} from "./repository.js";
import {
  acquireWriterLease,
  StateStore,
  isSettledAuthorityPlan,
  isTerminalRun,
  type AuthorityPlanRecord,
} from "./state.js";
import { assertEffectAllowsNewWork } from "./effect-boundary.js";

async function retainedAuthorityIdentity(
  plan: AuthorityPlanRecord,
  commonDirectory: string,
) {
  if (
    plan.branch === undefined ||
    (await commonGitDirectory(plan.worktreePath)) !== commonDirectory
  )
    throw new MillError(
      "AUTHORITY_PLAN_IDENTITY_MISMATCH",
      "The authority worktree belongs to another repository.",
      ExitCode.configuration,
    );
  await assertRepositoryWorktreeClean(plan.worktreePath);
  const identity = await readCandidateIdentity(plan.worktreePath);
  const controls = await captureGitControlState(plan.worktreePath);
  if (controls.currentRef !== `refs/heads/${plan.branch}`)
    throw new MillError(
      "AUTHORITY_PLAN_IDENTITY_MISMATCH",
      "The worktree is not on the recorded authority branch.",
      ExitCode.configuration,
    );
  return { branch: plan.branch, committedCommit: identity.commit };
}

/** Explicit disposition, not successful apply, replay, commit, or file deletion. */
export async function abandonAuthorityPlan(input: {
  root: string;
  approvalDigest: string;
  attended: boolean;
}) {
  if (!input.attended)
    throw new MillError(
      "ATTENDANCE_REQUIRED",
      "Abandonment requires the attended operator.",
      ExitCode.configuration,
    );
  const config = await loadMillConfig(input.root);
  if (config.trustCeiling === "inspect")
    throw new MillError(
      "TRUST_CEILING_EXCEEDED",
      "Inspect-only cannot change authority-plan disposition.",
      ExitCode.configuration,
    );
  const common = await commonGitDirectory(input.root);
  const store = await StateStore.open(config.repositoryId, common);
  let lease: Awaited<ReturnType<typeof acquireWriterLease>> | undefined;
  try {
    lease = await acquireWriterLease(store);
    for (const run of store.runs()) {
      assertEffectAllowsNewWork(run);
      if (!isTerminalRun(run.status))
        throw new MillError(
          "ACTIVE_RUN_CONFLICT",
          "Finish the active lifecycle before abandoning authority.",
          ExitCode.configuration,
        );
    }
    const plan = store
      .authorityPlans()
      .find((item) => item.approvalDigest === input.approvalDigest);
    if (plan === undefined || plan.state === "committed")
      throw new MillError(
        "INVALID_AUTHORITY_PLAN",
        "Select an existing unfinished authority-plan digest.",
        ExitCode.configuration,
      );
    const evidence = await retainedAuthorityIdentity(plan, common);
    if (plan.state === "abandoned") {
      if (plan.abandonedCommit !== evidence.committedCommit)
        throw new MillError(
          "AUTHORITY_PLAN_IDENTITY_MISMATCH",
          "The retained abandoned commit changed.",
          ExitCode.configuration,
        );
    } else {
      await assertRepositoryWorktreeClean(plan.worktreePath);
      if (
        (await readCandidateIdentity(plan.worktreePath)).commit !==
        evidence.committedCommit
      )
        throw new MillError(
          "AUTHORITY_PLAN_IDENTITY_MISMATCH",
          "Authority changed during abandonment.",
          ExitCode.configuration,
        );
      store.abandonAuthorityPlan(
        plan.approvalDigest,
        evidence.branch,
        evidence.committedCommit,
      );
    }
    return {
      approvalDigest: plan.approvalDigest,
      state: "abandoned" as const,
      retainedCommit: evidence.committedCommit,
      branch: evidence.branch,
    };
  } finally {
    try {
      await lease?.release();
    } finally {
      store.close();
    }
  }
}

export async function verifyAuthorityPlanCommit(
  plan: AuthorityPlanRecord,
  commonDirectory: string,
) {
  if (
    plan.branch === undefined ||
    (await commonGitDirectory(plan.worktreePath)) !== commonDirectory
  )
    throw new MillError(
      "AUTHORITY_PLAN_IDENTITY_MISMATCH",
      "The authority worktree belongs to another repository.",
      ExitCode.configuration,
    );
  await assertRepositoryWorktreeClean(plan.worktreePath);
  const identity = await readCandidateIdentity(plan.worktreePath);
  const controls = await captureGitControlState(plan.worktreePath);
  if (
    identity.commit === plan.baseCommit ||
    controls.currentRef !== `refs/heads/${plan.branch}`
  )
    throw new MillError(
      "AUTHORITY_PLAN_UNCOMMITTED",
      "The exact generated files must be committed on their recorded branch.",
      ExitCode.configuration,
    );
  for (const file of plan.files) {
    if (
      textDigest(
        await readCommittedFile(plan.worktreePath, identity.commit, file.path),
      ) !== file.digest
    )
      throw new MillError(
        "AUTHORITY_PLAN_FILES_CHANGED",
        "Committed authority bytes differ from the approved plan.",
        ExitCode.configuration,
      );
  }
  await assertRepositoryWorktreeClean(plan.worktreePath);
  if (
    (await readCandidateIdentity(plan.worktreePath)).commit !== identity.commit
  )
    throw new MillError(
      "AUTHORITY_PLAN_IDENTITY_MISMATCH",
      "The worktree changed during readback.",
      ExitCode.configuration,
    );
  return { branch: plan.branch, committedCommit: identity.commit };
}

/** A deletion intent is recoverable only while Git retains the exact branch and files. */
export async function verifyAuthorityPlanPurge(
  plan: AuthorityPlanRecord,
  root: string,
  commonDirectory: string,
) {
  let present = true;
  try {
    await lstat(plan.worktreePath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      present = false;
    else throw error;
  }
  if (present && plan.purgeCommit === undefined) {
    if (plan.state === "abandoned") {
      const evidence = await retainedAuthorityIdentity(plan, commonDirectory);
      if (evidence.committedCommit !== plan.abandonedCommit)
        throw new MillError(
          "AUTHORITY_PLAN_IDENTITY_MISMATCH",
          "Abandoned authority branch changed.",
          ExitCode.configuration,
        );
      return evidence;
    }
    return await verifyAuthorityPlanCommit(plan, commonDirectory);
  }
  if (
    plan.purgeCommit === undefined ||
    plan.branch === undefined ||
    (plan.state === "abandoned" && plan.purgeCommit !== plan.abandonedCommit) ||
    (await resolveCommit(root, `refs/heads/${plan.branch}`)) !==
      plan.purgeCommit
  )
    throw new MillError(
      "AUTHORITY_PLAN_IDENTITY_MISMATCH",
      "Missing worktree requires a recorded purge intent and exact retained branch.",
      ExitCode.configuration,
    );
  for (const file of plan.state === "abandoned" ? [] : plan.files) {
    if (
      textDigest(await readCommittedFile(root, plan.purgeCommit, file.path)) !==
      file.digest
    )
      throw new MillError(
        "AUTHORITY_PLAN_FILES_CHANGED",
        "Retained purge commit differs from approved authority.",
        ExitCode.configuration,
      );
  }
  if (present)
    await verifyPartiallyRemovedWorktree(
      root,
      plan.worktreePath,
      plan.purgeCommit,
      commonDirectory,
    );
  return { branch: plan.branch, committedCommit: plan.purgeCommit };
}

/** Readback only: never commits, rewrites files, retries apply, or grants execution. */
export async function reconcileAuthorityPlans(input: { root: string }) {
  const config = await loadMillConfig(input.root);
  const commonDirectory = await commonGitDirectory(input.root);
  const store = await StateStore.open(config.repositoryId, commonDirectory);
  let lease: Awaited<ReturnType<typeof acquireWriterLease>> | undefined;
  try {
    lease = await acquireWriterLease(store);
    const results = [];
    for (const plan of store.authorityPlans()) {
      if (isSettledAuthorityPlan(plan)) {
        results.push({
          approvalDigest: plan.approvalDigest,
          state: plan.state,
        });
        continue;
      }
      try {
        const evidence = await verifyAuthorityPlanCommit(plan, commonDirectory);
        store.settleAuthorityPlan(plan.approvalDigest, evidence);
        results.push({
          approvalDigest: plan.approvalDigest,
          state: "committed",
          committedCommit: evidence.committedCommit,
        });
      } catch (error) {
        results.push({
          approvalDigest: plan.approvalDigest,
          state: plan.state,
          blockCode:
            error instanceof MillError
              ? error.code
              : "AUTHORITY_PLAN_READBACK_UNAVAILABLE",
        });
      }
    }
    return { plans: results };
  } finally {
    try {
      await lease?.release();
    } finally {
      store.close();
    }
  }
}
