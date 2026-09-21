import { z } from "zod";
import { canonicalDigest, type JsonValue } from "../contracts/canonical.js";
import { ExitCode, MillError } from "../errors.js";
import type { RunRecord } from "./state.js";

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const commit = z.string().regex(/^[a-f0-9]{40}$/u);
export const verificationRecoverySchema = z
  .object({
    schemaVersion: z.literal("1"),
    scope: z.literal("candidate_verification_review_only"),
    runId: z.string(),
    repositoryId: z.string(),
    taskDigest: digest,
    configDigest: digest,
    baseCommit: commit,
    candidateCommit: commit,
    candidateTree: commit,
    contextDigest: digest,
    controlDigest: digest,
    originalDeadlineAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    checkpointDigest: digest,
    failureSequence: z.number().int().positive(),
    controllerVersion: z.string(),
    lockDigest: digest,
    pinnedVersion: z.string().min(1),
    builderAttempts: z.literal(0),
    repairGenerations: z.literal(0),
  })
  .strict();
export type VerificationRecovery = z.infer<typeof verificationRecoverySchema>;
export function recoveryError(message: string): never {
  throw new MillError(
    "VERIFICATION_RECOVERY_UNAVAILABLE",
    message,
    ExitCode.configuration,
  );
}
export function recoveryDigest(plan: VerificationRecovery): string {
  return canonicalDigest(plan);
}
export function recoveryCheckpoint(
  events: readonly Record<string, unknown>[],
): string {
  return canonicalDigest(events as unknown as JsonValue);
}
export function eligibleVerificationFailure(
  run: RunRecord,
  events: readonly Record<string, unknown>[],
): number {
  if (
    run.status !== "blocked" ||
    run.cancelRequested ||
    run.validationJson !== undefined ||
    run.reviewJson !== undefined ||
    run.deliveryJson !== undefined ||
    run.remoteFeedbackJson !== undefined ||
    run.activeProcessId !== undefined ||
    run.candidateCommit === undefined ||
    run.candidateTree === undefined
  )
    recoveryError(
      "Recovery requires a stopped, unvalidated committed candidate without delivery or cancellation.",
    );
  const lastCommit = events.findLastIndex(
    (event) => event.type === "candidate.committed",
  );
  if (lastCommit < 0)
    recoveryError("No lifecycle-owned candidate event exists.");
  const committed = events[lastCommit]?.data as
    Record<string, unknown> | undefined;
  if (
    committed?.commit !== run.candidateCommit ||
    committed.tree !== run.candidateTree
  )
    recoveryError(
      "The candidate event does not bind the current commit and tree.",
    );
  let previous = 0;
  for (const event of events) {
    if (
      !Number.isSafeInteger(event.sequence) ||
      Number(event.sequence) <= previous
    )
      recoveryError("The recovery journal sequence is invalid.");
    previous = Number(event.sequence);
  }
  let failureSequence: number | undefined;
  let blocker: string | undefined;
  for (const event of events.slice(lastCommit + 1)) {
    const data = event.data as Record<string, unknown> | undefined;
    if (event.type === "command.rejected") continue;
    if (failureSequence === undefined && event.type === "builder.completed")
      continue;
    if (
      failureSequence === undefined &&
      event.type === "run.blocked" &&
      data?.from === "committed" &&
      data.to === "blocked" &&
      ["VERIFIER_IMAGE_UNAVAILABLE", "OCI_RUNTIME_UNAVAILABLE"].includes(
        String(data.code),
      )
    ) {
      failureSequence = Number(event.sequence);
      blocker = String(data.code);
      continue;
    }
    if (
      failureSequence !== undefined &&
      event.type === "run.blocker_replaced" &&
      data?.from === blocker &&
      data?.to === "RUN_NOT_COMMITTED"
    ) {
      blocker = "RUN_NOT_COMMITTED";
      continue;
    }
    recoveryError(
      "The journal contains work beyond an eligible verifier preflight failure.",
    );
  }
  if (failureSequence === undefined || blocker !== run.blockCode)
    recoveryError(
      "The current blocker is not proven by verifier infrastructure failure history.",
    );
  return failureSequence;
}
export function assertRecoveryBinding(
  run: RunRecord,
  plan: VerificationRecovery,
): void {
  if (
    plan.runId !== run.id ||
    plan.repositoryId !== run.repositoryId ||
    plan.taskDigest !== run.taskDigest ||
    plan.configDigest !== run.configDigest ||
    plan.baseCommit !== run.baseCommit ||
    plan.candidateCommit !== run.candidateCommit ||
    plan.candidateTree !== run.candidateTree ||
    plan.contextDigest !== run.contextDigest ||
    plan.originalDeadlineAt !== run.deadlineAt ||
    plan.controlDigest !== canonicalDigest(run.controlJson ?? null)
  )
    recoveryError("Recovery receipt does not match the frozen run.");
}
