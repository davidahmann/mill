import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  opendir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { findTrustedExecutable } from "../doctor.js";
import { validationEvidenceSchema } from "../contracts/schemas.js";
import { ExitCode, MillError } from "../errors.js";
import { isWithin } from "../security/safe-path.js";
import {
  buildSemanticEvidence,
  type ContinuityProductContract,
  type ContinuityScenarioSet,
  type ImpactManifest,
} from "../planning/impact.js";
import type { MillConfig, TaskPacket } from "./inputs.js";
import {
  runProcess,
  type ActiveProcess,
  type ProcessResult,
} from "./process.js";

export interface CommandEvidence {
  commandId: string;
  required: boolean;
  status: "passed" | "failed" | "blocked";
  exitCode: number | null;
  durationMs: number;
  outputDigest: string;
  reason?: string;
}

export type ValidationEvidence = ReturnType<
  typeof validationEvidenceSchema.parse
>;

function digestOutput(stdout: string, stderr: string): string {
  return `sha256:${createHash("sha256")
    .update(stdout, "utf8")
    .update("\0", "utf8")
    .update(stderr, "utf8")
    .digest("hex")}`;
}

function stoppedCommands(
  config: MillConfig,
  commandIds: readonly string[],
  reason: "CANCELLED" | "DEADLINE_EXCEEDED",
): CommandEvidence[] {
  return commandIds.map((commandId) => ({
    commandId,
    required: config.commands[commandId]?.required ?? true,
    status: "failed",
    exitCode: null,
    durationMs: 0,
    outputDigest: digestOutput("", ""),
    reason,
  }));
}

function validationEvidence(input: {
  candidateCommit: string;
  verifierImage: string;
  commands: readonly CommandEvidence[];
  task: TaskPacket;
  impact?: ImpactManifest;
  product?: ContinuityProductContract;
  scenarios?: ContinuityScenarioSet;
}): ValidationEvidence {
  const semantic =
    input.impact === undefined ||
    input.product === undefined ||
    input.scenarios === undefined
      ? undefined
      : buildSemanticEvidence({
          task: input.task,
          manifest: input.impact,
          product: input.product,
          scenarios: input.scenarios,
          commandResults: input.commands,
        });
  const commandsPassed = input.commands.every(
    (item) => !item.required || item.status === "passed",
  );
  return validationEvidenceSchema.parse({
    schemaVersion: "1",
    candidateCommit: input.candidateCommit,
    verifierImage: input.verifierImage,
    network: "none",
    commands: input.commands,
    ...(semantic === undefined ? {} : { semantic }),
    passed: commandsPassed && (semantic?.passed ?? true),
  });
}

async function verifyImageAvailable(
  docker: string,
  root: string,
  image: string,
  deadlineMs: number,
  lifecycle: {
    signal?: AbortSignal;
    onSpawn?: (process: ActiveProcess) => void;
    onExit?: (process?: ActiveProcess) => void;
    cancellationRequested?: () => boolean;
  },
): Promise<void> {
  const preflightDeadline = Math.min(deadlineMs, Date.now() + 15_000);
  if (preflightDeadline <= Date.now()) {
    throw new MillError(
      "VERIFIER_DEADLINE_EXCEEDED",
      "The approved verifier deadline elapsed before image inspection.",
      ExitCode.temporary,
    );
  }
  const result = await runProcess({
    executable: docker,
    args: ["image", "inspect", image],
    cwd: root,
    env: {
      HOME: process.env.HOME,
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin",
      LANG: "C",
      LC_ALL: "C",
    },
    deadlineMs: preflightDeadline,
    maxOutputBytes: 256 * 1024,
    ...lifecycle,
  });
  if (result.timedOut) {
    throw new MillError(
      "VERIFIER_DEADLINE_EXCEEDED",
      "Verifier image inspection exceeded the approved deadline.",
      ExitCode.temporary,
    );
  }
  if (result.cancelled) {
    throw new MillError(
      "VERIFIER_CANCELLED",
      "Verifier image inspection was cancelled.",
      ExitCode.temporary,
    );
  }
  if (result.outputExceeded) {
    throw new MillError(
      "VERIFIER_OUTPUT_BUDGET_EXCEEDED",
      "Verifier image inspection exceeded its output budget.",
      ExitCode.temporary,
    );
  }
  if (result.exitCode !== 0) {
    throw new MillError(
      "VERIFIER_IMAGE_UNAVAILABLE",
      "The exact verifier image is not present locally; Mill will not pull implicitly.",
      ExitCode.unavailable,
      { image },
    );
  }
}

