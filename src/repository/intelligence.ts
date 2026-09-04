import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, opendir, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import ts from "typescript";

import { canonicalDigest, type JsonValue } from "../contracts/canonical.js";
import { ExitCode, MillError } from "../errors.js";
import { isWithin, safeReadText } from "../security/safe-path.js";
import { scanRepository } from "./scan.js";

const execFileAsync = promisify(execFile);

const extractorId = "mill.repository-intelligence";
const extractorVersion = "1";
const sourceExtensions = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);
const ignoredDirectories = new Set([
  ".git",
  ".mill",
  "coverage",
  "dist",
  "node_modules",
  "vendor",
]);
const maximumEntries = 5_000;
const maximumDepth = 16;
const maximumSourceBytes = 1_024 * 1_024;

export interface SourceLocation {
  path: string;
  line: number;
  column: number;
}

export interface ImportObservation {
  kind: "dynamic" | "require" | "static" | "type";
  specifier: string;
  location: SourceLocation;
  resolution: "external" | "resolved_local" | "unresolved";
  targetPath?: string;
}

export interface ModuleObservation {
  path: string;
  digest: string;
  imports: readonly ImportObservation[];
  parseDiagnostics: readonly SourceLocation[];
}

export interface TestInventoryEntry {
  path: string;
  source: "filename";
}

export interface TestSelection {
  script: string;
  command: string;
  selector: string;
  matchedInventory: readonly string[];
  status: "observed" | "unknown";
}

export interface ChangeLead {
  path: string;
  relationship: "changed" | "direct_importer" | "transitive_importer";
  via?: string;
}

export interface ChangeImpact {
  changedPath: string;
  leads: readonly ChangeLead[];
  unknowns: readonly string[];
}

export interface RepositoryIntelligence {
  schemaVersion: "1";
  extractor: {
    id: typeof extractorId;
    version: typeof extractorVersion;
    digest: string;
  };
  source: {
    commit: string;
    tree: string;
    root: ".";
  };
  scanDigest: string;
  sourceFiles: readonly string[];
  modules: readonly ModuleObservation[];
  tests: {
    inventory: readonly TestInventoryEntry[];
    declaredSelection: readonly TestSelection[];
    executedCoverage: "unknown";
  };
  changeImpact: readonly ChangeImpact[];
  unknowns: readonly string[];
  digest: string;
  authority: "derived_read_only";
}

export interface DiscoverRepositoryInput {
  root: string;
  changedPaths?: readonly string[];
}

export interface DiscoveryFreshness {
  fresh: boolean;
  reasons: readonly string[];
}

interface GitIdentity {
  commit: string;
  tree: string;
}

interface WalkState {
  entries: number;
  files: string[];
  truncatedDirectories: string[];
}

function posixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function textDigest(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function sourceFileKind(file: string): ts.ScriptKind {
  switch (path.extname(file).toLowerCase()) {
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".js":
    case ".cjs":
    case ".mjs":
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

function sourceLocation(
  sourceFile: ts.SourceFile,
  position: number,
  file: string,
): SourceLocation {
  const location = sourceFile.getLineAndCharacterOfPosition(position);
  return {
    path: file,
    line: location.line + 1,
    column: location.character + 1,
  };
}

function assertSafeChangedPath(root: string, value: string): string {
  if (value.includes("\0") || path.isAbsolute(value)) {
    throw new MillError(
      "INVALID_CHANGED_PATH",
      "Changed paths must be relative, non-NUL paths inside the discovered repository.",
      ExitCode.data,
      { value },
    );
  }
  const normalized = path.posix.normalize(value.replace(/\\/gu, "/"));
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    throw new MillError(
      "INVALID_CHANGED_PATH",
      "Changed paths must be relative, non-NUL paths inside the discovered repository.",
      ExitCode.data,
      { value },
    );
  }
  const resolved = path.resolve(root, normalized);
  if (!isWithin(root, resolved)) {
    throw new MillError(
      "INVALID_CHANGED_PATH",
      "Changed paths must be inside the discovered repository.",
      ExitCode.data,
      { value },
    );
  }
  return normalized;
}

async function listSourceFiles(
  root: string,
  committed: ReadonlySet<string>,
): Promise<{
  files: readonly string[];
  truncatedDirectories: readonly string[];
}> {
  const state: WalkState = { entries: 0, files: [], truncatedDirectories: [] };
  async function walk(relative: string, depth: number): Promise<void> {
    const absolute = path.join(root, relative);
    let directory;
    try {
      directory = await opendir(absolute);
    } catch (error) {
      throw new MillError(
        "DISCOVERY_DIRECTORY_UNREADABLE",
        "Repository directory could not be read during static discovery.",
        ExitCode.data,
        { path: relative, cause: String(error) },
      );
    }
    const entries = [];
    for await (const entry of directory) {
      state.entries += 1;
      if (state.entries > maximumEntries) {
        throw new MillError(
          "DISCOVERY_BUDGET_EXCEEDED",
          `Static discovery exceeded the ${maximumEntries}-entry budget.`,
          ExitCode.data,
        );
      }
      entries.push(entry);
    }
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const child =
        relative === "." ? entry.name : path.join(relative, entry.name);
      const info = await lstat(path.join(root, child));
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) {
        if (ignoredDirectories.has(entry.name)) continue;
        if (depth >= maximumDepth) {
          state.truncatedDirectories.push(posixPath(child));
        } else {
          await walk(child, depth + 1);
        }
      } else if (
        info.isFile() &&
        sourceExtensions.has(path.extname(entry.name)) &&
        committed.has(posixPath(child))
      ) {
        state.files.push(posixPath(child));
      }
    }
  }
  await walk(".", 0);
  return {
    files: state.files.sort(),
    truncatedDirectories: state.truncatedDirectories.sort(),
  };
}

async function gitReadRaw(
  root: string,
  args: readonly string[],
): Promise<string> {
  try {
    const result = await execFileAsync(
      "git",
      [
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "credential.helper=",
        "-C",
        root,
        ...args,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_OPTIONAL_LOCKS: "0",
          GIT_TERMINAL_PROMPT: "0",
        },
        maxBuffer: 1024 * 1024,
      },
    );
    return result.stdout;
  } catch (error) {
    throw new MillError(
      "GIT_IDENTITY_UNAVAILABLE",
      "Static discovery requires a readable Git repository with an exact committed source identity.",
      ExitCode.data,
      { cause: String(error) },
    );
  }
}

async function gitRead(root: string, args: readonly string[]): Promise<string> {
  return (await gitReadRaw(root, args)).trim();
}

async function committedPaths(root: string): Promise<ReadonlySet<string>> {
  const output = await gitReadRaw(root, [
    "ls-tree",
    "-r",
    "-z",
    "--name-only",
    "HEAD",
  ]);
  const paths = output.length === 0 ? [] : output.split("\0").slice(0, -1);
  for (const candidate of paths) {
    if (
      candidate.length === 0 ||
      path.posix.isAbsolute(candidate) ||
      candidate.split("/").includes("..")
    ) {
      throw new MillError(
        "GIT_IDENTITY_UNAVAILABLE",
        "Static discovery received an unsafe path from the committed Git tree.",
        ExitCode.data,
        { path: candidate },
      );
    }
  }
  return new Set(paths);
}

async function readGitIdentity(root: string): Promise<GitIdentity> {
  const [topLevel, status, commit, tree] = await Promise.all([
    gitRead(root, ["rev-parse", "--show-toplevel"]),
    gitRead(root, ["status", "--porcelain=v1", "--untracked-files=all"]),
    gitRead(root, ["rev-parse", "HEAD"]),
    gitRead(root, ["rev-parse", "HEAD^{tree}"]),
  ]);
  const canonicalTopLevel = await realpath(topLevel);
  if (canonicalTopLevel !== root) {
    throw new MillError(
      "DISCOVERY_ROOT_NOT_GIT_ROOT",
      "Discovery must target the Git repository root, not a nested directory.",
      ExitCode.data,
      { root: topLevel },
    );
  }
  if (status.length > 0) {
    throw new MillError(
      "DISCOVERY_DIRTY_SOURCE",
      "Static discovery refuses a dirty source tree because it cannot bind one exact committed revision.",
      ExitCode.data,
    );
  }
  if (!/^[a-f0-9]{40}$/u.test(commit) || !/^[a-f0-9]{40}$/u.test(tree)) {
    throw new MillError(
      "GIT_IDENTITY_UNAVAILABLE",
      "Static discovery received an invalid Git commit or tree identity.",
      ExitCode.data,
    );
  }
  return { commit, tree };
}

