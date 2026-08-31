import { constants } from "node:fs";
import { access, realpath } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  findRepositoryRoot,
  readLockStatus,
  type LockStatus,
} from "./config/lock.js";
import { isWithin } from "./security/safe-path.js";

export type DoctorMode = "inspect" | "build" | "propose";

export interface ToolStatus {
  name: string;
  required: boolean;
  available: boolean;
  executable?: string;
  version?: string;
}

export interface DoctorReport {
  mode: DoctorMode;
  root: string;
  runtime: ToolStatus;
  tools: readonly ToolStatus[];
  lock: LockStatus;
}

const searchDirectories = ["/usr/bin", "/usr/local/bin", "/opt/homebrew/bin"];
const minimumNodeVersion = [24, 20, 0] as const;

export function isSupportedNodeVersion(version: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u.exec(version);
  if (match === null) {
    return false;
  }
  const current = match.slice(1, 4).map((part) => Number(part));
  if (current.some((part) => !Number.isSafeInteger(part))) {
    return false;
  }
  if (current[0] !== minimumNodeVersion[0]) {
    return false;
  }
  for (let index = 1; index < minimumNodeVersion.length; index += 1) {
    const actual = current[index] ?? 0;
    const minimum = minimumNodeVersion[index] ?? 0;
    if (actual > minimum) {
      return true;
    }
    if (actual < minimum) {
      return false;
    }
  }
  return true;
}

async function executable(
  name: string,
  root: string,
): Promise<string | undefined> {
  for (const directory of searchDirectories) {
    const candidate = path.join(directory, name);
    try {
      await access(candidate, constants.X_OK);
      const canonical = await realpath(candidate);
      if (!isWithin(await realpath(root), canonical)) {
        return canonical;
      }
    } catch {
      // Try the next trusted host directory.
    }
  }
  return undefined;
}

function versionOf(
  executablePath: string,
  argument = "--version",
): string | undefined {
  const result = spawnSync(executablePath, [argument], {
    encoding: "utf8",
    env: {
      HOME: "/var/empty",
      LANG: "C",
      LC_ALL: "C",
      PATH: searchDirectories.join(path.delimiter),
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_PAGER: "cat",
      PAGER: "cat",
    },
    timeout: 5_000,
  });
  if (result.status !== 0) {
    return undefined;
  }
  return result.stdout.trim() || result.stderr.trim() || undefined;
}

async function tool(
  name: string,
  root: string,
  required: boolean,
): Promise<ToolStatus> {
  const executablePath = await executable(name, root);
  if (executablePath === undefined) {
    return { name, required, available: false };
  }
  const version = versionOf(executablePath);
  return {
    name,
    required,
    available: version !== undefined,
    executable: executablePath,
    ...(version === undefined ? {} : { version }),
  };
}

export async function doctor(
  start: string,
  mode: DoctorMode,
): Promise<DoctorReport> {
  const root = await findRepositoryRoot(start);
  const runtimeVersion = process.versions.node;
  const runtime: ToolStatus = {
    name: "node",
    required: true,
    available: isSupportedNodeVersion(runtimeVersion),
    executable: process.execPath,
    version: runtimeVersion,
  };
  const tools = await Promise.all([
    tool("git", root, true),
    tool("codex", root, mode !== "inspect"),
    tool("gh", root, mode === "propose"),
  ]);
  return { mode, root, runtime, tools, lock: await readLockStatus(root) };
}

export function doctorReady(report: DoctorReport): boolean {
  return (
    report.runtime.available &&
    report.lock.compatible &&
    report.tools.every((item) => !item.required || item.available)
  );
}
