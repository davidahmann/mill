import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";

import { ExitCode, MillError } from "../errors.js";

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

export function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

export async function safeReadText(
  root: string,
  requestedPath: string,
  maxBytes = DEFAULT_MAX_BYTES,
): Promise<string> {
  const canonicalRoot = await realpath(root);
  const resolved = path.resolve(canonicalRoot, requestedPath);
  if (!isWithin(canonicalRoot, resolved)) {
    throw new MillError(
      "PATH_OUTSIDE_ROOT",
      `Path is outside the approved root: ${requestedPath}`,
      ExitCode.data,
    );
  }

  const before = await lstat(resolved);
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new MillError(
      "UNSAFE_FILE_TYPE",
      `Expected a regular, non-symlink file: ${requestedPath}`,
      ExitCode.data,
    );
  }
  if (before.size > maxBytes) {
    throw new MillError(
      "FILE_TOO_LARGE",
      `File exceeds the ${maxBytes}-byte inspection limit: ${requestedPath}`,
      ExitCode.data,
    );
  }

  const canonicalFile = await realpath(resolved);
  if (!isWithin(canonicalRoot, canonicalFile)) {
    throw new MillError(
      "PATH_OUTSIDE_ROOT",
      `Resolved path is outside the approved root: ${requestedPath}`,
      ExitCode.data,
    );
  }

  const handle = await open(
    resolved,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const after = await handle.stat();
    if (
      !after.isFile() ||
      after.dev !== before.dev ||
      after.ino !== before.ino
    ) {
      throw new MillError(
        "FILE_CHANGED_DURING_READ",
        `File identity changed during inspection: ${requestedPath}`,
        ExitCode.data,
      );
    }
    return await handle.readFile({ encoding: "utf8" });
  } finally {
    await handle.close();
  }
}
