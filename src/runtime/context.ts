import { lstat } from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";

import { canonicalDigest } from "../contracts/canonical.js";
import { contextManifestSchema } from "../contracts/schemas.js";
import { ExitCode, MillError } from "../errors.js";
import { safeReadText } from "../security/safe-path.js";
import type { MillConfig, TaskPacket } from "./inputs.js";
import { textDigest } from "./inputs.js";

export type ContextManifest = z.infer<typeof contextManifestSchema>;

function sensitive(candidate: string, patterns: readonly string[]): boolean {
  const normalized = candidate.replaceAll(path.sep, "/");
  return patterns.some((pattern) => {
    const value = pattern.replaceAll(path.sep, "/");
    if (value.endsWith("/**")) {
      const prefix = value.slice(0, -3).replace(/\/$/u, "");
      return normalized === prefix || normalized.startsWith(`${prefix}/`);
    }
    return normalized === value;
  });
}

export async function buildContextManifest(
  worktree: string,
  baseCommit: string,
  task: TaskPacket,
  config: MillConfig,
  taskDigest: string,
): Promise<{ manifest: ContextManifest; digest: string }> {
  const included: { path: string; digest: string }[] = [];
  for (const contextPath of [...new Set(task.contextPaths)].sort()) {
    if (sensitive(contextPath, config.sensitivePaths)) {
      throw new MillError(
        "SENSITIVE_CONTEXT_FORBIDDEN",
        `Task context includes a sensitive path: ${contextPath}`,
        ExitCode.configuration,
      );
    }
    const information = await lstat(path.join(worktree, contextPath));
    if (!information.isFile() || information.isSymbolicLink()) {
      throw new MillError(
        "INVALID_CONTEXT_FILE",
        `Context path is not a regular file: ${contextPath}`,
        ExitCode.configuration,
      );
    }
    const source = await safeReadText(worktree, contextPath, 2 * 1024 * 1024);
    included.push({ path: contextPath, digest: textDigest(source) });
  }
  const manifest = contextManifestSchema.parse({
    schemaVersion: "1",
    taskDigest,
    baseCommit,
    provider: "openai",
    adapter: "codex-cli",
    authOwner: "operator",
    isolation: "attended-trusted-host",
    modelIdentity: "provider-mutable",
    included,
    excludedPatterns: [...config.sensitivePaths].sort(),
    disclosure: [
      "task objective, acceptance, allowed paths, and command IDs",
      "listed context files and repository-local instructions",
      "candidate diff during review",
    ],
  });
  return { manifest, digest: canonicalDigest(manifest) };
}

export async function assertContextFresh(
  worktree: string,
  manifest: ContextManifest,
): Promise<void> {
  for (const included of manifest.included) {
    const source = await safeReadText(worktree, included.path, 2 * 1024 * 1024);
    if (textDigest(source) !== included.digest) {
      throw new MillError(
        "CONTEXT_DRIFT",
        `Frozen context changed: ${included.path}`,
        ExitCode.configuration,
      );
    }
  }
}
