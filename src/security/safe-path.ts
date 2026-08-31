import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";

import { ExitCode, MillError } from "../errors.js";

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const strictUtf8Decoder = new TextDecoder("utf-8", { fatal: true });

function filesystemCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

function inputFileError(error: unknown, requestedPath: string): MillError {
  const code = filesystemCode(error);
  if (code === "ENOENT" || code === "ENOTDIR") {
    return new MillError(
      "FILE_NOT_FOUND",
      `Input file does not exist: ${requestedPath}`,
      ExitCode.data,
    );
  }
  if (code === "EACCES" || code === "EPERM") {
    return new MillError(
      "FILE_NOT_READABLE",
      `Input file is not readable: ${requestedPath}`,
      ExitCode.data,
    );
  }
  return new MillError(
    "FILE_ACCESS_FAILED",
    `Input file could not be inspected: ${requestedPath}`,
    ExitCode.data,
  );
}

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

  let before;
  try {
    before = await lstat(resolved);
  } catch (error) {
    throw inputFileError(error, requestedPath);
  }
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

  let canonicalFile;
  try {
    canonicalFile = await realpath(resolved);
  } catch (error) {
    throw inputFileError(error, requestedPath);
  }
  if (!isWithin(canonicalRoot, canonicalFile)) {
    throw new MillError(
      "PATH_OUTSIDE_ROOT",
      `Resolved path is outside the approved root: ${requestedPath}`,
      ExitCode.data,
    );
  }

  let handle;
  try {
    handle = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    throw inputFileError(error, requestedPath);
  }
  try {
    const after = await handle.stat();
    if (
      !after.isFile() ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    ) {
      throw new MillError(
        "FILE_CHANGED_DURING_READ",
        `File identity changed during inspection: ${requestedPath}`,
        ExitCode.data,
      );
    }
    if (after.size > maxBytes) {
      throw new MillError(
        "FILE_TOO_LARGE",
        `File exceeds the ${maxBytes}-byte inspection limit: ${requestedPath}`,
        ExitCode.data,
      );
    }
    const bytes = await handle.readFile();
    if (bytes.byteLength > maxBytes) {
      throw new MillError(
        "FILE_TOO_LARGE",
        `File exceeds the ${maxBytes}-byte inspection limit: ${requestedPath}`,
        ExitCode.data,
      );
    }
    const final = await handle.stat();
    if (
      final.dev !== after.dev ||
      final.ino !== after.ino ||
      final.size !== after.size ||
      final.mtimeMs !== after.mtimeMs ||
      final.ctimeMs !== after.ctimeMs
    ) {
      throw new MillError(
        "FILE_CHANGED_DURING_READ",
        `File identity changed during inspection: ${requestedPath}`,
        ExitCode.data,
      );
    }
    try {
      return strictUtf8Decoder.decode(bytes);
    } catch (error) {
      throw new MillError(
        "INVALID_UTF8",
        `Expected valid UTF-8 text: ${requestedPath}`,
        ExitCode.data,
        { cause: String(error) },
      );
    }
  } finally {
    await handle.close();
  }
}