async function removeVerifierContainer(
  docker: string,
  root: string,
  containerName: string,
): Promise<void> {
  const result = await runProcess({
    executable: docker,
    args: ["rm", "--force", "--volumes", containerName],
    cwd: root,
    env: {
      HOME: process.env.HOME,
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin",
      LANG: "C",
      LC_ALL: "C",
    },
    deadlineMs: Date.now() + 15_000,
    maxOutputBytes: 256 * 1024,
  });
  if (
    result.exitCode !== 0 ||
    result.timedOut ||
    result.outputExceeded ||
    result.cancelled
  ) {
    if (result.exitCode !== 0 && /no such container/iu.test(result.stderr)) {
      return;
    }
    throw new MillError(
      "VERIFIER_CONTAINER_CLEANUP_FAILED",
      "Mill could not prove that its OCI verifier container was stopped and removed.",
      ExitCode.temporary,
      {
        containerName,
        exitCode: result.exitCode,
        stderr: result.stderr.slice(0, 2_000),
      },
    );
  }
}

async function verifierMountSource(root: string): Promise<{
  source: string;
  dispose(): Promise<void>;
}> {
  if (!root.includes(",")) {
    return { source: root, dispose: () => Promise.resolve() };
  }
  const parent = await mkdtemp(path.join(tmpdir(), "mill-bind-"));
  await chmod(parent, 0o700);
  const source = path.join(parent, "workspace");
  try {
    if (source.includes(",")) {
      throw new MillError(
        "VERIFIER_MOUNT_ALIAS_UNAVAILABLE",
        "The trusted temporary directory cannot represent this OCI bind path safely.",
        ExitCode.configuration,
      );
    }
    await symlink(root, source, "dir");
    if ((await realpath(source)) !== root) {
      throw new MillError(
        "VERIFIER_MOUNT_ALIAS_INVALID",
        "The OCI bind alias does not resolve to the exact candidate workspace.",
        ExitCode.configuration,
      );
    }
    return {
      source,
      async dispose(): Promise<void> {
        try {
          await rm(parent, { recursive: true });
        } catch (error) {
          throw new MillError(
            "VERIFIER_MOUNT_ALIAS_CLEANUP_FAILED",
            "Mill could not remove its protected OCI bind alias.",
            ExitCode.io,
            { cause: String(error) },
          );
        }
      },
    };
  } catch (error) {
    await rm(parent, { recursive: true, force: true });
    throw error;
  }
}

async function removeWorkspaceSkeleton(skeleton: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await rm(skeleton, { recursive: true });
      return;
    } catch (error) {
      lastError = error;
      const code =
        error instanceof Error && "code" in error ? error.code : undefined;
      if (!new Set(["EACCES", "EBUSY", "ENOTEMPTY"]).has(String(code))) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new MillError(
    "VERIFIER_WORKSPACE_CLEANUP_FAILED",
    "Mill could not remove its protected verifier workspace skeleton.",
    ExitCode.temporary,
    { cause: String(lastError) },
  );
}

