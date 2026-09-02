import { lstat, opendir } from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";

import { canonicalDigest, type JsonValue } from "../contracts/canonical.js";
import { contextManifestSchema } from "../contracts/schemas.js";
import { ExitCode, MillError } from "../errors.js";
import { safeReadText } from "../security/safe-path.js";
import type { MillConfig, TaskPacket } from "./inputs.js";
import { textDigest } from "./inputs.js";

export type ContextManifest = z.infer<typeof contextManifestSchema>;

async function effectiveInstructionPaths(root: string): Promise<string[]> {
  const found: string[] = [];
  const visit = async (relative: string): Promise<void> => {
    const directory = await opendir(path.join(root, relative));
    for await (const entry of directory) {
      if (entry.isSymbolicLink()) continue;
      if (
        entry.isDirectory() &&
        ![".git", ".mill", "node_modules"].includes(entry.name)
      ) {
        await visit(path.join(relative, entry.name));
      } else if (entry.isFile() && entry.name === "AGENTS.md") {
        found.push(path.join(relative, entry.name).replaceAll(path.sep, "/"));
        if (found.length > 256) {
          throw new MillError(
            "INSTRUCTION_SCOPE_EXCEEDED",
            "The repository exposes too many effective AGENTS.md instruction files.",
            ExitCode.configuration,
          );
        }
      }
    }
  };
  await visit("");
  return found.sort();
}

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
  const instructions = await effectiveInstructionPaths(worktree);
  const authorityPaths = Object.values(task.authority).map(
    (reference) => reference.path,
  );
  for (const contextPath of [
    ...new Set([...task.contextPaths, ...authorityPaths, ...instructions]),
  ].sort()) {
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
  const effectiveInstructions = instructions.map((instruction) => {
    const frozen = included.find((item) => item.path === instruction);
    if (frozen === undefined) {
      throw new MillError(
        "INSTRUCTION_CONTEXT_MISSING",
        `Effective instruction was not frozen: ${instruction}`,
        ExitCode.configuration,
      );
    }
    return frozen;
  });
  const providerVisibleScope = {
    repositoryScope: "worktree" as const,
    suppliedPaths: included.map((item) => item.path),
    writablePatterns: [...task.allowedPaths].sort(),
    observedReads: "unavailable" as const,
  };
  const contextEpoch = canonicalDigest({
    taskDigest,
    baseCommit,
    included,
    effectiveInstructions,
    providerVisibleScope,
  });
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
    contextEpoch,
    effectiveInstructions,
    providerVisibleScope,
  });
  return {
    manifest,
    digest: canonicalDigest(manifest as unknown as JsonValue),
  };
}

export async function assertContextFresh(
  worktree: string,
  manifest: ContextManifest,
): Promise<void> {
  const instructionPaths = new Set(
    manifest.effectiveInstructions.map((instruction) => instruction.path),
  );
  for (const instruction of manifest.effectiveInstructions) {
    const source = await safeReadText(
      worktree,
      instruction.path,
      2 * 1024 * 1024,
    );
    if (textDigest(source) !== instruction.digest) {
      throw new MillError(
        "INSTRUCTION_DRIFT",
        `Frozen instruction changed: ${instruction.path}`,
        ExitCode.configuration,
      );
    }
  }
  for (const included of manifest.included) {
    if (instructionPaths.has(included.path)) continue;
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
