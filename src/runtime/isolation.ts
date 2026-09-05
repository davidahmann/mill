import { ExitCode, MillError } from "../errors.js";

export type BuilderIsolationRequest = "trusted-host" | "isolated";

export interface BuilderIsolationBoundary {
  schemaVersion: "1";
  builtInAdapter: "codex-cli";
  requested: BuilderIsolationRequest;
  executionBoundary: "trusted-host" | "external-isolated-unqualified";
  status: "supported" | "unsupported";
  guarantees: readonly string[];
  requiredForQualification: readonly string[];
}

const qualificationRequirements = [
  "Disposable filesystem limited to the approved worktree and declared scratch.",
  "No host home, forge, package-registry, SSH, or provider credentials mounted into the worker.",
  "Deny-by-default egress with an explicit provider path when required.",
  "Pinned adapter and image identity, bounded resources, and cancellation evidence.",
  "Negative tests proving host paths, secrets, and forge mutation are denied.",
] as const;

export function builderIsolationBoundary(
  requested: BuilderIsolationRequest = "trusted-host",
): BuilderIsolationBoundary {
  if (requested === "isolated") {
    return {
      schemaVersion: "1",
      builtInAdapter: "codex-cli",
      requested,
      executionBoundary: "external-isolated-unqualified",
      status: "unsupported",
      guarantees: [],
      requiredForQualification: qualificationRequirements,
    };
  }
  return {
    schemaVersion: "1",
    builtInAdapter: "codex-cli",
    requested,
    executionBoundary: "trusted-host",
    status: "supported",
    guarantees: [
      "A disposable Git worktree bounds candidate writes.",
      "The built-in builder has no GitHub mutation tool or forge credential path from Mill.",
      "This is not hostile-host containment or a sandbox attestation.",
    ],
    requiredForQualification: qualificationRequirements,
  };
}

export function requireBuilderIsolation(
  requested: BuilderIsolationRequest,
): void {
  if (requested !== "isolated") return;
  throw new MillError(
    "BUILDER_ISOLATION_UNQUALIFIED",
    "Mill has no qualified isolated builder adapter; it will not silently fall back to the trusted host.",
    ExitCode.configuration,
    { boundary: builderIsolationBoundary(requested) },
  );
}