async function workspaceMountPlan(
  root: string,
  declaredMountPaths: readonly string[],
): Promise<{
  mounts: string[];
  dispose(): Promise<void>;
}> {
  const mountPaths = [...new Set(declaredMountPaths)].sort();
  for (const mountPath of mountPaths) {
    if (
      mountPath.includes("/") ||
      mountPath.includes(",") ||
      mountPath === "."
    ) {
      throw new MillError(
        "VERIFIER_MOUNT_PATH_UNSUPPORTED",
        "Writable and dependency mount targets must be top-level repository directories.",
        ExitCode.configuration,
        { path: mountPath },
      );
    }
    try {
      await lstat(path.join(root, mountPath));
      throw new MillError(
        "VERIFIER_WRITABLE_PATH_OCCUPIED",
        "A verifier mount would hide candidate content.",
        ExitCode.configuration,
        { path: mountPath },
      );
    } catch (error) {
      if (
        error instanceof MillError ||
        !(error instanceof Error && "code" in error && error.code === "ENOENT")
      ) {
        throw error;
      }
    }
  }
  const source = await verifierMountSource(root);
  const skeleton = await mkdtemp(path.join(tmpdir(), "mill-workspace-"));
  await chmod(skeleton, 0o700);
  try {
    for (const mountPath of mountPaths) {
      await mkdir(path.join(skeleton, mountPath), { mode: 0o700 });
    }
    const handle = await opendir(root);
    const entries = [];
    for await (const entry of handle) entries.push(entry);
    if (entries.length > 256) {
      throw new MillError(
        "VERIFIER_WORKSPACE_ENTRY_LIMIT_EXCEEDED",
        "The verifier workspace exceeds its top-level mount-entry limit.",
        ExitCode.configuration,
      );
    }
    const mounts = [
      "--mount",
      `type=bind,source=${skeleton},target=/workspace,readonly`,
    ];
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      if (mountPaths.includes(entry.name)) continue;
      if (entry.name.includes(",")) {
        throw new MillError(
          "VERIFIER_WORKSPACE_ENTRY_UNSUPPORTED",
          "A top-level candidate entry contains a comma and cannot be bound safely.",
          ExitCode.configuration,
          { path: entry.name },
        );
      }
      const information = await lstat(path.join(root, entry.name));
      if (information.isSymbolicLink()) {
        throw new MillError(
          "VERIFIER_WORKSPACE_ENTRY_UNSUPPORTED",
          "A top-level candidate symbolic link cannot cross the verifier mount boundary.",
          ExitCode.configuration,
          { path: entry.name },
        );
      }
      const target = path.join(skeleton, entry.name);
      if (information.isDirectory()) {
        await mkdir(target, { mode: 0o700 });
      } else if (information.isFile()) {
        await writeFile(target, "", { flag: "wx", mode: 0o600 });
      } else {
        throw new MillError(
          "VERIFIER_WORKSPACE_ENTRY_UNSUPPORTED",
          "A top-level candidate entry has an unsupported filesystem type.",
          ExitCode.configuration,
          { path: entry.name },
        );
      }
      mounts.push(
        "--mount",
        `type=bind,source=${path.join(source.source, entry.name)},target=/workspace/${entry.name},readonly`,
      );
    }
    return {
      mounts,
      async dispose(): Promise<void> {
        try {
          await removeWorkspaceSkeleton(skeleton);
        } finally {
          await source.dispose();
        }
      },
    };
  } catch (error) {
    try {
      await removeWorkspaceSkeleton(skeleton);
    } finally {
      await source.dispose();
    }
    throw error;
  }
}

