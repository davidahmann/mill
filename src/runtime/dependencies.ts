import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  opendir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import { findTrustedExecutable } from "../doctor.js";
import { ExitCode, MillError } from "../errors.js";
import { isWithin } from "../security/safe-path.js";
import type { MillConfig } from "./inputs.js";
import {
  processCancellationScope,
  runProcess,
  type ProcessResult,
} from "./process.js";
import { acquireExclusiveLease } from "./lease.js";

interface DependencyIdentity {
  schemaVersion: "1";
  image: string;
  manager: "npm" | "pnpm";
  version?: string;
  registry: "https://registry.npmjs.org";
  targetPath: string;
  workspacePaths?: string[];
  locks: { path: string; digest: string }[];
}

interface DependencyMarker extends DependencyIdentity {
  treeDigest: string;
  workspaceTreeDigests?: Record<string, string>;
}

export interface DependencyPreparationResult {
  directory: string;
  reused: boolean;
  network: string;
}

function digest(value: Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function validSha512Integrity(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const match = /^sha512-([A-Za-z0-9+/]+={0,2})$/u.exec(value);
  const encoded = match?.[1];
  if (encoded === undefined) return false;
  const decoded = Buffer.from(encoded, "base64");
  return (
    decoded.byteLength === 64 &&
    decoded.toString("base64").replace(/=+$/u, "") ===
      encoded.replace(/=+$/u, "")
  );
}

type DependencyConfig = NonNullable<
  NonNullable<MillConfig["verifier"]>["dependencies"]
>;

function requiredDependencyLocks(dependencies: DependencyConfig): string[] {
  return dependencies.manager === "pnpm"
    ? ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"]
    : ["package.json", "package-lock.json"];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function lifecycleScriptsAllowed(manifest: unknown, file: string): void {
  const scripts = record(record(manifest)?.scripts);
  const lifecycle = [
    "preinstall",
    "install",
    "postinstall",
    "prepare",
    "prepublishOnly",
  ];
  const configured = lifecycle.filter((name) => scripts?.[name] !== undefined);
  if (configured.length > 0) {
    throw new MillError(
      "PNPM_LIFECYCLE_SCRIPT_UNSUPPORTED",
      "The generic pnpm path rejects lifecycle scripts; provide a separately qualified preparation path for native builds.",
      ExitCode.configuration,
      { file, scripts: configured },
    );
  }
}

async function parseJsonManifest(
  root: string,
  relative: string,
): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path.join(root, relative), "utf8"));
  } catch (error) {
    throw new MillError(
      "PNPM_MANIFEST_INVALID",
      "A pnpm workspace manifest is missing or not valid JSON.",
      ExitCode.configuration,
      { path: relative, cause: String(error) },
    );
  }
}

async function pnpmWorkspaceManifestPaths(
  root: string,
  dependencies: Extract<DependencyConfig, { manager: "pnpm" }>,
): Promise<string[]> {
  let workspace: unknown;
  try {
    workspace = parseYaml(
      await readFile(path.join(root, "pnpm-workspace.yaml"), "utf8"),
    );
  } catch (error) {
    throw new MillError(
      "PNPM_WORKSPACE_INVALID",
      "pnpm-workspace.yaml is missing or not valid YAML.",
      ExitCode.configuration,
      { cause: String(error) },
    );
  }
  const paths = record(workspace)?.packages;
  if (
    !Array.isArray(paths) ||
    paths.length !== dependencies.workspacePaths.length ||
    paths.some(
      (workspacePath) =>
        typeof workspacePath !== "string" ||
        !dependencies.workspacePaths.includes(workspacePath),
    )
  ) {
    throw new MillError(
      "PNPM_WORKSPACE_INVALID",
      "pnpm-workspace.yaml must contain exactly the declared shallow workspace paths.",
      ExitCode.configuration,
    );
  }
  const onlyBuiltDependencies = record(workspace)?.onlyBuiltDependencies;
  if (
    onlyBuiltDependencies !== undefined &&
    (!Array.isArray(onlyBuiltDependencies) || onlyBuiltDependencies.length > 0)
  ) {
    throw new MillError(
      "PNPM_LIFECYCLE_SCRIPT_UNSUPPORTED",
      "The generic pnpm path does not allow pnpm onlyBuiltDependencies entries.",
      ExitCode.configuration,
    );
  }
  const result: string[] = [];
  for (const workspacePath of dependencies.workspacePaths) {
    const directory = workspacePath.slice(0, -2);
    let directoryInfo;
    try {
      directoryInfo = await lstat(path.join(root, directory));
    } catch (error) {
      throw new MillError(
        "PNPM_WORKSPACE_INVALID",
        "A declared pnpm workspace directory is missing or inaccessible.",
        ExitCode.configuration,
        { path: directory, cause: String(error) },
      );
    }
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
      throw new MillError(
        "PNPM_WORKSPACE_INVALID",
        "A declared pnpm workspace directory must be a regular in-repository directory.",
        ExitCode.configuration,
        { path: directory },
      );
    }
    let handle;
    try {
      handle = await opendir(path.join(root, directory));
    } catch (error) {
      throw new MillError(
        "PNPM_WORKSPACE_INVALID",
        "A declared pnpm workspace directory is missing or inaccessible.",
        ExitCode.configuration,
        { path: directory, cause: String(error) },
      );
    }
    const entries = [];
    for await (const entry of handle) entries.push(entry);
    entries.sort((left, right) =>
      Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)),
    );
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        throw new MillError(
          "PNPM_WORKSPACE_INVALID",
          "A generic pnpm workspace may contain only direct, regular package directories.",
          ExitCode.configuration,
          { path: path.join(directory, entry.name) },
        );
      }
      result.push(path.join(directory, entry.name, "package.json"));
    }
  }
  for (const relative of ["package.json", ...result]) {
    const manifest = await parseJsonManifest(root, relative);
    if (
      relative === "package.json" &&
      record(manifest)?.packageManager !== `pnpm@${dependencies.version}`
    ) {
      throw new MillError(
        "PNPM_VERSION_UNSUPPORTED",
        "The root package.json must pin the declared pnpm version exactly.",
        ExitCode.configuration,
      );
    }
    lifecycleScriptsAllowed(manifest, relative);
  }
  return result;
}

