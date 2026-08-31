import { lstat } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";

import { millLockSchema } from "../contracts/schemas.js";
import { ExitCode, MillError } from "../errors.js";
import { safeReadText } from "../security/safe-path.js";
import { MILL_PACKAGE, MILL_VERSION } from "../version.js";

export interface LockStatus {
  found: boolean;
  path?: string;
  requiredVersion?: string;
  compatible: boolean;
  invocation?: string;
}

async function exists(candidate: string): Promise<boolean> {
  try {
    await lstat(candidate);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw new MillError(
      "REPOSITORY_MARKER_UNREADABLE",
      `Cannot inspect repository marker: ${candidate}`,
      ExitCode.configuration,
      { cause: String(error) },
    );
  }
}

export async function findRepositoryRoot(start: string): Promise<string> {
  let current = path.resolve(start);
  let nearestLock: string | undefined;
  for (let depth = 0; depth < 128; depth += 1) {
    if (await exists(path.join(current, ".git"))) {
      return current;
    }
    if (
      nearestLock === undefined &&
      (await exists(path.join(current, "mill.lock")))
    ) {
      nearestLock = current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return nearestLock ?? path.resolve(start);
    }
    current = parent;
  }
  if (nearestLock !== undefined) {
    return nearestLock;
  }
  throw new MillError(
    "REPOSITORY_ROOT_DEPTH_EXCEEDED",
    "Repository-root search exceeded its path-depth budget.",
    ExitCode.configuration,
  );
}

export function exactInvocation(version: string): string {
  return `npx --yes ${MILL_PACKAGE}@${version}`;
}

export async function readLockStatus(root: string): Promise<LockStatus> {
  const lockPath = path.join(root, "mill.lock");
  if (!(await exists(lockPath))) {
    return { found: false, compatible: true };
  }
  let source: string;
  try {
    source = await safeReadText(root, "mill.lock", 256 * 1024);
  } catch (error) {
    throw new MillError(
      "INVALID_MILL_LOCK",
      "mill.lock exists but is not a readable regular in-repository file.",
      ExitCode.configuration,
      { cause: String(error) },
    );
  }
  let raw: unknown;
  try {
    raw = parse(source);
  } catch (error) {
    throw new MillError(
      "INVALID_MILL_LOCK",
      `mill.lock is not valid YAML: ${String(error)}`,
      ExitCode.configuration,
    );
  }
  const parsed = millLockSchema.safeParse(raw);
  if (!parsed.success) {
    throw new MillError(
      "INVALID_MILL_LOCK",
      "mill.lock does not satisfy schema version 1.",
      ExitCode.configuration,
      { issues: parsed.error.issues },
    );
  }
  const requiredVersion = parsed.data.mill.version;
  return {
    found: true,
    path: lockPath,
    requiredVersion,
    compatible: requiredVersion === MILL_VERSION,
    invocation: exactInvocation(requiredVersion),
  };
}

export async function enforceExactVersion(root: string): Promise<void> {
  const status = await readLockStatus(root);
  if (!status.compatible && status.requiredVersion !== undefined) {
    throw new MillError(
      "MILL_VERSION_MISMATCH",
      `Repository requires Mill ${status.requiredVersion}; running ${MILL_VERSION}.`,
      ExitCode.configuration,
      {
        exactInvocation: status.invocation,
        requiredVersion: status.requiredVersion,
      },
    );
  }
}
