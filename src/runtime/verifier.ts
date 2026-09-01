import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdtemp, realpath, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { findTrustedExecutable } from "../doctor.js";
import { validationEvidenceSchema } from "../contracts/schemas.js";
import { ExitCode, MillError } from "../errors.js";
import { isWithin } from "../security/safe-path.js";
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
}): ValidationEvidence {
  return validationEvidenceSchema.parse({
    schemaVersion: "1",
    candidateCommit: input.candidateCommit,
    verifierImage: input.verifierImage,
    network: "none",
    commands: input.commands,
    passed: input.commands.every(
      (item) => !item.required || item.status === "passed",
    ),
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

export async function verifyDeclaredCommands(input: {
  root: string;
  candidateCommit: string;
  config: MillConfig;
  task: TaskPacket;
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
  const mount = await verifierMountSource(canonicalRoot);
  try {
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
      let result: ProcessResult;
      try {
        result = await runProcess({
          executable: docker,
          args: [
            "run",
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
            "128",
            "--memory",
            "1g",
            "--cpus",
            "2",
            "--tmpfs",
            "/tmp:rw,noexec,nosuid,nodev,size=256m",
            "--mount",
            `type=bind,source=${mount.source},target=/workspace,readonly`,
            "--workdir",
            containerCwd,
            "--user",
            `${uid}:${gid}`,
            "--env",
            "HOME=/tmp",
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
    });
  } finally {
    await mount.dispose();
  }
}
