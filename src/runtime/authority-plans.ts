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
} from "./repository.js";
import {
  acquireWriterLease,
  StateStore,
  type AuthorityPlanRecord,
} from "./state.js";

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
  if (present) {
    const evidence = await verifyAuthorityPlanCommit(plan, commonDirectory);
    if (
      plan.purgeCommit !== undefined &&
      plan.purgeCommit !== evidence.committedCommit
    )
      throw new MillError(
        "AUTHORITY_PLAN_IDENTITY_MISMATCH",
        "Authority changed after purge intent.",
        ExitCode.configuration,
      );
    return evidence;
  }
  if (
    plan.purgeCommit === undefined ||
    plan.branch === undefined ||
    (await resolveCommit(root, `refs/heads/${plan.branch}`)) !==
      plan.purgeCommit
  )
    throw new MillError(
      "AUTHORITY_PLAN_IDENTITY_MISMATCH",
      "Missing worktree requires a recorded purge intent and exact retained branch.",
      ExitCode.configuration,
    );
  for (const file of plan.files) {
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
      if (plan.state === "committed") {
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
