import { lstat, opendir } from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";

import { canonicalDigest, type JsonValue } from "../contracts/canonical.js";
import { contextManifestSchema } from "../contracts/schemas.js";
import { ExitCode, MillError } from "../errors.js";
import { safeReadText } from "../security/safe-path.js";
import type { MillConfig, TaskPacket } from "./inputs.js";
import { textDigest } from "./inputs.js";
import { discoverRepository } from "../repository/intelligence.js";

export type ContextManifest = z.infer<typeof contextManifestSchema>;

async function effectiveInstructionPaths(root: string): Promise<string[]> {
  const found: string[] = [];
  const visit = async (relative: string): Promise<void> => {
    const directory = await opendir(path.join(root, relative));
    let agents: string | undefined;
    let override: string | undefined;
    for await (const entry of directory) {
      if (entry.isSymbolicLink()) continue;
      if (
        entry.isDirectory() &&
        ![".git", ".mill", "node_modules"].includes(entry.name)
      ) {
        await visit(path.join(relative, entry.name));
      } else if (entry.isFile()) {
        if (entry.name === "AGENTS.md") agents = entry.name;
        if (entry.name === "AGENTS.override.md") override = entry.name;
      }
    }
    const selected = override ?? agents;
    if (selected !== undefined) {
      found.push(path.join(relative, selected).replaceAll(path.sep, "/"));
      if (found.length > 256) {
        throw new MillError(
          "INSTRUCTION_SCOPE_EXCEEDED",
          "The repository exposes too many effective Codex instruction files.",
          ExitCode.configuration,
        );
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
  let contextBytes = 0;
  const instructions = await effectiveInstructionPaths(worktree);
  for (const instruction of instructions) {
    if (sensitive(instruction, task.allowedPaths)) {
      throw new MillError(
        "BOUND_INPUT_SCOPE_OVERLAP",
        `Allowed output scope overlaps an effective repository instruction: ${instruction}`,
        ExitCode.configuration,
      );
    }
  }
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
    contextBytes += Buffer.byteLength(source, "utf8");
    if (contextBytes > (task.budget.maxContextBytes ?? 8 * 1024 * 1024)) {
      throw new MillError(
        "CONTEXT_BUDGET_EXCEEDED",
        "Frozen priority context exceeds the approved byte budget; narrow context before model spend.",
        ExitCode.configuration,
      );
    }
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
  let repositoryContext: ContextManifest["repositoryContext"];
  if (task.repositoryIntelligence === true) {
    const map = await discoverRepository({
      root: worktree,
      changedPaths: task.allowedPaths.filter((value) => !value.endsWith("/**")),
    });
    if (map.source.commit !== baseCommit)
      throw new MillError(
        "DISCOVERY_CONTEXT_STALE",
        "Repository intelligence does not match the admitted base commit.",
        ExitCode.configuration,
      );
    const leads = new Set(
      map.changeImpact.flatMap((impact) =>
        impact.leads.map((lead) => lead.path),
      ),
    );
    const selected = map.modules.filter(
      (module) =>
        sensitive(module.path, task.allowedPaths) || leads.has(module.path),
    );
    repositoryContext = {
      authority: "derived_read_only",
      sourceCommit: map.source.commit,
      mapDigest: map.digest,
      extractorVersion: map.extractor.version,
      modules: selected.slice(0, 24).map((module) => ({
        path: module.path,
        digest: module.digest,
        localImports: module.imports.flatMap((item) =>
          item.targetPath === undefined ? [] : [item.targetPath],
        ),
        unresolvedImports: module.imports.filter(
          (item) => item.resolution !== "resolved_local",
        ).length,
      })),
      omittedModules: selected.length - Math.min(selected.length, 24),
      unknowns: [...map.unknowns],
    };
    if (
      contextBytes + Buffer.byteLength(JSON.stringify(repositoryContext)) >
      (task.budget.maxContextBytes ?? 8 * 1024 * 1024)
    )
      throw new MillError(
        "CONTEXT_BUDGET_EXCEEDED",
        "Repository intelligence exceeds the frozen priority-context budget.",
        ExitCode.configuration,
      );
  }
  const contextEpoch = canonicalDigest({
    taskDigest,
    baseCommit,
    included,
    effectiveInstructions,
    providerVisibleScope,
    ...(repositoryContext === undefined ? {} : { repositoryContext }),
  });
  const manifest = contextManifestSchema.parse({
    schemaVersion: "1",
    ...(repositoryContext === undefined ? {} : { repositoryContext }),
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
  // Legacy manifests predate instruction inventorying. Preserve their exact
  // canonical bytes and resume behavior instead of manufacturing new fields.
  if (manifest.effectiveInstructions === undefined) {
    for (const included of manifest.included) {
      const source = await safeReadText(
        worktree,
        included.path,
        2 * 1024 * 1024,
      );
      if (textDigest(source) !== included.digest) {
        throw new MillError(
          "CONTEXT_DRIFT",
          `Frozen context changed: ${included.path}`,
          ExitCode.configuration,
        );
      }
    }
    return;
  }
  const currentInstructionPaths = await effectiveInstructionPaths(worktree);
  const frozenInstructionPaths = manifest.effectiveInstructions.map(
    (instruction) => instruction.path,
  );
  if (
    currentInstructionPaths.length !== frozenInstructionPaths.length ||
    currentInstructionPaths.some(
      (instruction, index) => instruction !== frozenInstructionPaths[index],
    )
  ) {
    throw new MillError(
      "INSTRUCTION_SET_DRIFT",
      "The effective repository instruction set changed after worker admission.",
      ExitCode.configuration,
    );
  }
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