function validRegistrySource(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const source = new URL(value);
    return (
      source.protocol === "https:" &&
      source.origin === "https://registry.npmjs.org" &&
      source.username === "" &&
      source.password === "" &&
      source.search === "" &&
      source.hash === ""
    );
  } catch {
    return false;
  }
}

async function validatePnpmLock(
  root: string,
  dependencies: Extract<DependencyConfig, { manager: "pnpm" }>,
  workspaceManifests: readonly string[],
): Promise<boolean> {
  for (const file of [".npmrc", ".pnpmfile.cjs", "pnpmfile.cjs"]) {
    if (
      await lstat(path.join(root, file)).then(
        () => true,
        (error: unknown) => {
          if (
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          )
            return false;
          throw error;
        },
      )
    ) {
      throw new MillError(
        "PNPM_CONFIGURATION_UNSUPPORTED",
        "The generic pnpm path rejects registry and install-hook configuration files.",
        ExitCode.configuration,
        { path: file },
      );
    }
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(
      await readFile(path.join(root, "pnpm-lock.yaml"), "utf8"),
    );
  } catch (error) {
    throw new MillError(
      "PNPM_LOCK_INVALID",
      "The bound pnpm-lock.yaml is not valid YAML.",
      ExitCode.configuration,
      { cause: String(error) },
    );
  }
  const lock = record(parsed);
  const importers = record(lock?.importers);
  const packages = record(lock?.packages);
  if (
    lock?.lockfileVersion !== "9.0" ||
    importers === undefined ||
    packages === undefined
  ) {
    throw new MillError(
      "PNPM_LOCK_INVALID",
      "The generic pnpm path requires a lockfile-version 9 importer and packages map.",
      ExitCode.configuration,
    );
  }
  const expectedImporters = [
    ".",
    ...workspaceManifests.map((relative) => path.dirname(relative)),
  ].sort();
  const actualImporters = Object.keys(importers).sort();
  if (
    actualImporters.length !== expectedImporters.length ||
    actualImporters.some((entry, index) => entry !== expectedImporters[index])
  ) {
    throw new MillError(
      "PNPM_LOCK_INVALID",
      "pnpm-lock.yaml importers must match the root and declared direct workspace packages.",
      ExitCode.configuration,
    );
  }
  for (const [packagePath, packageValue] of Object.entries(packages)) {
    const resolution = record(record(packageValue)?.resolution);
    if (
      resolution === undefined ||
      !validSha512Integrity(resolution.integrity)
    ) {
      throw new MillError(
        "PNPM_LOCK_SOURCE_UNTRUSTED",
        "Every generic pnpm package must have a SHA-512 integrity value.",
        ExitCode.configuration,
        { packagePath },
      );
    }
    if (
      resolution.tarball !== undefined &&
      !validRegistrySource(resolution.tarball)
    ) {
      throw new MillError(
        "PNPM_LOCK_SOURCE_UNTRUSTED",
        "Generic pnpm package tarballs must use the credential-free npm registry URL.",
        ExitCode.configuration,
        { packagePath },
      );
    }
  }
  return Object.keys(packages).length === 0;
}

