import { randomUUID } from "node:crypto";

import type { z } from "zod";

import type {
  reviewResultSchema,
  workerProfileSchema,
} from "../contracts/schemas.js";
import { workerInvocationSchema } from "../contracts/schemas.js";
import { canonicalDigest, type JsonValue } from "../contracts/canonical.js";
import { ExitCode, MillError } from "../errors.js";
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
  readonly id: string;
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

/**
 * The registry is deliberately small: registering an adapter only makes its
 * implementation selectable by runtime code. It does not expand a task
 * schema, grant credentials, or qualify a new isolation boundary.
 */
export class WorkerAdapterRegistry {
  readonly #adapters: ReadonlyMap<string, WorkerAdapter>;

  constructor(adapters: readonly WorkerAdapter[]) {
    const entries = new Map<string, WorkerAdapter>();
    for (const adapter of adapters) {
      if (entries.has(adapter.id)) {
        throw new MillError(
          "DUPLICATE_WORKER_ADAPTER",
          "A worker adapter identifier may be registered only once.",
          ExitCode.configuration,
          { adapterId: adapter.id },
        );
      }
      entries.set(adapter.id, adapter);
    }
    this.#adapters = entries;
  }

  ids(): string[] {
    return [...this.#adapters.keys()].sort();
  }

  require(id: string): WorkerAdapter {
    const adapter = this.#adapters.get(id);
    if (adapter === undefined) {
      throw new MillError(
        "WORKER_ADAPTER_UNAVAILABLE",
        "The requested worker adapter is not registered.",
        ExitCode.configuration,
        { adapterId: id, registeredAdapterIds: this.ids() },
      );
    }
    return adapter;
  }
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