function resolveLocalSpecifier(
  sourcePath: string,
  specifier: string,
  sourceFiles: ReadonlySet<string>,
): string | undefined {
  if (!specifier.startsWith(".") && !specifier.startsWith("/"))
    return undefined;
  if (specifier.startsWith("/")) return undefined;
  const base = path.posix.normalize(
    path.posix.join(path.posix.dirname(sourcePath), specifier),
  );
  if (base === ".." || base.startsWith("../")) return undefined;
  const extension = path.posix.extname(base);
  const candidates =
    extension.length > 0
      ? [
          base,
          ...(extension === ".js"
            ? [".ts", ".tsx", ".mts", ".cts"]
            : extension === ".jsx"
              ? [".tsx", ".ts"]
              : extension === ".mjs"
                ? [".mts"]
                : extension === ".cjs"
                  ? [".cts"]
                  : []
          ).map(
            (candidate) => `${base.slice(0, -extension.length)}${candidate}`,
          ),
        ]
      : [
          ...[".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"].map(
            (candidate) => `${base}${candidate}`,
          ),
          ...[
            "index.ts",
            "index.tsx",
            "index.mts",
            "index.cts",
            "index.js",
            "index.jsx",
            "index.mjs",
            "index.cjs",
          ].map((candidate) => path.posix.join(base, candidate)),
        ];
  return candidates.find((candidate) => sourceFiles.has(candidate));
}

function isTypeOnly(
  node: ts.ImportDeclaration | ts.ExportDeclaration,
): boolean {
  if (ts.isExportDeclaration(node)) {
    return node.isTypeOnly;
  }
  return node.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword;
}

function scriptKindForImport(
  node: ts.Node,
): "dynamic" | "require" | "static" | "type" | undefined {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    return isTypeOnly(node) ? "type" : "static";
  }
  if (ts.isImportEqualsDeclaration(node)) return "static";
  if (
    ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword
  ) {
    return "dynamic";
  }
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "require"
  ) {
    return "require";
  }
  return undefined;
}

function moduleSpecifier(node: ts.Node): ts.StringLiteralLike | undefined {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    return node.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(node.moduleSpecifier)
      ? node.moduleSpecifier
      : undefined;
  }
  if (ts.isImportEqualsDeclaration(node)) {
    return ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteralLike(node.moduleReference.expression)
      ? node.moduleReference.expression
      : undefined;
  }
  if (ts.isCallExpression(node)) {
    const argument = node.arguments[0];
    return argument !== undefined && ts.isStringLiteralLike(argument)
      ? argument
      : undefined;
  }
  return undefined;
}

