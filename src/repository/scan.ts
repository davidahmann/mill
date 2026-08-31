import type { Dirent } from "node:fs";
import { lstat, opendir } from "node:fs/promises";
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
const secretReferenceNames = [/^\.env(?:\.|$)/u, /secret/iu, /credential/iu];
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

function gitConfigHazards(source: string): string[] {
  const hazards = new Set<string>();
  let section = "";
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#") || line.startsWith(";")) {
      continue;
    }
    const sectionMatch = /^\[\s*([^\s\]"]+)(?:\s+"[^"]*")?\s*\]$/u.exec(line);
    if (sectionMatch !== null) {
      section = (sectionMatch[1] ?? "").toLowerCase();
      continue;
    }
    const assignment = /^([^=\s]+)\s*=\s*(.*)$/u.exec(line);
    if (assignment === null || section === "") {
      continue;
    }
    const key = (assignment[1] ?? "").toLowerCase();
    const value = (assignment[2] ?? "").trim();
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
      (section === "alias" && value.startsWith("!"));
    if (executable) {
      hazards.add(qualified);
    } else if (!isAllowedStaticGitConfig(section, key, value)) {
      hazards.add(`unclassified_git_config:${qualified}`);
    }
  }
  return [...hazards].sort();
}

function isAllowedStaticGitConfig(
  section: string,
  key: string,
  value: string,
): boolean {
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
    const gitConfig = await safeReadText(root, ".git/config", 512 * 1024);
    configurationDigest = canonicalDigest(gitConfig);
    configurationHazards = gitConfigHazards(gitConfig);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("ENOENT")) {
      configurationDigest = "git_config_unavailable_or_nonstandard";
      configurationHazards.push("git_config_unavailable_or_nonstandard");
    }
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
