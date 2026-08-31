import { createHash } from "node:crypto";
import path from "node:path";

import { parse as parseYaml } from "yaml";
import type { z } from "zod";

import { millConfigSchema, taskPacketSchema } from "../contracts/schemas.js";
import { canonicalDigest, type JsonValue } from "../contracts/canonical.js";
import { ExitCode, MillError } from "../errors.js";
import { safeReadText } from "../security/safe-path.js";

export type MillConfig = z.infer<typeof millConfigSchema>;
export type TaskPacket = z.infer<typeof taskPacketSchema>;

export interface RuntimeInputs {
  config: MillConfig;
  task: TaskPacket;
  taskPath: string;
  taskDigest: string;
  configDigest: string;
  protectedPaths: readonly string[];
}

export function textDigest(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function parseContract<T>(
  source: string,
  schema: z.ZodType<T>,
  label: string,
): T {
  let raw: unknown;
  try {
    raw = parseYaml(source);
  } catch (error) {
    throw new MillError(
      "INVALID_RUNTIME_CONTRACT",
      `${label} is not valid YAML.`,
      ExitCode.data,
      { cause: String(error) },
    );
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new MillError(
      "INVALID_RUNTIME_CONTRACT",
      `${label} does not satisfy its schema.`,
      ExitCode.data,
      { issues: parsed.error.issues },
    );
  }
  return parsed.data;
}

function validateRelative(value: string, label: string): void {
  if (
    path.isAbsolute(value) ||
    value.split(/[\\/]/u).includes("..") ||
    value.includes("\0")
  ) {
    throw new MillError(
      "INVALID_RUNTIME_PATH",
      `${label} must be an in-repository relative path.`,
      ExitCode.configuration,
      { value },
    );
  }
}

function validatePathPattern(value: string, label: string): void {
  const remaining = value.endsWith("/**") ? value.slice(0, -3) : value;
  validateRelative(remaining, label);
  if (/[*?[\]]/u.test(remaining)) {
    throw new MillError(
      "UNSUPPORTED_PATH_PATTERN",
      `${label} must be exact or use only a trailing /** directory prefix.`,
      ExitCode.configuration,
      { value },
    );
  }
}

function matchesPattern(candidate: string, pattern: string): boolean {
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3).replace(/\/$/u, "");
    return candidate === prefix || candidate.startsWith(`${prefix}/`);
  }
  return candidate === pattern;
}

function patternsOverlap(first: string, second: string): boolean {
  const firstPrefix = first.endsWith("/**");
  const secondPrefix = second.endsWith("/**");
  const firstBase = firstPrefix
    ? first.slice(0, -3).replace(/\/$/u, "")
    : first;
  const secondBase = secondPrefix
    ? second.slice(0, -3).replace(/\/$/u, "")
    : second;
  if (firstPrefix && secondPrefix) {
    return (
      firstBase === secondBase ||
      firstBase.startsWith(`${secondBase}/`) ||
      secondBase.startsWith(`${firstBase}/`)
    );
  }
  if (firstPrefix) return matchesPattern(secondBase, first);
  if (secondPrefix) return matchesPattern(firstBase, second);
  return firstBase === secondBase;
}

export async function loadRuntimeInputs(
  root: string,
  taskPath: string,
): Promise<RuntimeInputs> {
  validateRelative(taskPath, "Task path");
  const [configSource, taskSource] = await Promise.all([
    safeReadText(root, "mill.yaml", 512 * 1024),
    safeReadText(root, taskPath, 512 * 1024),
  ]);
  const config = parseContract(configSource, millConfigSchema, "mill.yaml");
  const task = parseContract(taskSource, taskPacketSchema, taskPath);
  for (const candidate of [
    ...task.contextPaths,
    task.authority.productContract.path,
    task.authority.scenarioSet.path,
    task.authority.policy.path,
    ...Object.values(config.commands).map((command) => command.cwd),
    ...Object.values(config.commands).flatMap(
      (command) => command.controlPaths,
    ),
  ]) {
    validateRelative(candidate.replace(/\/\*\*$/u, ""), "Runtime path");
  }
  for (const candidate of [...task.allowedPaths, ...config.sensitivePaths]) {
    validatePathPattern(candidate, "Runtime path pattern");
  }
  for (const commandId of task.commandIds) {
    if (!Object.hasOwn(config.commands, commandId)) {
      throw new MillError(
        "UNKNOWN_COMMAND_ID",
        `Task selects unknown command ID: ${commandId}`,
        ExitCode.configuration,
      );
    }
  }
  const selectedControlPaths = task.commandIds.flatMap(
    (commandId) => config.commands[commandId]?.controlPaths ?? [],
  );
  const protectedPaths = [
    "mill.yaml",
    taskPath,
    ...Object.values(task.authority).map((reference) => reference.path),
    ...task.contextPaths,
    ...selectedControlPaths,
    ".gitattributes",
    ".gitmodules",
  ].filter((candidate, index, values) => values.indexOf(candidate) === index);
  for (const protectedPath of protectedPaths) {
    if (
      task.allowedPaths.some((pattern) =>
        patternsOverlap(protectedPath, pattern),
      )
    ) {
      throw new MillError(
        "BOUND_INPUT_SCOPE_OVERLAP",
        `Allowed output scope overlaps a bound runtime input: ${protectedPath}`,
        ExitCode.configuration,
      );
    }
  }
  for (const reference of Object.values(task.authority)) {
    const source = await safeReadText(root, reference.path, 2 * 1024 * 1024);
    if (textDigest(source) !== reference.digest) {
      throw new MillError(
        "AUTHORITY_DIGEST_MISMATCH",
        `Authority digest does not match ${reference.path}.`,
        ExitCode.configuration,
      );
    }
  }
  for (const controlPath of selectedControlPaths) {
    if (!controlPath.endsWith("/**")) {
      await safeReadText(root, controlPath, 2 * 1024 * 1024);
    }
  }
  return {
    config,
    task,
    taskPath,
    taskDigest: canonicalDigest(task),
    configDigest: canonicalDigest(config as unknown as JsonValue),
    protectedPaths,
  };
}

export async function loadMillConfig(root: string): Promise<MillConfig> {
  const source = await safeReadText(root, "mill.yaml", 512 * 1024);
  return parseContract(source, millConfigSchema, "mill.yaml");
}
