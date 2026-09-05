import { randomUUID } from "node:crypto";

import type { z } from "zod";

import type {
  reviewResultSchema,
  workerProfileSchema,
} from "../contracts/schemas.js";
import { workerInvocationSchema } from "../contracts/schemas.js";
import { canonicalDigest, type JsonValue } from "../contracts/canonical.js";
import type { ContextManifest } from "./context.js";
import type { TaskPacket } from "./inputs.js";
import type { ActiveProcess } from "./process.js";

export interface ProviderUsage {
  source: "measured" | "unavailable";
  inputTokens?: number;
  outputTokens?: number;
  cacheInputTokens?: number;
  cost: "unavailable";
}

export type WorkerProfile = z.infer<typeof workerProfileSchema>;
export type WorkerInvocation = z.infer<typeof workerInvocationSchema>;

interface WorkerLifecycle {
  signal?: AbortSignal;
  onBeforeSpawn?: () => void;
  onSpawn?: (process: ActiveProcess) => void;
  onExit?: (process?: ActiveProcess) => void;
  cancellationRequested?: () => boolean;
}

export interface BuilderWorkerInput extends WorkerLifecycle {
  root: string;
  task: TaskPacket;
  manifest: ContextManifest;
  deadlineMs: number;
  maxOutputBytes: number;
  repairFindings?: readonly Record<string, unknown>[];
}

export interface ReviewerWorkerInput extends WorkerLifecycle {
  root: string;
  task: TaskPacket;
  manifest: ContextManifest;
  candidateCommit: string;
  reviewScope?: NonNullable<z.infer<typeof reviewResultSchema>["scope"]>;
  deadlineMs: number;
  maxOutputBytes: number;
}

export interface WorkerAdapter {
  readonly id: "codex-cli";
  profile(root: string, role: WorkerProfile["role"]): Promise<WorkerProfile>;
  runBuilder(input: BuilderWorkerInput): Promise<{
    usage: ProviderUsage;
    threadId?: string;
  }>;
  runReviewer(input: ReviewerWorkerInput): Promise<{
    review: z.infer<typeof reviewResultSchema>;
    usage: ProviderUsage;
  }>;
}

export function createWorkerInvocation(input: {
  runId: string;
  phase: WorkerInvocation["phase"];
  attempt: number;
  task: TaskPacket;
  taskDigest: string;
  manifest: ContextManifest;
  baseCommit: string;
  candidateCommit?: string;
  impactManifestDigest?: string;
  profile: WorkerProfile;
  deadlineAt: string;
}): { invocation: WorkerInvocation; digest: string } {
  const profileDigest = canonicalDigest(input.profile);
  const contextEpoch =
    input.manifest.contextEpoch ??
    canonicalDigest(input.manifest as unknown as JsonValue);
  const invocation = workerInvocationSchema.parse({
    schemaVersion: "1",
    invocationId: randomUUID(),
    runId: input.runId,
    phase: input.phase,
    attempt: input.attempt,
    taskDigest: input.taskDigest,
    contextEpoch,
    baseCommit: input.baseCommit,
    ...(input.candidateCommit === undefined
      ? {}
      : { candidateCommit: input.candidateCommit }),
    ...(input.impactManifestDigest === undefined
      ? {}
      : { impactManifestDigest: input.impactManifestDigest }),
    profile: input.profile,
    profileDigest,
    allowedPaths:
      input.profile.role === "reviewer" ? [] : input.task.allowedPaths,
    deadlineAt: input.deadlineAt,
    maxOutputBytes: input.task.budget.maxOutputBytes,
  });
  return {
    invocation,
    digest: canonicalDigest(invocation as unknown as JsonValue),
  };
}