export async function verifyDeclaredCommands(input: {
  root: string;
  dependencyRoot?: string;
  candidateCommit: string;
  config: MillConfig;
  task: TaskPacket;
  impact?: ImpactManifest;
  product?: ContinuityProductContract;
  scenarios?: ContinuityScenarioSet;
  deadlineMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
  onSpawn?: (process: ActiveProcess) => void;
  onExit?: (process?: ActiveProcess) => void;
  cancellationRequested?: () => boolean;
}): Promise<ValidationEvidence> {
  if (input.config.verifier === undefined) {
    throw new MillError(
      "VERIFIER_NOT_CONFIGURED",
      "mill.yaml must bind an exact OCI verifier image for build mode.",
      ExitCode.configuration,
    );
  }
  const stopped =
    input.signal?.aborted === true || input.cancellationRequested?.() === true
      ? "CANCELLED"
      : Date.now() >= input.deadlineMs
        ? "DEADLINE_EXCEEDED"
        : undefined;
  if (stopped !== undefined) {
    return validationEvidence({
      candidateCommit: input.candidateCommit,
      verifierImage: input.config.verifier.image,
      commands: stoppedCommands(input.config, input.task.commandIds, stopped),
      task: input.task,
      ...(input.impact === undefined ? {} : { impact: input.impact }),
      ...(input.product === undefined ? {} : { product: input.product }),
      ...(input.scenarios === undefined ? {} : { scenarios: input.scenarios }),
    });
  }
  const docker = await findTrustedExecutable("docker", input.root);
  if (docker === undefined) {
    throw new MillError(
      "OCI_RUNTIME_UNAVAILABLE",
      "A trusted Docker executable is required for the qualified verifier.",
      ExitCode.unavailable,
    );
  }
  await verifyImageAvailable(
    docker,
    input.root,
    input.config.verifier.image,
    input.deadlineMs,
    {
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      ...(input.onSpawn === undefined ? {} : { onSpawn: input.onSpawn }),
      ...(input.onExit === undefined ? {} : { onExit: input.onExit }),
      ...(input.cancellationRequested === undefined
        ? {}
        : { cancellationRequested: input.cancellationRequested }),
    },
  );
  const evidence: CommandEvidence[] = [];
  const uid = process.getuid?.() ?? 1000;
  const gid = process.getgid?.() ?? 1000;
  const canonicalRoot = await realpath(input.root);
  const dependencyMounts: string[] = [];
  let dependencyMount:
    Awaited<ReturnType<typeof verifierMountSource>> | undefined;
  if (input.config.verifier.dependencies !== undefined) {
    if (input.dependencyRoot === undefined) {
      throw new MillError(
        "VERIFIER_DEPENDENCIES_UNAVAILABLE",
        "The verifier requires a qualified local dependency installation.",
        ExitCode.unavailable,
      );
    }
    const canonicalDependencyRoot = await realpath(input.dependencyRoot);
    for (const lockPath of input.config.verifier.dependencies.lockPaths) {
      const [candidateLock, dependencyLock] = await Promise.all([
        realpath(path.resolve(canonicalRoot, lockPath)),
        realpath(path.resolve(canonicalDependencyRoot, lockPath)),
      ]);
      if (
        !isWithin(canonicalRoot, candidateLock) ||
        !isWithin(canonicalDependencyRoot, dependencyLock) ||
        createHash("sha256")
          .update(await readFile(candidateLock))
          .digest("hex") !==
          createHash("sha256")
            .update(await readFile(dependencyLock))
            .digest("hex")
      ) {
        throw new MillError(
          "VERIFIER_DEPENDENCY_LOCK_DRIFT",
          "The dependency installation is bound to different lock inputs.",
          ExitCode.configuration,
          { lockPath },
        );
      }
    }
    const dependencyPath = await realpath(
      path.resolve(canonicalDependencyRoot, "node_modules"),
    );
    if (
      !isWithin(canonicalDependencyRoot, dependencyPath) ||
      !(await stat(dependencyPath)).isDirectory()
    ) {
      throw new MillError(
        "VERIFIER_DEPENDENCIES_UNAVAILABLE",
        "The configured dependency path is not a qualified local directory.",
        ExitCode.unavailable,
      );
    }
    dependencyMount = await verifierMountSource(dependencyPath);
    dependencyMounts.push(
      "--mount",
      `type=bind,source=${dependencyMount.source},target=/workspace/${input.config.verifier.dependencies.targetPath},readonly`,
    );
  }
  let workspace: Awaited<ReturnType<typeof workspaceMountPlan>> | undefined;
  try {
    workspace = await workspaceMountPlan(canonicalRoot, [
      ...(input.config.verifier.dependencies === undefined
        ? []
        : [input.config.verifier.dependencies.targetPath]),
      ...input.task.commandIds.flatMap(
        (commandId) =>
          input.config.commands[commandId]?.writablePaths?.map(
            (configuredPath) => configuredPath.replace(/\/\*\*$/u, ""),
          ) ?? [],
      ),
    ]);
    for (let index = 0; index < input.task.commandIds.length; index += 1) {
      const commandId = input.task.commandIds[index];
      if (commandId === undefined) continue;
      const cancelled =
        input.signal?.aborted === true ||
        input.cancellationRequested?.() === true;
      if (cancelled || Date.now() >= input.deadlineMs) {
        const reason = cancelled ? "CANCELLED" : "DEADLINE_EXCEEDED";
        evidence.push(
          ...stoppedCommands(
            input.config,
            input.task.commandIds.slice(index),
            reason,
          ),
        );
        break;
      }
      const command = input.config.commands[commandId];
      if (command === undefined) {
        throw new MillError(
          "UNKNOWN_COMMAND_ID",
          `Task selects unknown command ID: ${commandId}`,
          ExitCode.configuration,
        );
      }
      if (
        command.executableFixtureScratch === true &&
        (command.execution !== "oci" ||
          !["test", "package"].includes(command.capability))
      ) {
        throw new MillError(
          "VERIFIER_FIXTURE_SCRATCH_FORBIDDEN",
          "Executable fixture scratch requires an explicit OCI test/package command grant.",
          ExitCode.configuration,
          { commandId },
        );
      }
      if (command.execution !== "oci") {
        evidence.push({
          commandId,
          required: command.required,
          status: "blocked",
          exitCode: null,
          durationMs: 0,
          outputDigest: digestOutput("", ""),
          reason: "HOST_EXECUTION_NOT_QUALIFIED",
        });
        continue;
      }
      const commandExecutable = command.argv[0];
      if (commandExecutable === undefined) {
        throw new MillError(
          "INVALID_COMMAND",
          `Command ${commandId} has no executable.`,
          ExitCode.configuration,
        );
      }
      const commandDirectory = await realpath(
        path.resolve(canonicalRoot, command.cwd),
      );
      if (
        !isWithin(canonicalRoot, commandDirectory) ||
        !(await stat(commandDirectory)).isDirectory()
      ) {
        throw new MillError(
          "INVALID_COMMAND_DIRECTORY",
          `Command ${commandId} has an unsafe working directory.`,
          ExitCode.configuration,
        );
      }
      const containerCwd = `/workspace/${path.relative(canonicalRoot, commandDirectory)}`;
      const commandDeadline = Math.min(
        input.deadlineMs,
        Date.now() + command.timeoutSeconds * 1000,
      );
      const containerName = `mill-${randomUUID()}`;
      const writableMounts: string[] = [];
      for (const configuredPath of command.writablePaths ?? []) {
        const writablePath = configuredPath.replace(/\/\*\*$/u, "");
        const absoluteWritablePath = path.resolve(canonicalRoot, writablePath);
        if (!isWithin(canonicalRoot, absoluteWritablePath)) {
          throw new MillError(
            "VERIFIER_WRITABLE_PATH_INVALID",
            "A verifier writable path escaped the candidate workspace.",
            ExitCode.configuration,
            { path: configuredPath },
          );
        }
        writableMounts.push(
          "--mount",
          `type=tmpfs,target=/workspace/${writablePath},tmpfs-size=268435456,tmpfs-mode=1777`,
        );
      }
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
            "dev.mill.owner=verifier",
            "--network",
            "none",
            "--read-only",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges",
            "--pids-limit",
            "256",
            "--memory",
            "1g",
            "--cpus",
            "2",
            "--tmpfs",
            "/tmp:rw,noexec,nosuid,nodev,size=256m",
            "--tmpfs",
            "/dev/shm:rw,nosuid,nodev,size=256m",
            ...(command.executableFixtureScratch === true
              ? ["--tmpfs", "/mill-fixtures:rw,exec,nosuid,nodev,size=256m"]
              : []),
            ...workspace.mounts,
            ...dependencyMounts,
            ...writableMounts,
            "--workdir",
            containerCwd,
            "--user",
            `${uid}:${gid}`,
            "--env",
            "HOME=/tmp",
            "--env",
            "CI=1",
            "--env",
            "NEXT_TELEMETRY_DISABLED=1",
            "--env",
            "PLAYWRIGHT_BROWSERS_PATH=/ms-playwright",
            "--entrypoint",
            commandExecutable,
            input.config.verifier.image,
            ...command.argv.slice(1),
          ],
          cwd: input.root,
          env: {
            HOME: process.env.HOME,
            PATH: "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin",
            LANG: "C",
            LC_ALL: "C",
          },
          deadlineMs: commandDeadline,
          maxOutputBytes: input.maxOutputBytes,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
          ...(input.onSpawn === undefined ? {} : { onSpawn: input.onSpawn }),
          ...(input.onExit === undefined ? {} : { onExit: input.onExit }),
          ...(input.cancellationRequested === undefined
            ? {}
            : { cancellationRequested: input.cancellationRequested }),
        });
      } finally {
        await removeVerifierContainer(docker, input.root, containerName);
      }
      const passed =
        result.exitCode === 0 &&
        !result.timedOut &&
        !result.outputExceeded &&
        !result.cancelled;
      evidence.push({
        commandId,
        required: command.required,
        status: passed ? "passed" : "failed",
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        outputDigest: digestOutput(result.stdout, result.stderr),
        ...(passed
          ? {}
          : {
              reason: result.cancelled
                ? "CANCELLED"
                : result.timedOut
                  ? "DEADLINE_EXCEEDED"
                  : result.outputExceeded
                    ? "OUTPUT_BUDGET_EXCEEDED"
                    : "NONZERO_EXIT",
            }),
      });
    }
    return validationEvidence({
      candidateCommit: input.candidateCommit,
      verifierImage: input.config.verifier.image,
      commands: evidence,
      task: input.task,
      ...(input.impact === undefined ? {} : { impact: input.impact }),
      ...(input.product === undefined ? {} : { product: input.product }),
      ...(input.scenarios === undefined ? {} : { scenarios: input.scenarios }),
    });
  } finally {
    try {
      await workspace?.dispose();
    } finally {
      await dependencyMount?.dispose();
    }
  }
}