async function dependencyInputPaths(
  root: string,
  config: MillConfig,
): Promise<string[]> {
  const dependencies = config.verifier?.dependencies;
  if (dependencies === undefined) {
    throw new MillError(
      "VERIFIER_DEPENDENCIES_NOT_CONFIGURED",
      "This repository does not declare a verifier dependency snapshot.",
      ExitCode.configuration,
    );
  }
  const missing = requiredDependencyLocks(dependencies).filter(
    (lockPath) => !dependencies.lockPaths.includes(lockPath),
  );
  if (missing.length > 0) {
    throw new MillError(
      dependencies.manager === "pnpm"
        ? "PNPM_LOCK_REQUIRED"
        : "NPM_LOCK_REQUIRED",
      "The package manager's root manifest and lock inputs must be bound before dependency preparation.",
      ExitCode.configuration,
      { missing },
    );
  }
  if (dependencies.manager === "npm") return dependencies.lockPaths;
  const workspaceManifests = await pnpmWorkspaceManifestPaths(
    root,
    dependencies,
  );
  await validatePnpmLock(root, dependencies, workspaceManifests);
  return [
    ...new Set([...dependencies.lockPaths, ...workspaceManifests]),
  ].sort();
}

async function dependencyIdentity(
  root: string,
  config: MillConfig,
): Promise<{
  key: string;
  marker: DependencyIdentity;
}> {
  const dependencies = config.verifier?.dependencies;
  if (dependencies === undefined || config.verifier === undefined) {
    throw new MillError(
      "VERIFIER_DEPENDENCIES_NOT_CONFIGURED",
      "This repository does not declare a verifier dependency snapshot.",
      ExitCode.configuration,
    );
  }
  const canonicalRoot = await realpath(root);
  const inputPaths = await dependencyInputPaths(canonicalRoot, config);
  const locks = await Promise.all(
    inputPaths.map(async (relative) => {
      let absolute: string;
      try {
        absolute = await realpath(path.resolve(canonicalRoot, relative));
      } catch (error) {
        throw new MillError(
          "VERIFIER_DEPENDENCY_LOCK_INVALID",
          "A dependency lock input is missing or inaccessible.",
          ExitCode.configuration,
          { path: relative, cause: String(error) },
        );
      }
      if (
        !isWithin(canonicalRoot, absolute) ||
        !(await stat(absolute)).isFile()
      ) {
        throw new MillError(
          "VERIFIER_DEPENDENCY_LOCK_INVALID",
          "A dependency lock input is not a regular in-repository file.",
          ExitCode.configuration,
          { path: relative },
        );
      }
      return { path: relative, digest: digest(await readFile(absolute)) };
    }),
  );
  const marker: DependencyIdentity = {
    schemaVersion: "1",
    image: config.verifier.image,
    manager: dependencies.manager,
    ...(dependencies.manager === "pnpm"
      ? { version: dependencies.version }
      : {}),
    registry: dependencies.registry,
    targetPath: dependencies.targetPath,
    ...(dependencies.manager === "pnpm"
      ? { workspacePaths: [...dependencies.workspacePaths].sort() }
      : {}),
    locks,
  };
  const key = createHash("sha256")
    .update(JSON.stringify(marker), "utf8")
    .digest("hex");
  return { key, marker };
}

const maximumDependencyEntries = 250_000;

function sameFileIdentity(
  left: Awaited<ReturnType<typeof lstat>>,
  right: Awaited<ReturnType<typeof lstat>>,
): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

async function regularFileDigest(file: string): Promise<string> {
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new MillError(
      "DEPENDENCY_TREE_INVALID",
      "The dependency tree contains an unsafe file type.",
      ExitCode.data,
    );
  }
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (!sameFileIdentity(before, opened)) {
      throw new MillError(
        "DEPENDENCY_TREE_CHANGED",
        "The dependency tree changed while it was inspected.",
        ExitCode.temporary,
      );
    }
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    for (;;) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        buffer.byteLength,
        position,
      );
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = await handle.stat();
    if (!sameFileIdentity(opened, after)) {
      throw new MillError(
        "DEPENDENCY_TREE_CHANGED",
        "The dependency tree changed while it was inspected.",
        ExitCode.temporary,
      );
    }
    return `sha256:${hash.digest("hex")}`;
  } finally {
    await handle.close();
  }
}

