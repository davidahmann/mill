import type { Dirent } from "node:fs";
import { lstat, opendir, realpath } from "node:fs/promises";
import path from "node:path";

import { canonicalDigest } from "../contracts/canonical.js";
import { ExitCode, MillError } from "../errors.js";
import { safeReadText } from "../security/safe-path.js";

const ignoredDirectories = new Set([
  ".git",
  ".mill",
  "coverage",
  "dist",
  "node_modules",
  "vendor",
]);
const manifestNames = new Set([
  "Cargo.toml",
  "Gemfile",
  "go.mod",
  "package.json",
  "pom.xml",
  "pyproject.toml",
  "requirements.txt",
]);
const documentationNames = new Set([
  "AGENTS.md",
  "CONTRIBUTING.md",
  "README.md",
  "WORKFLOW.md",
]);
const secretReferenceNames = [
  /^\.env(?:\.|$)/u,
  /^\.npmrc$/u,
  /secret/iu,
  /credential/iu,
];
const maximumEntries = 5_000;
const maximumDepth = 8;

export interface ScanObservation {
  kind: "observed" | "inferred" | "missing" | "conflicting";
  subject: string;
  sources: readonly string[];
  confidence: "high" | "medium" | "low";
}

export interface RepositoryScan {
  root: string;
  digest: string;
  entriesVisited: number;
  filesVisited: number;
  symlinksSkipped: readonly string[];
  truncatedDirectories: readonly string[];
  manifests: readonly string[];
  documentation: readonly string[];
  workflows: readonly string[];
  secretReferences: readonly string[];
  gitConfigHazards: readonly string[];
  observations: readonly ScanObservation[];
  executableBaseline: "unverified";
}

interface WalkState {
  entries: number;
  files: string[];
  symlinks: string[];
  truncatedDirectories: string[];
}

export interface ScanLimits {
  maxDepth: number;
  maxEntries: number;
}

interface NormalizedConfigLine {
  source: string;
  ambiguous: boolean;
}

interface GitConfigurationSnapshot {
  digest: string;
  hazards: string[];
}

function normalizeConfigLine(rawLine: string): NormalizedConfigLine {
  let quoted = false;
  let escaped = false;
  let source = "";
  for (const character of rawLine) {
    if (escaped) {
      source += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      source += character;
      escaped = true;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      source += character;
      continue;
    }
    if (!quoted && (character === "#" || character === ";")) {
      break;
    }
    source += character;
  }
  return { source: source.trim(), ambiguous: quoted || escaped };
}

function ambiguousValue(value: string): boolean {
  return value.includes('"') || value.includes("\\");
}

function gitConfigHazards(source: string): string[] {
  const hazards = new Set<string>();
  let section = "";
  const lines = source.split(/\r?\n/u);
  for (const [index, rawLine] of lines.entries()) {
    const lineNumber = index + 1;
    const normalized = normalizeConfigLine(rawLine);
    const line = normalized.source;
    if (line === "" || line.startsWith("#") || line.startsWith(";")) {
      continue;
    }
    if (normalized.ambiguous) {
      hazards.add(`unparseable_git_config_line:${lineNumber}`);
      section = "";
      continue;
    }
    const sectionMatch =
      /^\[\s*([A-Za-z0-9.-]+)(?:\s+"(?:[^"\\]|\\.)*")?\s*\]$/u.exec(line);
    if (sectionMatch !== null) {
      section = (sectionMatch[1] ?? "").split(".", 1)[0]?.toLowerCase() ?? "";
      continue;
    }
    const assignment = /^([A-Za-z][A-Za-z0-9-]*)(?:\s*=\s*(.*))?$/u.exec(line);
    if (assignment === null || section === "") {
      hazards.add(`unparseable_git_config_line:${lineNumber}`);
      if (line.startsWith("[")) {
        section = "";
      }
      continue;
    }
    const key = (assignment[1] ?? "").toLowerCase();
    const value = (assignment[2] ?? "true").trim();
    const qualified = `${section}.${key}`;
    const executable =
      (section === "include" && key === "path") ||
      (section === "includeif" && key === "path") ||
      (section === "core" &&
        [
          "askpass",
          "editor",
          "fsmonitor",
          "gitproxy",
          "hookspath",
          "pager",
          "sshcommand",
        ].includes(key)) ||
      (section === "credential" && key === "helper") ||
      (section === "diff" && ["external", "textconv"].includes(key)) ||
      (section === "filter" && ["clean", "process", "smudge"].includes(key)) ||
      (section === "merge" && key === "driver") ||
      (section === "gpg" && key === "program") ||
      section === "pager" ||
      (section === "interactive" && key === "difffilter") ||
      (section === "sequence" && key === "editor") ||
      (section === "difftool" && key === "cmd") ||
      (section === "mergetool" && key === "cmd") ||
      (section === "remote" && ["receivepack", "uploadpack"].includes(key)) ||
      (section === "submodule" && key === "update") ||
      section === "alias";
    if (executable) {
      hazards.add(qualified);
    } else if (ambiguousValue(value)) {
      hazards.add(`ambiguous_git_config_value:${qualified}:line:${lineNumber}`);
    } else if (!isAllowedStaticGitConfig(section, key, value)) {
      hazards.add(`unclassified_git_config:${qualified}`);
    }
  }
  return [...hazards].sort();
}

