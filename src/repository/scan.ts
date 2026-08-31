import { lstat, readdir } from "node:fs/promises";
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
const gitHazards = [
  /hooksPath\s*=/iu,
  /fsmonitor\s*=/iu,
  /textconv\s*=/iu,
  /smudge\s*=/iu,
  /clean\s*=/iu,
  /pager\s*=/iu,
];

export interface ScanObservation {
  kind: "observed" | "inferred" | "missing" | "conflicting";
  subject: string;
  sources: readonly string[];
  confidence: "high" | "medium" | "low";
}

export interface RepositoryScan {
  root: string;
  digest: string;
  filesVisited: number;
  symlinksSkipped: readonly string[];
  manifests: readonly string[];
  documentation: readonly string[];
  workflows: readonly string[];
  secretReferences: readonly string[];
  gitConfigHazards: readonly string[];
  observations: readonly ScanObservation[];
  executableBaseline: "unverified";
}

interface WalkState {
  files: string[];
  symlinks: string[];
}

async function walk(
  root: string,
  relative: string,
  state: WalkState,
  depth: number,
): Promise<void> {
  if (depth > 8) {
    return;
  }
  const absolute = path.join(root, relative);
  const entries = await readdir(absolute, { withFileTypes: true });
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (state.files.length + state.symlinks.length >= 5_000) {
      throw new MillError(
        "SCAN_BUDGET_EXCEEDED",
        "Static scan exceeded the 5,000-entry budget.",
        ExitCode.data,
      );
    }
    const child = path.join(relative, entry.name);
    const info = await lstat(path.join(root, child));
    if (info.isSymbolicLink()) {
      state.symlinks.push(child);
      continue;
    }
    if (info.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        await walk(root, child, state, depth + 1);
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
): Promise<RepositoryScan> {
  const root = path.resolve(rootInput);
  const state: WalkState = { files: [], symlinks: [] };
  await walk(root, ".", state, 0);
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

  const gitConfigHazards: string[] = [];
  try {
    const gitConfig = await safeReadText(root, ".git/config", 512 * 1024);
    for (const pattern of gitHazards) {
      if (pattern.test(gitConfig)) {
        gitConfigHazards.push(pattern.source);
      }
    }
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("ENOENT")) {
      gitConfigHazards.push("git_config_unavailable_or_nonstandard");
    }
  }

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
    ...(gitConfigHazards.length > 0
      ? [
          {
            kind: "conflicting" as const,
            subject: "executable_or_ambiguous_git_configuration",
            sources: [".git/config"],
            confidence: "high" as const,
          },
        ]
      : []),
  ];

  return {
    root: ".",
    digest: canonicalDigest({ files, symlinks: state.symlinks.sort() }),
    filesVisited: files.length,
    symlinksSkipped: state.symlinks.sort(),
    manifests,
    documentation,
    workflows,
    secretReferences,
    gitConfigHazards,
    observations,
    executableBaseline: "unverified",
  };
}