async function dependencyTreeDigest(
  directory: string,
  containmentRoot = directory,
): Promise<string> {
  const canonicalRoot = await realpath(directory);
  const canonicalContainmentRoot = await realpath(containmentRoot);
  const aggregate = createHash("sha256");
  let entriesVisited = 0;
  const record = (value: readonly (string | number)[]): void => {
    aggregate.update(JSON.stringify(value), "utf8");
    aggregate.update("\n", "utf8");
  };
  const walk = async (relative: string): Promise<void> => {
    const absolute = path.join(canonicalRoot, relative);
    const before = await lstat(absolute);
    if (!before.isDirectory() || before.isSymbolicLink()) {
      throw new MillError(
        "DEPENDENCY_TREE_INVALID",
        "The dependency tree contains an unsafe directory type.",
        ExitCode.data,
        { path: relative },
      );
    }
    record(["directory", relative, before.mode & 0o111]);
    const handle = await opendir(absolute);
    const entries = [];
    for await (const entry of handle) entries.push(entry);
    entries.sort((left, right) =>
      Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)),
    );
    for (const entry of entries) {
      entriesVisited += 1;
      if (entriesVisited > maximumDependencyEntries) {
        throw new MillError(
          "DEPENDENCY_TREE_TOO_LARGE",
          "The dependency tree exceeds its bounded entry budget.",
          ExitCode.data,
          { maximumEntries: maximumDependencyEntries },
        );
      }
      const child =
        relative === "" ? entry.name : path.join(relative, entry.name);
      const childAbsolute = path.join(canonicalRoot, child);
      const information = await lstat(childAbsolute);
      if (information.isDirectory() && !information.isSymbolicLink()) {
        await walk(child);
      } else if (information.isFile() && !information.isSymbolicLink()) {
        record([
          "file",
          child,
          information.mode & 0o111,
          information.size,
          await regularFileDigest(childAbsolute),
        ]);
      } else if (information.isSymbolicLink()) {
        const target = await readlink(childAbsolute);
        const resolvedTarget = path.resolve(
          path.dirname(childAbsolute),
          target,
        );
        if (
          path.isAbsolute(target) ||
          !isWithin(canonicalContainmentRoot, resolvedTarget) ||
          !isWithin(canonicalContainmentRoot, await realpath(childAbsolute))
        ) {
          throw new MillError(
            "DEPENDENCY_TREE_INVALID",
            "The dependency tree contains a symbolic link outside its root.",
            ExitCode.data,
            { path: child },
          );
        }
        record(["symlink", child, target]);
      } else {
        throw new MillError(
          "DEPENDENCY_TREE_INVALID",
          "The dependency tree contains an unsupported filesystem entry.",
          ExitCode.data,
          { path: child },
        );
      }
    }
    const after = await lstat(absolute);
    if (!sameFileIdentity(before, after)) {
      throw new MillError(
        "DEPENDENCY_TREE_CHANGED",
        "The dependency tree changed while it was inspected.",
        ExitCode.temporary,
        { path: relative },
      );
    }
  };
  await walk("");
  return `sha256:${aggregate.digest("hex")}`;
}

async function optionalDependencyTreeDigest(
  directory: string,
  containmentRoot = directory,
): Promise<string> {
  try {
    await lstat(directory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return "absent";
    }
    throw error;
  }
  return await dependencyTreeDigest(directory, containmentRoot);
}

async function pnpmWorkspaceTreeDigests(
  directory: string,
  dependencies: Extract<DependencyConfig, { manager: "pnpm" }>,
): Promise<Record<string, string>> {
  const digests: Record<string, string> = {};
  for (const manifest of await pnpmWorkspaceManifestPaths(
    directory,
    dependencies,
  )) {
    const workspacePath = path.dirname(manifest);
    digests[workspacePath] = await optionalDependencyTreeDigest(
      path.join(directory, workspacePath, "node_modules"),
      directory,
    );
  }
  return digests;
}