function isFileNotFound(error: unknown): boolean {
  return error instanceof MillError && error.code === "FILE_NOT_FOUND";
}

async function optionalSafeRead(
  root: string,
  requestedPath: string,
  maxBytes: number,
): Promise<string | undefined> {
  try {
    return await safeReadText(root, requestedPath, maxBytes);
  } catch (error) {
    if (isFileNotFound(error)) {
      return undefined;
    }
    throw error;
  }
}

async function linkedWorktreeConfig(root: string): Promise<string[]> {
  const pointer = await safeReadText(root, ".git", 16 * 1024);
  const match = /^gitdir:\s*([^\r\n]+)\r?\n?$/u.exec(pointer);
  if (match === null) {
    throw new MillError(
      "INVALID_GIT_WORKTREE_METADATA",
      "Linked-worktree .git metadata is malformed.",
      ExitCode.configuration,
    );
  }
  const canonicalRoot = await realpath(root);
  const gitDirectory = await realpath(
    path.resolve(canonicalRoot, match[1]?.trim() ?? ""),
  );
  const gitDirectoryInfo = await lstat(gitDirectory);
  if (!gitDirectoryInfo.isDirectory()) {
    throw new MillError(
      "INVALID_GIT_WORKTREE_METADATA",
      "Linked-worktree Git directory is not a directory.",
      ExitCode.configuration,
    );
  }
  const commonReference = (
    await safeReadText(gitDirectory, "commondir", 4 * 1024)
  ).trim();
  const commonDirectory = await realpath(
    path.resolve(gitDirectory, commonReference),
  );
  const relativeGitDirectory = path.relative(commonDirectory, gitDirectory);
  const components = relativeGitDirectory.split(path.sep);
  if (
    components.length !== 2 ||
    components[0] !== "worktrees" ||
    components[1] === ""
  ) {
    throw new MillError(
      "INVALID_GIT_WORKTREE_METADATA",
      "Linked-worktree Git directory is outside the common worktree registry.",
      ExitCode.configuration,
    );
  }
  const backReference = (
    await safeReadText(gitDirectory, "gitdir", 16 * 1024)
  ).trim();
  if (
    (await realpath(path.resolve(gitDirectory, backReference))) !==
    (await realpath(path.join(canonicalRoot, ".git")))
  ) {
    throw new MillError(
      "INVALID_GIT_WORKTREE_METADATA",
      "Linked-worktree Git metadata does not point back to this checkout.",
      ExitCode.configuration,
    );
  }
  const commonConfig = await safeReadText(
    commonDirectory,
    "config",
    512 * 1024,
  );
  const worktreeConfig = await optionalSafeRead(
    gitDirectory,
    "config.worktree",
    512 * 1024,
  );
  return worktreeConfig === undefined
    ? [commonConfig]
    : [commonConfig, worktreeConfig];
}

async function readGitConfiguration(
  root: string,
): Promise<GitConfigurationSnapshot | undefined> {
  let marker;
  try {
    marker = await lstat(path.join(root, ".git"));
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return undefined;
    }
    throw error;
  }
  const sources = marker.isDirectory()
    ? [await safeReadText(root, ".git/config", 512 * 1024)]
    : marker.isFile()
      ? await linkedWorktreeConfig(root)
      : (() => {
          throw new MillError(
            "INVALID_GIT_METADATA",
            "The .git marker is neither a directory nor a regular file.",
            ExitCode.configuration,
          );
        })();
  const hazards = [...new Set(sources.flatMap(gitConfigHazards))].sort();
  return { digest: canonicalDigest(sources), hazards };
}

function isAllowedStaticGitConfig(
  section: string,
  key: string,
  value: string,
): boolean {
  if (section === "gc") {
    // actions/checkout disables automatic maintenance in the ephemeral runner
    // checkout. This exact static value neither names nor executes a helper.
    return key === "auto" && value === "0";
  }
  if (section === "core") {
    return [
      "bare",
      "filemode",
      "ignorecase",
      "logallrefupdates",
      "precomposeunicode",
      "repositoryformatversion",
      "worktree",
    ].includes(key);
  }
  if (section === "remote") {
    if (key === "fetch") {
      return true;
    }
    if (key === "url" || key === "pushurl") {
      return !value.toLowerCase().startsWith("ext::");
    }
    return false;
  }
  if (section === "branch") {
    return ["merge", "pushremote", "remote", "vscode-merge-base"].includes(key);
  }
  if (section === "extensions") {
    return [
      "objectformat",
      "partialclone",
      "preciousobjects",
      "refstorage",
      "worktreeconfig",
    ].includes(key);
  }
  if (section === "submodule") {
    return (
      key === "active" ||
      (key === "url" && !value.toLowerCase().startsWith("ext::"))
    );
  }
  return section === "lfs" && key === "repositoryformatversion";
}

