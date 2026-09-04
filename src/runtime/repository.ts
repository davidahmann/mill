import { createHash } from "node:crypto";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { findTrustedExecutable } from "../doctor.js";
import { ExitCode, MillError } from "../errors.js";
import { scanRepository } from "../repository/scan.js";
import { isWithin } from "../security/safe-path.js";
import type { TaskPacket } from "./inputs.js";
import { runProcess } from "./process.js";

const gitEnvironment: NodeJS.ProcessEnv = {
  HOME: "/var/empty",
  LANG: "C",
  LC_ALL: "C",
  PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_PAGER: "cat",
  PAGER: "cat",
};

export interface CandidateIdentity {
  commit: string;
  tree: string;
}

export interface GitControlSnapshot {
  schemaVersion: "1";
  currentRef: string;
  commonConfig: string | null;
  worktreeConfig: string | null;
  infoAttributes: string | null;
  otherRefs: string;
}

async function controlFileDigest(file: string): Promise<string | null> {
  try {
    const information = await lstat(file);
    if (
      !information.isFile() ||
      information.isSymbolicLink() ||
      information.size > 2 * 1024 * 1024
    ) {
      throw new MillError(
        "UNSAFE_GIT_CONTROL_FILE",
        "A Git control file is not a bounded regular file.",
        ExitCode.configuration,
      );
    }
    return `sha256:${createHash("sha256")
      .update(await readFile(file))
      .digest("hex")}`;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function captureGitControlState(
  worktree: string,
): Promise<GitControlSnapshot> {
  const commonDirectory = await commonGitDirectory(worktree);
  const gitDirectoryValue = (
    await git(worktree, ["rev-parse", "--git-dir"])
  ).trim();
  const gitDirectory = await realpath(
    path.isAbsolute(gitDirectoryValue)
      ? gitDirectoryValue
      : path.resolve(worktree, gitDirectoryValue),
  );
  const currentRef = (
    await git(worktree, ["symbolic-ref", "--quiet", "HEAD"])
  ).trim();
  const otherRefs = (
    await git(worktree, ["for-each-ref", "--format=%(refname)%09%(objectname)"])
  )
    .split("\n")
    .filter(
      (line) =>
        line.length > 0 &&
        !line.startsWith(`${currentRef}\t`) &&
        !line.startsWith("refs/codex/turn-diffs/"),
    )
    .sort()
    .join("\n");
  return {
    schemaVersion: "1",
    currentRef,
    commonConfig: await controlFileDigest(path.join(commonDirectory, "config")),
    worktreeConfig: await controlFileDigest(
      path.join(gitDirectory, "config.worktree"),
    ),
    infoAttributes: await controlFileDigest(
      path.join(commonDirectory, "info", "attributes"),
    ),
    otherRefs: `sha256:${createHash("sha256").update(otherRefs, "utf8").digest("hex")}`,
  };
}

export async function assertGitControlState(
  worktree: string,
  expected: GitControlSnapshot,
): Promise<void> {
  const actual = await captureGitControlState(worktree);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new MillError(
      "GIT_CONTROL_DRIFT",
      "Git configuration, attributes, branch identity, or unrelated refs changed during execution.",
      ExitCode.configuration,
      { expected, actual },
    );
  }
}

async function git(
  root: string,
  args: readonly string[],
  maxOutputBytes = 4 * 1024 * 1024,
): Promise<string> {
  const executable = await findTrustedExecutable("git", root);
  if (executable === undefined) {
    throw new MillError(
      "GIT_UNAVAILABLE",
      "A trusted Git executable is required.",
      ExitCode.unavailable,
    );
  }
  const result = await runProcess({
    executable,
    args: [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "diff.external=",
      ...args,
    ],
    cwd: root,
    env: gitEnvironment,
    deadlineMs: Date.now() + 30_000,
    maxOutputBytes,
  });
  if (result.timedOut || result.outputExceeded || result.exitCode !== 0) {
    throw new MillError(
      "GIT_COMMAND_FAILED",
      `Git command failed: git ${args[0] ?? ""}`,
      ExitCode.io,
      {
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        outputExceeded: result.outputExceeded,
        stderr: result.stderr.slice(0, 2_000),
      },
    );
  }
  return result.stdout;
}

export async function commonGitDirectory(root: string): Promise<string> {
  const value = (await git(root, ["rev-parse", "--git-common-dir"])).trim();
  const candidate = path.isAbsolute(value) ? value : path.resolve(root, value);
  const canonical = await realpath(candidate);
  if (!(await stat(canonical)).isDirectory()) {
    throw new MillError(
      "INVALID_GIT_COMMON_DIRECTORY",
      "Git common directory is not a directory.",
      ExitCode.configuration,
    );
  }
  return canonical;
}

export async function resolveCommit(
  root: string,
  reference: string,
): Promise<string> {
  const value = (
    await git(root, ["rev-parse", "--verify", `${reference}^{commit}`])
  ).trim();
  if (!/^[a-f0-9]{40}$/u.test(value)) {
    throw new MillError(
      "INVALID_GIT_IDENTITY",
      "Git did not return a full commit identity.",
      ExitCode.configuration,
    );
  }
  return value;
}

export async function readCandidateIdentity(
  root: string,
  reference = "HEAD",
): Promise<CandidateIdentity> {
  const commit = await resolveCommit(root, reference);
  const tree = (await git(root, ["rev-parse", `${commit}^{tree}`])).trim();
  if (!/^[a-f0-9]{40}$/u.test(tree)) {
    throw new MillError(
      "INVALID_CANDIDATE_TREE",
      "Git did not return a full candidate tree identity.",
      ExitCode.configuration,
    );
  }
  return { commit, tree };
}

export async function assertRepositoryWorktreeClean(
  root: string,
): Promise<void> {
  await assertVisibleIndexState(root);
  const status = await git(root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  if (status.length > 0) {
    throw new MillError(
      "DIRTY_CHECKOUT",
      "Repository audit requires a clean exact candidate checkout.",
      ExitCode.configuration,
    );
  }
}

export async function repositoryRemoteUrl(
  root: string,
  remoteName: string,
): Promise<string> {
  if (!/^[A-Za-z0-9._-]+$/u.test(remoteName)) {
    throw new MillError(
      "INVALID_REMOTE_NAME",
      "The configured Git remote name is invalid.",
      ExitCode.configuration,
    );
  }
  const values = (await git(root, ["remote", "get-url", "--all", remoteName]))
    .split("\n")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (values.length !== 1) {
    throw new MillError(
      "AMBIGUOUS_REMOTE_URL",
      "The configured Git remote must resolve to exactly one URL.",
      ExitCode.configuration,
      { remoteName, count: values.length },
    );
  }
  const remoteUrl = values[0];
  if (remoteUrl === undefined) {
    throw new MillError(
      "AMBIGUOUS_REMOTE_URL",
      "The configured Git remote did not resolve to a URL.",
      ExitCode.configuration,
    );
  }
  return remoteUrl;
}

async function assertNoDangerousAttributes(
  root: string,
  baseCommit: string,
  commonDirectory: string,
): Promise<void> {
  const listing = await git(root, [
    "ls-tree",
    "-rz",
    "--format=%(objectname)%x09%(path)",
    baseCommit,
  ]);
  for (const record of listing.split("\0")) {
    if (record.length === 0) continue;
    const separator = record.indexOf("\t");
    if (separator !== 40) {
      throw new MillError(
        "INVALID_GIT_TREE_RECORD",
        "Git tree output could not be classified safely.",
        ExitCode.configuration,
      );
    }
    const objectId = record.slice(0, separator);
    const file = record.slice(separator + 1);
    if (path.basename(file) !== ".gitattributes") continue;
    const source = await git(root, ["cat-file", "blob", objectId], 512 * 1024);
    for (const line of source.split(/\r?\n/u)) {
      const content = line.trim();
      if (content.length === 0 || content.startsWith("#")) continue;
      if (
        /(?:^|\s)-?filter(?:=|\s|$)/iu.test(content) ||
        /(?:^|\s)working-tree-encoding(?:=|\s|$)/iu.test(content)
      ) {
        throw new MillError(
          "UNSAFE_GIT_ATTRIBUTES",
          `Executable or transforming Git attributes are not supported: ${file}`,
          ExitCode.configuration,
        );
      }
    }
  }
  const informationAttributes = path.join(
    commonDirectory,
    "info",
    "attributes",
  );
  try {
    const information = await lstat(informationAttributes);
    if (!information.isFile() || information.isSymbolicLink()) {
      throw new Error("not a regular file");
    }
    if (information.size > 0) {
      const source = await readFile(informationAttributes, "utf8");
      if (
        source
          .split(/\r?\n/u)
          .some(
            (line) => line.trim().length > 0 && !line.trim().startsWith("#"),
          )
      ) {
        throw new Error("non-empty info attributes");
      }
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return;
    throw new MillError(
      "UNSAFE_GIT_ATTRIBUTES",
      "Git info attributes are present or cannot be classified safely.",
      ExitCode.configuration,
      { cause: String(error) },
    );
  }
}

function matchesPathPattern(
  candidate: string,
  patterns: readonly string[],
): boolean {
  return patterns.some((pattern) => {
    if (pattern.endsWith("/**")) {
      const prefix = pattern.slice(0, -3).replace(/\/$/u, "");
      return candidate === prefix || candidate.startsWith(`${prefix}/`);
    }
    return candidate === pattern;
  });
}

async function assertSafeTrackedTree(
  root: string,
  baseCommit: string,
  sensitivePatterns: readonly string[],
): Promise<void> {
  validateAllowedPatterns(sensitivePatterns);
  const listing = await git(root, [
    "ls-tree",
    "-rz",
    "--full-tree",
    "--format=%(objectmode)%x09%(path)",
    baseCommit,
  ]);
  for (const record of listing.split("\0")) {
    if (record.length === 0) continue;
    const separator = record.indexOf("\t");
    if (separator <= 0) {
      throw new MillError(
        "INVALID_GIT_TREE_RECORD",
        "Git tree output could not be classified safely.",
        ExitCode.configuration,
      );
    }
    const mode = record.slice(0, separator);
    const file = record.slice(separator + 1);
    if (mode === "120000") {
      throw new MillError(
        "TRACKED_SYMLINK_FORBIDDEN",
        `Tracked symlinks are not supported for build execution: ${file}`,
        ExitCode.configuration,
      );
    }
    if (matchesPathPattern(file, sensitivePatterns)) {
      throw new MillError(
        "TRACKED_SENSITIVE_PATH_FORBIDDEN",
        `A configured sensitive path is tracked and would be visible to the builder: ${file}`,
        ExitCode.configuration,
      );
    }
  }
}

async function assertNoHistorySubstitution(
  root: string,
  commonDirectory: string,
): Promise<void> {
  const replacementRefs = (
    await git(root, ["for-each-ref", "--format=%(refname)", "refs/replace/"])
  )
    .split("\n")
    .filter((reference) => reference.length > 0);
  if (replacementRefs.length > 0) {
    throw new MillError(
      "HISTORY_SUBSTITUTION_FORBIDDEN",
      "Git replacement refs are not supported for exact-base delivery.",
      ExitCode.configuration,
      { replacementRefs },
    );
  }
  const grafts = path.join(commonDirectory, "info", "grafts");
  try {
    const information = await lstat(grafts);
    if (
      !information.isFile() ||
      information.isSymbolicLink() ||
      information.size > 0
    ) {
      throw new MillError(
        "HISTORY_SUBSTITUTION_FORBIDDEN",
        "Git graft metadata is not supported for exact-base delivery.",
        ExitCode.configuration,
      );
    }
  } catch (error) {
    if (error instanceof MillError) throw error;
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw new MillError(
      "HISTORY_SUBSTITUTION_FORBIDDEN",
      "Git graft metadata could not be classified safely.",
      ExitCode.configuration,
      { cause: String(error) },
    );
  }
}

export async function qualifyRepositoryForBuild(
  root: string,
  baseRef: string,
  sensitivePatterns: readonly string[] = [],
): Promise<{ baseCommit: string; commonDirectory: string }> {
  await assertVisibleIndexState(root);
  const scan = await scanRepository(root);
  if (
    scan.gitConfigHazards.length > 0 ||
    scan.truncatedDirectories.length > 0
  ) {
    throw new MillError(
      "UNSAFE_REPOSITORY_FOR_BUILD",
      "Static repository qualification found Git hazards or an incomplete scan.",
      ExitCode.configuration,
      {
        gitConfigHazards: scan.gitConfigHazards,
        truncatedDirectories: scan.truncatedDirectories,
      },
    );
  }
  const commonDirectory = await commonGitDirectory(root);
  await assertNoHistorySubstitution(root, commonDirectory);
  const baseCommit = await resolveCommit(root, baseRef);
  await assertNoDangerousAttributes(root, baseCommit, commonDirectory);
  await assertSafeTrackedTree(root, baseCommit, sensitivePatterns);
  const status = await git(root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  if (status.length > 0) {
    throw new MillError(
      "DIRTY_CHECKOUT",
      "The operator checkout must be clean before local delivery begins.",
      ExitCode.configuration,
    );
  }
  return { baseCommit, commonDirectory };
}

export async function createCandidateWorktree(
  root: string,
  destination: string,
  baseCommit: string,
  taskId: string,
  runId: string,
): Promise<string> {
  await createDetachedWorktree(root, destination, baseCommit);
  const branch = `mill/${taskId.slice(0, 32)}-${runId.slice(0, 8)}`;
  try {
    await git(destination, ["switch", "-c", branch]);
  } catch (error) {
    await removeCandidateWorktree(root, destination);
    await deleteCandidateBranch(root, branch, baseCommit);
    throw error;
  }
  return branch;
}

export async function deleteCandidateBranch(
  root: string,
  branch: string,
  expectedCommit: string,
): Promise<void> {
  if (!/^mill\/[a-zA-Z0-9._-]+$/u.test(branch)) {
    throw new MillError(
      "UNSAFE_CANDIDATE_BRANCH",
      "Only a validated Mill-owned candidate branch may be removed.",
      ExitCode.configuration,
    );
  }
  await git(root, ["update-ref", "-d", `refs/heads/${branch}`, expectedCommit]);
}

export async function createDetachedWorktree(
  root: string,
  destination: string,
  baseCommit: string,
): Promise<void> {
  const stateRoot = path.dirname(path.dirname(destination));
  if (!isWithin(stateRoot, destination)) {
    throw new MillError(
      "UNSAFE_WORKTREE_PATH",
      "Candidate worktree escaped the Mill state namespace.",
      ExitCode.configuration,
    );
  }
  await git(root, ["worktree", "add", "--detach", destination, baseCommit]);
}

export async function removeCandidateWorktree(
  root: string,
  destination: string,
): Promise<void> {
  try {
    await lstat(destination);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      await git(root, ["worktree", "prune", "--expire", "now"]);
      return;
    }
    throw error;
  }
  await git(root, ["worktree", "remove", "--force", destination]);
}

export async function resetCandidateWorktree(
  worktree: string,
  commit: string,
): Promise<void> {
  await git(worktree, ["reset", "--hard", commit]);
  await git(worktree, ["clean", "-dffx"]);
}

async function candidateStatus(worktree: string): Promise<string> {
  await assertVisibleIndexState(worktree);
  const [status, ignored] = await Promise.all([
    git(worktree, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    git(worktree, [
      "ls-files",
      "--others",
      "--ignored",
      "--exclude-standard",
      "-z",
    ]),
  ]);
  return `${status}${ignored}`;
}

export async function assertVisibleIndexState(worktree: string): Promise<void> {
  const entries = (await git(worktree, ["ls-files", "-v", "-z"]))
    .split("\0")
    .filter((entry) => entry.length > 0);
  const hidden = entries.filter((entry) => !entry.startsWith("H "));
  if (hidden.length > 0) {
    throw new MillError(
      "HIDDEN_GIT_INDEX_STATE",
      "Candidate promotion forbids index flags or non-normal tracked entries that can hide working-tree changes.",
      ExitCode.configuration,
      { entries: hidden.slice(0, 20) },
    );
  }
}

function allowed(pathname: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern.endsWith("/**")) {
      const prefix = pattern.slice(0, -3).replace(/\/$/u, "");
      return pathname === prefix || pathname.startsWith(`${prefix}/`);
    }
    return pathname === pattern;
  });
}

export function validateAllowedPatterns(patterns: readonly string[]): void {
  for (const pattern of patterns) {
    const remaining = pattern.endsWith("/**") ? pattern.slice(0, -3) : pattern;
    if (/[*?[\]]/u.test(remaining)) {
      throw new MillError(
        "UNSUPPORTED_PATH_PATTERN",
        `Allowed path pattern is not exact or a directory prefix: ${pattern}`,
        ExitCode.configuration,
      );
    }
  }
}

export async function changedPaths(
  worktree: string,
  baseCommit: string,
): Promise<readonly string[]> {
  const [tracked, untracked] = await Promise.all([
    git(worktree, ["diff", "--name-only", "--no-renames", "-z", baseCommit]),
    git(worktree, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  return [...new Set([...tracked.split("\0"), ...untracked.split("\0")])]
    .filter((item) => item.length > 0)
    .sort();
}

export async function assertCandidateScope(
  worktree: string,
  baseCommit: string,
  allowedPatterns: readonly string[],
  protectedPaths: readonly string[] = [],
): Promise<readonly string[]> {
  validateAllowedPatterns(allowedPatterns);
  validateAllowedPatterns(protectedPaths);
  if ((await resolveCommit(worktree, "HEAD")) !== baseCommit) {
    throw new MillError(
      "BUILDER_COMMIT_FORBIDDEN",
      "The builder changed Git history; only the lifecycle may create the candidate commit.",
      ExitCode.configuration,
    );
  }
  await assertVisibleIndexState(worktree);
  const paths = await changedPaths(worktree, baseCommit);
  if (paths.length === 0) {
    throw new MillError(
      "EMPTY_CANDIDATE",
      "The builder produced no candidate changes.",
      ExitCode.data,
    );
  }
  for (const changed of paths) {
    const basename = path.posix.basename(changed.replaceAll("\\", "/"));
    if (
      protectedPaths.some((protectedPath) =>
        allowed(changed, [protectedPath]),
      ) ||
      ["AGENTS.md", ".gitattributes", ".gitmodules"].includes(basename)
    ) {
      throw new MillError(
        "BOUND_INPUT_MUTATION",
        `Candidate changed a bound runtime input: ${changed}`,
        ExitCode.configuration,
      );
    }
    if (!allowed(changed, allowedPatterns)) {
      throw new MillError(
        "CANDIDATE_SCOPE_VIOLATION",
        `Candidate changed an unauthorized path: ${changed}`,
        ExitCode.configuration,
      );
    }
    const absolute = path.resolve(worktree, changed);
    if (!isWithin(worktree, absolute)) {
      throw new MillError(
        "CANDIDATE_PATH_ESCAPE",
        "Candidate path escaped the worktree.",
        ExitCode.configuration,
      );
    }
    try {
      if ((await lstat(absolute)).isSymbolicLink()) {
        throw new MillError(
          "CANDIDATE_SYMLINK_FORBIDDEN",
          `Candidate symlink is not supported: ${changed}`,
          ExitCode.configuration,
        );
      }
    } catch (error) {
      if (error instanceof MillError) throw error;
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      )) {
        throw error;
      }
    }
  }
  return paths;
}

export async function commitCandidate(
  worktree: string,
  baseCommit: string,
  task: TaskPacket,
  protectedPaths: readonly string[],
): Promise<CandidateIdentity> {
  const paths = await assertCandidateScope(
    worktree,
    baseCommit,
    task.allowedPaths,
    protectedPaths,
  );
  await git(worktree, ["add", "--", ...paths]);
  await git(worktree, [
    "-c",
    `user.name=${task.commit.authorName}`,
    "-c",
    `user.email=${task.commit.authorEmail}`,
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--no-verify",
    "--no-gpg-sign",
    "-m",
    task.commit.message,
  ]);
  const commit = await resolveCommit(worktree, "HEAD");
  const tree = (await git(worktree, ["rev-parse", `${commit}^{tree}`])).trim();
  if (!/^[a-f0-9]{40}$/u.test(tree)) {
    throw new MillError(
      "INVALID_CANDIDATE_TREE",
      "Git did not return a full candidate tree identity.",
      ExitCode.configuration,
    );
  }
  await git(worktree, ["clean", "-dffx"]);
  const status = await candidateStatus(worktree);
  if (status.length > 0) {
    throw new MillError(
      "CANDIDATE_NOT_CLEAN",
      "Candidate worktree is not clean after the lifecycle commit.",
      ExitCode.configuration,
    );
  }
  return { commit, tree };
}

export async function assertCandidateIdentity(
  worktree: string,
  expected: CandidateIdentity,
): Promise<void> {
  const commit = await resolveCommit(worktree, "HEAD");
  const tree = (await git(worktree, ["rev-parse", `${commit}^{tree}`])).trim();
  const status = await candidateStatus(worktree);
  if (
    commit !== expected.commit ||
    tree !== expected.tree ||
    status.length > 0
  ) {
    throw new MillError(
      "CANDIDATE_DRIFT",
      "Candidate identity or clean-worktree state changed after commitment.",
      ExitCode.configuration,
      { expectedCommit: expected.commit, actualCommit: commit },
    );
  }
}
