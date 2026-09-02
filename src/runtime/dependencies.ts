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

import { findTrustedExecutable } from "../doctor.js";
import { ExitCode, MillError } from "../errors.js";
import { isWithin } from "../security/safe-path.js";
import type { MillConfig } from "./inputs.js";
import {
  processCancellationScope,
  runProcess,
  type ProcessResult,
} from "./process.js";

interface DependencyIdentity {
  schemaVersion: "1";
  image: string;
  manager: "npm";
  registry: "https://registry.npmjs.org";
  targetPath: string;
  locks: { path: string; digest: string }[];
}

interface DependencyMarker extends DependencyIdentity {
  treeDigest: string;
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
  const locks = await Promise.all(
    dependencies.lockPaths.map(async (relative) => {
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
    registry: dependencies.registry,
    targetPath: dependencies.targetPath,
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

async function dependencyTreeDigest(directory: string): Promise<string> {
  const canonicalRoot = await realpath(directory);
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
          !isWithin(canonicalRoot, resolvedTarget) ||
          !isWithin(canonicalRoot, await realpath(childAbsolute))
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
      parsed.manager !== "npm" ||
      parsed.registry !== "https://registry.npmjs.org" ||
      typeof parsed.targetPath !== "string" ||
      !Array.isArray(parsed.locks) ||
      !/^sha256:[0-9a-f]{64}$/u.test(parsed.treeDigest ?? "")
    ) {
      return false;
    }
    const claimedIdentity: DependencyIdentity = {
      schemaVersion: parsed.schemaVersion,
      image: parsed.image,
      manager: parsed.manager,
      registry: parsed.registry,
      targetPath: parsed.targetPath,
      locks: parsed.locks,
    };
    return (
      JSON.stringify(claimedIdentity) === JSON.stringify(expected) &&
      parsed.treeDigest ===
        (await dependencyTreeDigest(path.join(directory, "node_modules")))
    );
  } catch {
    return false;
  }
}

async function validateNpmLock(
  root: string,
  lockPaths: readonly string[],
): Promise<void> {
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
  try {
    const canonicalRoot = await realpath(input.root);
    for (const relative of dependencies.lockPaths) {
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
    await validateNpmLock(temporary, dependencies.lockPaths);
    const destination = path.join(parent, identity.key);
    if (await markerMatches(destination, identity.marker)) {
      await rm(temporary, { recursive: true, force: true });
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
          "--entrypoint",
          "npm",
          image,
          "ci",
          "--ignore-scripts",
          "--audit=false",
          "--fund=false",
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
        { exitCode: result.exitCode, stderr: result.stderr.slice(0, 2_000) },
      );
    }
    const modules = await lstat(path.join(temporary, "node_modules")).catch(
      () => undefined,
    );
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
      ),
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
      await rm(temporary, { recursive: true, force: true });
    }
    return {
      directory: destination,
      reused: false,
      network:
        "HTTPS to https://registry.npmjs.org through the exact verifier image; lifecycle scripts disabled",
    };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
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