async function walk(
  root: string,
  relative: string,
  state: WalkState,
  depth: number,
  limits: ScanLimits,
): Promise<void> {
  const absolute = path.join(root, relative);
  const directory = await opendir(absolute);
  const entries: Dirent[] = [];
  for await (const entry of directory) {
    state.entries += 1;
    if (state.entries > limits.maxEntries) {
      throw new MillError(
        "SCAN_BUDGET_EXCEEDED",
        `Static scan exceeded the ${limits.maxEntries}-entry budget.`,
        ExitCode.data,
      );
    }
    entries.push(entry);
  }
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const child = path.join(relative, entry.name);
    const info = await lstat(path.join(root, child));
    if (info.isSymbolicLink()) {
      state.symlinks.push(child);
      continue;
    }
    if (info.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        if (depth >= limits.maxDepth) {
          state.truncatedDirectories.push(child);
        } else {
          await walk(root, child, state, depth + 1, limits);
        }
      }
      continue;
    }
    if (info.isFile()) {
      state.files.push(child);
    }
  }
}

export async function scanRepository(
  rootInput: string,
  requestedLimits: Partial<ScanLimits> = {},
): Promise<RepositoryScan> {
  const root = path.resolve(rootInput);
  const limits: ScanLimits = {
    maxDepth: Math.max(
      0,
      Math.min(maximumDepth, requestedLimits.maxDepth ?? maximumDepth),
    ),
    maxEntries: Math.max(
      1,
      Math.min(maximumEntries, requestedLimits.maxEntries ?? maximumEntries),
    ),
  };
  const state: WalkState = {
    entries: 0,
    files: [],
    symlinks: [],
    truncatedDirectories: [],
  };
  await walk(root, ".", state, 0, limits);
  const files = state.files.sort();
  const manifests = files.filter((file) =>
    manifestNames.has(path.basename(file)),
  );
  const documentation = files.filter((file) =>
    documentationNames.has(path.basename(file)),
  );
  const workflows = files.filter((file) =>
    file.startsWith(`.github${path.sep}workflows${path.sep}`),
  );
  const secretReferences = files.filter((file) =>
    secretReferenceNames.some((pattern) => pattern.test(path.basename(file))),
  );

  let configurationDigest = "git_config_missing";
  let configurationHazards: string[] = [];
  try {
    const configuration = await readGitConfiguration(root);
    if (configuration !== undefined) {
      configurationDigest = configuration.digest;
      configurationHazards = configuration.hazards;
    }
  } catch {
    configurationDigest = "git_config_unavailable_or_nonstandard";
    configurationHazards.push("git_config_unavailable_or_nonstandard");
  }
  const truncatedDirectories = state.truncatedDirectories.sort();

  const observations: ScanObservation[] = [
    ...(manifests.length > 0
      ? [
          {
            kind: "observed" as const,
            subject: "build_manifests",
            sources: manifests,
            confidence: "high" as const,
          },
        ]
      : [
          {
            kind: "missing" as const,
            subject: "build_manifests",
            sources: [],
            confidence: "high" as const,
          },
        ]),
    ...(documentation.length > 1
      ? [
          {
            kind: "inferred" as const,
            subject: "multiple_instruction_sources_require_precedence_review",
            sources: documentation,
            confidence: "medium" as const,
          },
        ]
      : []),
    ...(configurationHazards.length > 0
      ? [
          {
            kind: "conflicting" as const,
            subject: "executable_or_ambiguous_git_configuration",
            sources: [".git/config"],
            confidence: "high" as const,
          },
        ]
      : []),
    ...(truncatedDirectories.length > 0
      ? [
          {
            kind: "conflicting" as const,
            subject: "static_scan_incomplete_at_depth_limit",
            sources: truncatedDirectories,
            confidence: "high" as const,
          },
        ]
      : []),
  ];

  const digest = canonicalDigest({
    configurationDigest,
    configurationHazards,
    files,
    symlinks: state.symlinks.sort(),
    truncatedDirectories,
  });

  return {
    root: ".",
    digest,
    entriesVisited: state.entries,
    filesVisited: files.length,
    symlinksSkipped: state.symlinks.sort(),
    truncatedDirectories,
    manifests,
    documentation,
    workflows,
    secretReferences,
    gitConfigHazards: configurationHazards,
    observations,
    executableBaseline: "unverified",
  };
}