function inspectModule(
  sourcePath: string,
  source: string,
  sourceFiles: ReadonlySet<string>,
): ModuleObservation {
  const parsed = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    sourceFileKind(sourcePath),
  );
  const imports: ImportObservation[] = [];
  function visit(node: ts.Node): void {
    const kind = scriptKindForImport(node);
    const specifier = kind === undefined ? undefined : moduleSpecifier(node);
    if (kind !== undefined && specifier !== undefined) {
      const targetPath = resolveLocalSpecifier(
        sourcePath,
        specifier.text,
        sourceFiles,
      );
      const relative =
        specifier.text.startsWith(".") || specifier.text.startsWith("/");
      imports.push({
        kind,
        specifier: specifier.text,
        location: sourceLocation(
          parsed,
          specifier.getStart(parsed),
          sourcePath,
        ),
        resolution:
          targetPath === undefined
            ? relative
              ? "unresolved"
              : "external"
            : "resolved_local",
        ...(targetPath === undefined ? {} : { targetPath }),
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  const parseDiagnostics =
    (
      parsed as ts.SourceFile & {
        parseDiagnostics?: readonly ts.DiagnosticWithLocation[];
      }
    ).parseDiagnostics?.map((diagnostic) =>
      sourceLocation(parsed, diagnostic.start, sourcePath),
    ) ?? [];
  return {
    path: sourcePath,
    digest: textDigest(source),
    imports: imports.sort((left, right) =>
      `${left.location.line}:${left.location.column}:${left.specifier}`.localeCompare(
        `${right.location.line}:${right.location.column}:${right.specifier}`,
      ),
    ),
    parseDiagnostics,
  };
}

function isTestPath(file: string): boolean {
  const basename = path.posix.basename(file);
  return (
    /(?:^|\.)(?:test|spec)\.[cm]?[jt]sx?$/u.test(basename) ||
    file.split("/").includes("test") ||
    file.split("/").includes("tests")
  );
}

function matchesOneSegmentGlob(candidate: string, selector: string): boolean {
  const escaped = selector
    .replace(/[.+^${}()|[\]\\]/gu, "\\$&")
    .replace(/\*/gu, "[^/]*");
  return new RegExp(`^${escaped}$`, "u").test(candidate);
}

function declaredTestSelections(
  packageSource: string | undefined,
  inventory: readonly TestInventoryEntry[],
): TestSelection[] {
  if (packageSource === undefined) return [];
  let packageJson: unknown;
  try {
    packageJson = JSON.parse(packageSource);
  } catch {
    return [];
  }
  if (
    typeof packageJson !== "object" ||
    packageJson === null ||
    !("scripts" in packageJson) ||
    typeof packageJson.scripts !== "object" ||
    packageJson.scripts === null
  ) {
    return [];
  }
  const selections: TestSelection[] = [];
  for (const [script, command] of Object.entries(packageJson.scripts)) {
    if (
      typeof command !== "string" ||
      !/(?:^|\s)(?:vitest|jest|mocha|ava|tsx|node|pnpm|npm)(?:\s|$)/u.test(
        command,
      )
    ) {
      continue;
    }
    const selectors =
      command.match(/[A-Za-z0-9_./*-]+\.(?:test|spec)\.[cm]?[jt]sx?/gu) ?? [];
    if (selectors.length === 0) {
      selections.push({
        script,
        command,
        selector: "static_selection_unknown",
        matchedInventory: [],
        status: "unknown",
      });
      continue;
    }
    for (const selector of [...new Set(selectors)].sort()) {
      if (selector.includes("**")) {
        selections.push({
          script,
          command,
          selector,
          matchedInventory: [],
          status: "unknown",
        });
        continue;
      }
      selections.push({
        script,
        command,
        selector,
        matchedInventory: inventory
          .map((entry) => entry.path)
          .filter((file) => matchesOneSegmentGlob(file, selector)),
        status: "observed",
      });
    }
  }
  return selections.sort((left, right) =>
    `${left.script}:${left.selector}`.localeCompare(
      `${right.script}:${right.selector}`,
    ),
  );
}

function deriveChangeImpact(
  changedPath: string,
  modules: readonly ModuleObservation[],
): ChangeImpact {
  const byPath = new Map(modules.map((module) => [module.path, module]));
  if (!byPath.has(changedPath)) {
    return {
      changedPath,
      leads: [],
      unknowns: ["changed_path_not_observed_no_unaffectedness_claim"],
    };
  }
  const importers = new Map<string, string[]>();
  for (const module of modules) {
    for (const relation of module.imports) {
      if (relation.targetPath === undefined) continue;
      const current = importers.get(relation.targetPath) ?? [];
      current.push(module.path);
      importers.set(relation.targetPath, current);
    }
  }
  const leads: ChangeLead[] = [{ path: changedPath, relationship: "changed" }];
  const visited = new Set([changedPath]);
  let frontier = [changedPath];
  let depth = 0;
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const target of frontier.sort()) {
      for (const importer of [...(importers.get(target) ?? [])].sort()) {
        if (visited.has(importer)) continue;
        visited.add(importer);
        leads.push({
          path: importer,
          relationship: depth === 0 ? "direct_importer" : "transitive_importer",
          via: target,
        });
        next.push(importer);
      }
    }
    frontier = next;
    depth += 1;
  }
  return { changedPath, leads, unknowns: [] };
}

export function assessDiscoveryFreshness(
  report: RepositoryIntelligence,
  current: Pick<RepositoryIntelligence, "extractor" | "source">,
): DiscoveryFreshness {
  const reasons: string[] = [];
  if (report.extractor.digest !== current.extractor.digest) {
    reasons.push("extractor_identity_changed");
  }
  if (report.source.commit !== current.source.commit)
    reasons.push("source_commit_changed");
  if (report.source.tree !== current.source.tree)
    reasons.push("source_tree_changed");
  return { fresh: reasons.length === 0, reasons };
}

export async function discoverRepository(
  input: DiscoverRepositoryInput,
): Promise<RepositoryIntelligence> {
  const root = await realpath(path.resolve(input.root));
  const scan = await scanRepository(root);
  if (scan.gitConfigHazards.length > 0) {
    throw new MillError(
      "UNSAFE_GIT_CONFIGURATION",
      "Discovery refuses repositories with executable or ambiguous Git configuration.",
      ExitCode.data,
      { hazards: scan.gitConfigHazards },
    );
  }
  if (scan.symlinksSkipped.length > 0 || scan.truncatedDirectories.length > 0) {
    throw new MillError(
      "DISCOVERY_INCOMPLETE_SOURCE",
      "Discovery refuses source trees with skipped symbolic links or truncated directories.",
      ExitCode.data,
      {
        symlinks: scan.symlinksSkipped,
        truncatedDirectories: scan.truncatedDirectories,
      },
    );
  }
  if (scan.secretReferences.length > 0) {
    throw new MillError(
      "DISCOVERY_SENSITIVE_PATH",
      "Discovery refuses repositories that contain credential-like source paths.",
      ExitCode.data,
      { paths: scan.secretReferences },
    );
  }
  const identity = await readGitIdentity(root);
  const listed = await listSourceFiles(root, await committedPaths(root));
  if (listed.truncatedDirectories.length > 0) {
    throw new MillError(
      "DISCOVERY_INCOMPLETE_SOURCE",
      "Discovery reached its source-depth limit and cannot claim complete static evidence.",
      ExitCode.data,
      { truncatedDirectories: listed.truncatedDirectories },
    );
  }
  const sourceFiles = listed.files;
  const sourceSet = new Set(sourceFiles);
  const modules = await Promise.all(
    sourceFiles.map(async (file) =>
      inspectModule(
        file,
        await safeReadText(root, file, maximumSourceBytes),
        sourceSet,
      ),
    ),
  );
  const inventory = sourceFiles
    .filter(isTestPath)
    .map((file) => ({ path: file, source: "filename" as const }));
  let packageSource: string | undefined;
  try {
    packageSource = await safeReadText(
      root,
      "package.json",
      maximumSourceBytes,
    );
  } catch (error) {
    if (!(error instanceof MillError) || error.code !== "FILE_NOT_FOUND")
      throw error;
  }
  const changedPaths = [
    ...new Set(
      (input.changedPaths ?? []).map((value) =>
        assertSafeChangedPath(root, value),
      ),
    ),
  ].sort();
  const extractor = {
    id: extractorId,
    version: extractorVersion,
    digest: canonicalDigest({ id: extractorId, version: extractorVersion }),
  } as const;
  const data = {
    schemaVersion: "1" as const,
    extractor,
    source: { ...identity, root: "." as const },
    scanDigest: scan.digest,
    sourceFiles,
    modules: modules.sort((left, right) => left.path.localeCompare(right.path)),
    tests: {
      inventory,
      declaredSelection: declaredTestSelections(packageSource, inventory),
      executedCoverage: "unknown" as const,
    },
    changeImpact: changedPaths.map((changedPath) =>
      deriveChangeImpact(changedPath, modules),
    ),
    unknowns: [
      "runtime_behavior_not_executed",
      "executed_test_coverage_not_observed",
      "external_module_semantics_not_resolved",
      "derived_map_does_not_authorize_effects",
    ],
    authority: "derived_read_only" as const,
  };
  return { ...data, digest: canonicalDigest(data as unknown as JsonValue) };
}