async function markerMatches(
  directory: string,
  expected: DependencyIdentity,
): Promise<boolean> {
  try {
    const [source, modules] = await Promise.all([
      readFile(path.join(directory, "marker.json"), "utf8"),
      lstat(path.join(directory, "node_modules")),
    ]);
    if (!modules.isDirectory() || modules.isSymbolicLink()) return false;
    const parsed = JSON.parse(source) as Partial<DependencyMarker>;
    if (
      parsed.schemaVersion !== "1" ||
      typeof parsed.image !== "string" ||
      (parsed.manager !== "npm" && parsed.manager !== "pnpm") ||
      parsed.registry !== "https://registry.npmjs.org" ||
      typeof parsed.targetPath !== "string" ||
      !Array.isArray(parsed.locks) ||
      !/^sha256:[0-9a-f]{64}$/u.test(parsed.treeDigest ?? "")
    ) {
      return false;
    }
    const claimedIdentity: DependencyIdentity =
      parsed.manager === "pnpm"
        ? typeof parsed.version === "string" &&
          Array.isArray(parsed.workspacePaths)
          ? {
              schemaVersion: parsed.schemaVersion,
              image: parsed.image,
              manager: parsed.manager,
              version: parsed.version,
              registry: parsed.registry,
              targetPath: parsed.targetPath,
              workspacePaths: parsed.workspacePaths,
              locks: parsed.locks,
            }
          : (() => {
              throw new Error("invalid pnpm dependency marker");
            })()
        : {
            schemaVersion: parsed.schemaVersion,
            image: parsed.image,
            manager: parsed.manager,
            registry: parsed.registry,
            targetPath: parsed.targetPath,
            locks: parsed.locks,
          };
    if (
      JSON.stringify(claimedIdentity) !== JSON.stringify(expected) ||
      parsed.treeDigest !==
        (await dependencyTreeDigest(
          path.join(directory, "node_modules"),
          directory,
        ))
    )
      return false;
    if (expected.manager !== "pnpm") return true;
    const workspaceTreeDigests = record(parsed.workspaceTreeDigests);
    if (workspaceTreeDigests === undefined) return false;
    const workspaceManifests = await pnpmWorkspaceManifestPaths(
      directory,
      expected as unknown as Extract<DependencyConfig, { manager: "pnpm" }>,
    );
    for (const workspacePath of workspaceManifests.map((manifest) =>
      path.dirname(manifest),
    )) {
      const expectedDigest = workspaceTreeDigests[workspacePath];
      if (
        typeof expectedDigest !== "string" ||
        expectedDigest !==
          (await optionalDependencyTreeDigest(
            path.join(directory, workspacePath, "node_modules"),
            directory,
          ))
      )
        return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function validateNpmLock(
  root: string,
  lockPaths: readonly string[],
): Promise<boolean> {
  const lockPath = "package-lock.json";
  if (!lockPaths.includes(lockPath)) {
    throw new MillError(
      "NPM_LOCK_REQUIRED",
      "npm dependency preparation requires the root package-lock.json consumed by npm ci as a bound lock input.",
      ExitCode.configuration,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path.join(root, lockPath), "utf8"));
  } catch (error) {
    throw new MillError(
      "NPM_LOCK_INVALID",
      "The bound package-lock.json is not valid JSON.",
      ExitCode.configuration,
      { path: lockPath, cause: String(error) },
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new MillError(
      "NPM_LOCK_INVALID",
      "The bound package-lock.json must be an object.",
      ExitCode.configuration,
      { path: lockPath },
    );
  }
  const packages = (parsed as { packages?: unknown }).packages;
  if (
    typeof packages !== "object" ||
    packages === null ||
    Array.isArray(packages)
  ) {
    throw new MillError(
      "NPM_LOCK_INVALID",
      "The bound package-lock.json must contain a packages object.",
      ExitCode.configuration,
      { path: lockPath },
    );
  }
  for (const [packagePath, value] of Object.entries(packages)) {
    if (packagePath === "") continue;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new MillError(
        "NPM_LOCK_SOURCE_UNTRUSTED",
        "Every installable npm lock entry must be a structured integrity-bound source.",
        ExitCode.configuration,
        { packagePath },
      );
    }
    const entry = value as {
      resolved?: unknown;
      integrity?: unknown;
      link?: unknown;
    };
    if (
      entry.link === true ||
      typeof entry.resolved !== "string" ||
      !validSha512Integrity(entry.integrity)
    ) {
      throw new MillError(
        "NPM_LOCK_SOURCE_UNTRUSTED",
        "Every installable npm package must include one SHA-512-bound HTTPS registry source; links and workspaces are unsupported.",
        ExitCode.configuration,
        { packagePath },
      );
    }
    let resolved: URL;
    try {
      resolved = new URL(entry.resolved);
    } catch {
      throw new MillError(
        "NPM_LOCK_SOURCE_UNTRUSTED",
        "An npm lock entry has an invalid resolved source URL.",
        ExitCode.configuration,
        { packagePath },
      );
    }
    if (
      resolved.protocol !== "https:" ||
      resolved.origin !== "https://registry.npmjs.org" ||
      resolved.username !== "" ||
      resolved.password !== "" ||
      resolved.search !== "" ||
      resolved.hash !== ""
    ) {
      throw new MillError(
        "NPM_LOCK_SOURCE_UNTRUSTED",
        "npm dependency preparation permits only credential-free, query-free, integrity-bound registry.npmjs.org sources.",
        ExitCode.configuration,
        { packagePath, origin: resolved.origin },
      );
    }
  }
  // npm ci need not create node_modules for a proven empty dependency graph.
  // A missing root entry is insufficient evidence (and keeps legacy denial).
  const rootEntry = (packages as Record<string, unknown>)[""];
  let manifest: unknown;
  try {
    manifest = JSON.parse(
      await readFile(path.join(root, "package.json"), "utf8"),
    );
  } catch (error) {
    throw new MillError(
      "NPM_LOCK_INVALID",
      "Dependency preparation requires a valid root package.json.",
      ExitCode.configuration,
      { cause: String(error) },
    );
  }
  const empty = (value: unknown): boolean => {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return false;
    const item = value as Record<string, unknown>;
    return (
      item.workspaces === undefined &&
      [
        "dependencies",
        "devDependencies",
        "optionalDependencies",
        "peerDependencies",
      ].every((field) => {
        const dependency = item[field];
        return (
          dependency === undefined ||
          (typeof dependency === "object" &&
            dependency !== null &&
            !Array.isArray(dependency) &&
            Object.keys(dependency).length === 0)
        );
      })
    );
  };
  return (
    Object.keys(packages).length === 1 && empty(rootEntry) && empty(manifest)
  );
}

export async function dependencySnapshotDirectory(input: {
  root: string;
  stateDirectory: string;
  config: MillConfig;
}): Promise<string | undefined> {
  if (input.config.verifier?.dependencies === undefined) return undefined;
  const identity = await dependencyIdentity(input.root, input.config);
  const directory = path.join(
    input.stateDirectory,
    "dependencies",
    identity.key,
  );
  if (!(await markerMatches(directory, identity.marker))) {
    throw new MillError(
      "VERIFIER_DEPENDENCIES_UNAVAILABLE",
      "The exact dependency snapshot is absent. Run millctl dependencies prepare --attended.",
      ExitCode.unavailable,
      { snapshot: identity.key },
    );
  }
  return directory;
}

export async function dependencyLockPaths(input: {
  root: string;
  config: MillConfig;
}): Promise<string[]> {
  return (await dependencyIdentity(input.root, input.config)).marker.locks.map(
    (lock) => lock.path,
  );
}

async function mountSource(root: string): Promise<{
  source: string;
  dispose(): Promise<void>;
}> {
  if (!root.includes(",")) {
    return { source: root, dispose: () => Promise.resolve() };
  }
  const parent = await mkdtemp(path.join(tmpdir(), "mill-deps-bind-"));
  await chmod(parent, 0o700);
  const source = path.join(parent, "workspace");
  await symlink(root, source, "dir");
  if ((await realpath(source)) !== root) {
    await rm(parent, { recursive: true, force: true });
    throw new MillError(
      "DEPENDENCY_MOUNT_ALIAS_INVALID",
      "The dependency preparation bind alias is not exact.",
      ExitCode.configuration,
    );
  }
  return {
    source,
    dispose: () => rm(parent, { recursive: true, force: true }),
  };
}

async function removeContainer(
  docker: string,
  root: string,
  containerName: string,
): Promise<void> {
  const result = await runProcess({
    executable: docker,
    args: ["rm", "--force", "--volumes", containerName],
    cwd: root,
    env: { HOME: process.env.HOME, PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
    deadlineMs: Date.now() + 15_000,
    maxOutputBytes: 128 * 1024,
  });
  if (
    result.timedOut ||
    result.outputExceeded ||
    result.cancelled ||
    (result.exitCode !== 0 && !/no such container/iu.test(result.stderr))
  ) {
    throw new MillError(
      "DEPENDENCY_CONTAINER_CLEANUP_FAILED",
      "Mill could not remove the exact dependency-preparation container.",
      ExitCode.temporary,
      { containerName },
    );
  }
}

async function prepareDependencySnapshotWithSignal(input: {
  root: string;
  stateDirectory: string;
  config: MillConfig;
  attended: boolean;
  signal: AbortSignal;
}): Promise<DependencyPreparationResult> {
  if (!input.attended) {
    throw new MillError(
      "ATTENDANCE_REQUIRED",
      "Dependency preparation requires attended approval for registry network access.",
      ExitCode.configuration,
    );
  }
  if (input.config.trustCeiling === "inspect") {
    throw new MillError(
      "BUILD_NOT_AUTHORIZED",
      "mill.yaml trust ceiling does not authorize dependency preparation.",
      ExitCode.configuration,
    );
  }
  const dependencies = input.config.verifier?.dependencies;
  const image = input.config.verifier?.image;
  if (dependencies === undefined || image === undefined) {
    throw new MillError(
      "VERIFIER_DEPENDENCIES_NOT_CONFIGURED",
      "This repository does not declare a verifier dependency snapshot.",
      ExitCode.configuration,
    );
  }
  if (input.signal.aborted) {
    throw new MillError(
      "DEPENDENCY_PREPARATION_CANCELLED",
      "Dependency preparation was cancelled before execution.",
      ExitCode.temporary,
    );
  }
  const parent = path.join(input.stateDirectory, "dependencies");
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await chmod(parent, 0o700);
  const temporary = await mkdtemp(path.join(parent, ".prepare-"));
  await chmod(temporary, 0o700);
  let preparationLease:
    Awaited<ReturnType<typeof acquireExclusiveLease>> | undefined;
  try {
    const canonicalRoot = await realpath(input.root);
    const inputPaths = await dependencyInputPaths(canonicalRoot, input.config);
    for (const relative of inputPaths) {
      const sourceFile = await realpath(path.resolve(canonicalRoot, relative));
      if (
        !isWithin(canonicalRoot, sourceFile) ||
        !(await stat(sourceFile)).isFile()
      ) {
        throw new MillError(
          "VERIFIER_DEPENDENCY_LOCK_INVALID",
          "A dependency lock input is not a regular in-repository file.",
          ExitCode.configuration,
          { path: relative },
        );
      }
      const destinationFile = path.join(temporary, relative);
      await mkdir(path.dirname(destinationFile), {
        recursive: true,
        mode: 0o700,
      });
      await copyFile(sourceFile, destinationFile);
    }
    const identity = await dependencyIdentity(temporary, input.config);
    const emptyDependencyGraph =
      dependencies.manager === "npm"
        ? await validateNpmLock(temporary, inputPaths)
        : await validatePnpmLock(
            temporary,
            dependencies,
            await pnpmWorkspaceManifestPaths(temporary, dependencies),
          );
    const destination = path.join(parent, identity.key);
    preparationLease = await acquireExclusiveLease({
      path: `${destination}.lease.sqlite3`,
      activeCode: "DEPENDENCY_PREPARATION_ACTIVE",
      activeMessage:
        "Another process owns preparation of this exact dependency snapshot.",
      unavailableCode: "DEPENDENCY_PREPARATION_LEASE_UNAVAILABLE",
      unavailableMessage:
        "The exact dependency snapshot lease could not be acquired safely.",
    });
    if (await markerMatches(destination, identity.marker)) {
      return {
        directory: destination,
        reused: true,
        network: "none; exact dependency snapshot already present",
      };
    }
    const staleDestination = await lstat(destination).catch(
      (error: unknown) => {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return undefined;
        }
        throw error;
      },
    );
    if (staleDestination !== undefined) {
      await rm(destination, { recursive: true, force: true });
    }
    const docker = await findTrustedExecutable("docker", input.root);
    if (docker === undefined) {
      throw new MillError(
        "OCI_RUNTIME_UNAVAILABLE",
        "A trusted Docker executable is required to prepare recipe dependencies.",
        ExitCode.unavailable,
      );
    }
    const inspection = await runProcess({
      executable: docker,
      args: ["image", "inspect", image],
      cwd: input.root,
      env: { HOME: process.env.HOME, PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
      deadlineMs: Date.now() + 15_000,
      maxOutputBytes: 256 * 1024,
      signal: input.signal,
    });
    if (inspection.exitCode !== 0) {
      throw new MillError(
        "VERIFIER_IMAGE_UNAVAILABLE",
        "The exact verifier image is not local; Mill will not pull it implicitly.",
        ExitCode.unavailable,
        { image },
      );
    }
    const canonicalTemporary = await realpath(temporary);
    const mount = await mountSource(canonicalTemporary);
    const containerName = `mill-deps-${randomUUID()}`;
    const uid = process.getuid?.() ?? 1000;
    const gid = process.getgid?.() ?? 1000;
    let result: ProcessResult;
    try {
      result = await runProcess({
        executable: docker,
        args: [
          "run",
          "--pull",
          "never",
          "--name",
          containerName,
          "--label",
          "dev.mill.owner=dependency-preparation",
          "--network",
          "bridge",
          "--read-only",
          "--cap-drop",
          "ALL",
          "--security-opt",
          "no-new-privileges",
          "--pids-limit",
          "256",
          "--memory",
          "2g",
          "--cpus",
          "2",
          "--tmpfs",
          "/tmp:rw,nosuid,nodev,size=512m",
          "--mount",
          `type=bind,source=${mount.source},target=/workspace`,
          "--workdir",
          "/workspace",
          "--user",
          `${uid}:${gid}`,
          "--env",
          "HOME=/tmp",
          "--env",
          `npm_config_registry=${dependencies.registry}`,
          "--env",
          "npm_config_ignore_scripts=true",
          "--env",
          "npm_config_audit=false",
          "--env",
          "npm_config_fund=false",
          ...(dependencies.manager === "pnpm"
            ? [
                "--env",
                `MILL_PNPM_VERSION=${dependencies.version}`,
                "--entrypoint",
                "/bin/sh",
                image,
                "-ec",
                'test "$(/usr/local/bin/pnpm --version)" = "$MILL_PNPM_VERSION"; exec /usr/local/bin/pnpm install --frozen-lockfile --ignore-scripts --store-dir /tmp/pnpm-store',
              ]
            : [
                "--entrypoint",
                "npm",
                image,
                "ci",
                "--ignore-scripts",
                "--audit=false",
                "--fund=false",
              ]),
        ],
        cwd: input.root,
        env: { HOME: process.env.HOME, PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
        deadlineMs: Date.now() + 10 * 60_000,
        maxOutputBytes: 2 * 1024 * 1024,
        signal: input.signal,
      });
    } finally {
      try {
        await removeContainer(docker, input.root, containerName);
      } finally {
        await mount.dispose();
      }
    }
    if (
      result.exitCode !== 0 ||
      result.timedOut ||
      result.outputExceeded ||
      result.cancelled
    ) {
      throw new MillError(
        "DEPENDENCY_PREPARATION_FAILED",
        "The exact dependency snapshot could not be prepared.",
        ExitCode.unavailable,
        {
          exitCode: result.exitCode,
          stderrDigest: `sha256:${createHash("sha256")
            .update(result.stderr, "utf8")
            .digest("hex")}`,
        },
      );
    }
    let modules = await lstat(path.join(temporary, "node_modules")).catch(
      () => undefined,
    );
    if (modules === undefined && emptyDependencyGraph) {
      await mkdir(path.join(temporary, "node_modules"), { mode: 0o700 });
      modules = await lstat(path.join(temporary, "node_modules"));
    }
    if (
      modules === undefined ||
      !modules.isDirectory() ||
      modules.isSymbolicLink()
    ) {
      throw new MillError(
        "DEPENDENCY_OUTPUT_INVALID",
        "Dependency preparation completed without a regular node_modules directory.",
        ExitCode.unavailable,
      );
    }
    const completedIdentity = await dependencyIdentity(temporary, input.config);
    if (
      completedIdentity.key !== identity.key ||
      JSON.stringify(completedIdentity.marker) !==
        JSON.stringify(identity.marker)
    ) {
      throw new MillError(
        "VERIFIER_DEPENDENCY_LOCK_DRIFT",
        "Frozen dependency lock inputs changed during preparation.",
        ExitCode.configuration,
      );
    }
    const marker: DependencyMarker = {
      ...identity.marker,
      treeDigest: await dependencyTreeDigest(
        path.join(temporary, "node_modules"),
        temporary,
      ),
      ...(dependencies.manager === "pnpm"
        ? {
            workspaceTreeDigests: await pnpmWorkspaceTreeDigests(
              temporary,
              dependencies,
            ),
          }
        : {}),
    };
    await writeFile(
      path.join(temporary, "marker.json"),
      `${JSON.stringify(marker)}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
    try {
      await rename(temporary, destination);
    } catch (error) {
      if (!(await markerMatches(destination, identity.marker))) throw error;
    }
    return {
      directory: destination,
      reused: false,
      network: `HTTPS to https://registry.npmjs.org through the exact verifier image; ${dependencies.manager} lifecycle scripts disabled`,
    };
  } finally {
    try {
      await rm(temporary, { recursive: true, force: true });
    } finally {
      await preparationLease?.release();
    }
  }
}

export async function prepareDependencySnapshot(input: {
  root: string;
  stateDirectory: string;
  config: MillConfig;
  attended: boolean;
  signal?: AbortSignal;
}): Promise<DependencyPreparationResult> {
  const signals = processCancellationScope(input.signal);
  try {
    return await prepareDependencySnapshotWithSignal({
      ...input,
      signal: signals.signal,
    });
  } finally {
    signals.dispose();
  }
}
