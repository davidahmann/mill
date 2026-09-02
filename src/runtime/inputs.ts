import { createHash } from "node:crypto";
import path from "node:path";

import { parse as parseYaml } from "yaml";
import type { z } from "zod";

import {
  impactManifestSchema,
  millConfigSchema,
  productContractSchema,
  scenarioSetSchema,
  taskPacketSchema,
} from "../contracts/schemas.js";
import { canonicalDigest, type JsonValue } from "../contracts/canonical.js";
import { ExitCode, MillError } from "../errors.js";
import { safeReadText } from "../security/safe-path.js";
import {
  assessImpactManifest,
  type ContinuityProductContract,
  type ContinuityScenarioSet,
  type ImpactManifest,
} from "../planning/impact.js";

export type MillConfig = z.infer<typeof millConfigSchema>;
export type TaskPacket = z.infer<typeof taskPacketSchema>;

export interface RuntimeInputs {
  config: MillConfig;
  task: TaskPacket;
  taskPath: string;
  taskDigest: string;
  configDigest: string;
  protectedPaths: readonly string[];
  continuity?: {
    product: ContinuityProductContract;
    scenarios: ContinuityScenarioSet;
    impact: ImpactManifest;
    impactDigest: string;
  };
}

export function textDigest(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

export function assertNewRunTaskContract(task: TaskPacket): void {
  if (task.schemaVersion !== "2") {
    throw new MillError(
      "CONTINUITY_TASK_VERSION_REQUIRED",
      "A new run requires task-packet version 2 and an approved impact manifest; version 1 is resume-only.",
      ExitCode.configuration,
    );
  }
}

function sameMembers(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return (
    actual.length === expected.length &&
    new Set(actual).size === actual.length &&
    actual.every((item) => expected.includes(item))
  );
}

function scenarioCoverage(
  values: readonly ("new_behavior" | "preservation" | "both")[],
): "new_behavior" | "preservation" | "both" {
  if (values.every((value) => value === "new_behavior")) return "new_behavior";
  if (values.every((value) => value === "preservation")) return "preservation";
  return "both";
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
  authorityMode: "authorize" | "readback" = "authorize",
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
    ...(task.schemaVersion === "2" ? [task.authority.impactManifest.path] : []),
    ...Object.values(config.commands).map((command) => command.cwd),
    ...Object.values(config.commands).flatMap(
      (command) => command.controlPaths,
    ),
    ...(config.verifier?.dependencies?.lockPaths ?? []),
    ...(config.verifier?.dependencies === undefined
      ? []
      : [config.verifier.dependencies.targetPath]),
    ...Object.values(config.commands).flatMap(
      (command) => command.writablePaths,
    ),
  ]) {
    validateRelative(candidate.replace(/\/\*\*$/u, ""), "Runtime path");
  }
  for (const candidate of [...task.allowedPaths, ...config.sensitivePaths]) {
    validatePathPattern(candidate, "Runtime path pattern");
  }
  const dependencyTarget = config.verifier?.dependencies?.targetPath;
  if (dependencyTarget !== undefined) {
    for (const command of Object.values(config.commands)) {
      for (const writablePath of command.writablePaths) {
        if (patternsOverlap(dependencyTarget, writablePath)) {
          throw new MillError(
            "VERIFIER_MOUNT_OVERLAP",
            "A verifier dependency target cannot overlap a writable scratch mount.",
            ExitCode.configuration,
            { dependencyTarget, writablePath },
          );
        }
      }
    }
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
  const dependencyLockPaths = config.verifier?.dependencies?.lockPaths ?? [];
  const protectedPaths = [
    "mill.yaml",
    taskPath,
    ...Object.values(task.authority).map((reference) => reference.path),
    ...task.contextPaths,
    ...selectedControlPaths,
    ...dependencyLockPaths,
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
  let continuity: RuntimeInputs["continuity"];
  if (task.schemaVersion === "2") {
    const [productSource, scenarioSource, impactSource] = await Promise.all([
      safeReadText(root, task.authority.productContract.path, 2 * 1024 * 1024),
      safeReadText(root, task.authority.scenarioSet.path, 2 * 1024 * 1024),
      safeReadText(root, task.authority.impactManifest.path, 2 * 1024 * 1024),
    ]);
    const product = parseContract(
      productSource,
      productContractSchema,
      task.authority.productContract.path,
    );
    const scenarios = parseContract(
      scenarioSource,
      scenarioSetSchema,
      task.authority.scenarioSet.path,
    );
    const impact = parseContract(
      impactSource,
      impactManifestSchema,
      task.authority.impactManifest.path,
    );
    const assessment = assessImpactManifest({
      manifest: impact,
      product,
      scenarios,
      authorityMode,
    });
    const blockers = [...assessment.blockers];
    if (impact.riskClass !== task.riskClass) {
      blockers.push("task and impact risk classes differ");
    }
    for (const id of impact.commandIds) {
      if (!task.commandIds.includes(id)) {
        blockers.push(`impact command is absent from task: ${id}`);
      }
    }
    for (const id of impact.acceptanceIds) {
      if (!task.acceptance.some((acceptance) => acceptance.id === id)) {
        blockers.push(`impact acceptance is absent from task: ${id}`);
      }
    }
    if (
      !sameMembers(
        task.acceptance.map((item) => item.id),
        impact.acceptanceIds,
      )
    ) {
      blockers.push("task acceptance IDs do not exactly match approved impact");
    }
    const productAcceptance = new Map(
      product.acceptance.map((acceptance) => [acceptance.id, acceptance]),
    );
    const selectedScenarios = scenarios.scenarios.filter((scenario) =>
      impact.scenarioIds.includes(scenario.id),
    );
    for (const acceptance of task.acceptance) {
      const approved = productAcceptance.get(acceptance.id);
      if (approved === undefined) continue;
      if (acceptance.statement !== approved.statement) {
        blockers.push(
          `task acceptance statement differs from product contract: ${acceptance.id}`,
        );
      }
      const linkedScenarios = selectedScenarios.filter((scenario) =>
        scenario.acceptanceRefs.includes(acceptance.id),
      );
      const expectedScenarios = linkedScenarios.map((scenario) => scenario.id);
      if (!sameMembers(acceptance.scenarioIds, expectedScenarios)) {
        blockers.push(
          `task scenario graph differs from approved impact: ${acceptance.id}`,
        );
      }
      const expectedInvariants = [
        ...new Set(
          linkedScenarios.flatMap((scenario) => scenario.invariantRefs),
        ),
      ];
      if (!sameMembers(acceptance.invariantIds, expectedInvariants)) {
        blockers.push(
          `task invariant graph differs from approved impact: ${acceptance.id}`,
        );
      }
      if (
        linkedScenarios.length > 0 &&
        acceptance.coverage !==
          scenarioCoverage(linkedScenarios.map((scenario) => scenario.coverage))
      ) {
        blockers.push(
          `task coverage differs from approved scenario graph: ${acceptance.id}`,
        );
      }
    }
    if (blockers.length > 0) {
      throw new MillError(
        "CONTINUITY_AUTHORITY_BLOCKED",
        "The approved impact and semantic task authority are inconsistent.",
        ExitCode.configuration,
        { blockers: [...new Set(blockers)].sort() },
      );
    }
    continuity = {
      product,
      scenarios,
      impact,
      impactDigest: assessment.manifestDigest,
    };
  }
  return {
    config,
    task,
    taskPath,
    taskDigest: canonicalDigest(task),
    configDigest: canonicalDigest(config as unknown as JsonValue),
    protectedPaths,
    ...(continuity === undefined ? {} : { continuity }),
  };
}

export async function loadMillConfig(root: string): Promise<MillConfig> {
  const source = await safeReadText(root, "mill.yaml", 512 * 1024);
  return parseContract(source, millConfigSchema, "mill.yaml");
}
