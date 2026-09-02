import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { ExitCode, MillError } from "../errors.js";

export interface ProcessSpec {
  executable: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin?: string;
  deadlineMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
  onBeforeSpawn?: () => void;
  onSpawn?: (process: ActiveProcess) => void;
  onExit?: (process?: ActiveProcess) => void;
  cancellationRequested?: () => boolean;
}

export interface ActiveProcess {
  id: string;
  pid: number;
  processGroup: number;
  identity: string;
}

export interface ProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  outputExceeded: boolean;
  cancelled: boolean;
}

export interface ProcessCancellationScope {
  signal: AbortSignal;
  dispose(): void;
}

export function processCancellationScope(
  parent?: AbortSignal,
): ProcessCancellationScope {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  parent?.addEventListener("abort", abort, { once: true });
  if (parent?.aborted === true) abort();
  return {
    signal: controller.signal,
    dispose(): void {
      process.removeListener("SIGINT", abort);
      process.removeListener("SIGTERM", abort);
      parent?.removeEventListener("abort", abort);
    },
  };
}

function terminate(pid: number, signal: NodeJS.Signals): void {
  try {
    if (process.platform === "win32") {
      process.kill(pid, signal);
    } else {
      process.kill(-pid, signal);
    }
  } catch {
    // The process may have exited between observation and termination.
  }
}

function identityDigest(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function observeProcess(pid: number): Omit<ActiveProcess, "id"> | undefined {
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined;
  try {
    if (process.platform === "linux") {
      const boot = readFileSync(
        "/proc/sys/kernel/random/boot_id",
        "utf8",
      ).trim();
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const commandEnd = stat.lastIndexOf(")");
      if (commandEnd < 0) return undefined;
      const fields = stat
        .slice(commandEnd + 1)
        .trim()
        .split(/\s+/u);
      const processGroup = fields[2];
      const startedAtTick = fields[19];
      if (processGroup === undefined || startedAtTick === undefined) {
        return undefined;
      }
      const parsedProcessGroup = Number(processGroup);
      if (
        !Number.isSafeInteger(parsedProcessGroup) ||
        parsedProcessGroup <= 0
      ) {
        return undefined;
      }
      return {
        pid,
        processGroup: parsedProcessGroup,
        identity: identityDigest(
          `linux\0${boot}\0${pid}\0${processGroup}\0${startedAtTick}`,
        ),
      };
    }
    if (process.platform === "darwin" || process.platform === "freebsd") {
      const groupResult = spawnSync(
        "/bin/ps",
        ["-p", String(pid), "-o", "pgid="],
        { encoding: "utf8", timeout: 2_000, maxBuffer: 64 * 1024 },
      );
      const identityResult = spawnSync(
        "/bin/ps",
        ["-ww", "-p", String(pid), "-o", "lstart=", "-o", "command="],
        { encoding: "utf8", timeout: 2_000, maxBuffer: 64 * 1024 },
      );
      const processGroup = Number(groupResult.stdout.trim());
      const value =
        identityResult.status === 0 ? identityResult.stdout.trim() : "";
      if (
        groupResult.status !== 0 ||
        !Number.isSafeInteger(processGroup) ||
        processGroup <= 0 ||
        value.length === 0
      ) {
        return undefined;
      }
      return {
        pid,
        processGroup,
        identity: identityDigest(`${process.platform}\0${pid}\0${value}`),
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function processIdentity(pid: number): string | undefined {
  return observeProcess(pid)?.identity;
}

export function processIdentityStatus(
  process: ActiveProcess,
): "match" | "mismatch" | "unknown" {
  const observed = observeProcess(process.pid);
  if (observed !== undefined) {
    return observed.identity === process.identity &&
      observed.processGroup === process.processGroup
      ? "match"
      : "mismatch";
  }
  try {
    globalThis.process.kill(process.pid, 0);
    return "unknown";
  } catch (error) {
    return error instanceof Error &&
      "code" in error &&
      (error.code === "ESRCH" || error.code === "EINVAL")
      ? "mismatch"
      : "unknown";
  }
}

export async function runProcess(spec: ProcessSpec): Promise<ProcessResult> {
  if (!Number.isSafeInteger(spec.deadlineMs) || spec.deadlineMs <= Date.now()) {
    throw new MillError(
      "INVALID_PROCESS_DEADLINE",
      "The process deadline must be an absolute future timestamp.",
      ExitCode.configuration,
    );
  }
  if (!Number.isSafeInteger(spec.maxOutputBytes) || spec.maxOutputBytes <= 0) {
    throw new MillError(
      "INVALID_PROCESS_OUTPUT_BUDGET",
      "The process output budget must be a positive safe integer.",
      ExitCode.configuration,
    );
  }
  const startedAt = Date.now();
  return await new Promise<ProcessResult>((resolve, reject) => {
    try {
      spec.onBeforeSpawn?.();
    } catch (error) {
      reject(
        new MillError(
          "PROCESS_LAUNCH_INTENT_FAILED",
          "Durable process launch intent could not be recorded.",
          ExitCode.io,
          { cause: String(error) },
        ),
      );
      return;
    }
    const child = spawn(spec.executable, [...spec.args], {
      cwd: spec.cwd,
      env: spec.env,
      detached: process.platform !== "win32",
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let timedOut = false;
    let outputExceeded = false;
    let cancelled = false;
    let settled = false;
    let forceTimer: NodeJS.Timeout | undefined;
    let cancellationPoll: NodeJS.Timeout | undefined;
    let cancellationPollFailed = false;
    let activeProcess: ActiveProcess | undefined;
    let bindingFailure: unknown;

    const stop = (reason: "timeout" | "output" | "cancel"): void => {
      if (child.pid === undefined) return;
      const pid = child.pid;
      timedOut ||= reason === "timeout";
      outputExceeded ||= reason === "output";
      cancelled ||= reason === "cancel";
      terminate(pid, "SIGTERM");
      if (forceTimer === undefined) {
        forceTimer = setTimeout(() => terminate(pid, "SIGKILL"), 2_000);
        forceTimer.unref();
      }
    };
    const timeout = setTimeout(
      () => stop("timeout"),
      Math.max(1, spec.deadlineMs - Date.now()),
    );
    timeout.unref();
    const abort = (): void => stop("cancel");
    spec.signal?.addEventListener("abort", abort, { once: true });
    if (spec.signal?.aborted === true) abort();
    if (spec.cancellationRequested !== undefined) {
      const checkCancellation = (): void => {
        try {
          if (spec.cancellationRequested?.() === true) stop("cancel");
        } catch {
          cancellationPollFailed = true;
          stop("cancel");
        }
      };
      checkCancellation();
      cancellationPoll = setInterval(checkCancellation, 100);
      cancellationPoll.unref();
    }

    const clearLifecycleTimers = (): void => {
      clearTimeout(timeout);
      if (forceTimer !== undefined) clearTimeout(forceTimer);
      if (cancellationPoll !== undefined) clearInterval(cancellationPoll);
    };

    const capture = (target: "stdout" | "stderr", chunk: Buffer): void => {
      if (outputExceeded) return;
      const total = stdout.byteLength + stderr.byteLength + chunk.byteLength;
      if (total > spec.maxOutputBytes) {
        outputExceeded = true;
        stop("output");
        return;
      }
      if (target === "stdout") stdout = Buffer.concat([stdout, chunk]);
      else stderr = Buffer.concat([stderr, chunk]);
    };
    child.stdout.on("data", (chunk: Buffer) => capture("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => capture("stderr", chunk));
    child.stdin.on("error", () => {
      // A fast-failing child can close stdin before the parent finishes
      // binding state and writing input. Its exit status remains authoritative.
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearLifecycleTimers();
      spec.signal?.removeEventListener("abort", abort);
      try {
        spec.onExit?.(activeProcess);
      } catch {
        // Preserve the process-start failure as the primary error.
      }
      reject(
        new MillError(
          "PROCESS_START_FAILED",
          `Unable to start ${spec.executable}.`,
          ExitCode.unavailable,
          { cause: String(error) },
        ),
      );
    });
    child.once("spawn", () => {
      try {
        if (child.pid !== undefined && spec.onSpawn !== undefined) {
          const observed = observeProcess(child.pid);
          if (observed?.processGroup !== child.pid) {
            throw new Error("child process identity unavailable");
          }
          activeProcess = { id: randomUUID(), ...observed };
          spec.onSpawn(activeProcess);
        }
      } catch (error) {
        bindingFailure = error;
        const childPid = child.pid;
        if (childPid !== undefined) {
          terminate(childPid, "SIGTERM");
          forceTimer = setTimeout(() => terminate(childPid, "SIGKILL"), 2_000);
          forceTimer.unref();
        }
        return;
      }
      if (spec.stdin === undefined) child.stdin.end();
      else child.stdin.end(spec.stdin, "utf8");
    });
    child.once("close", (exitCode, signal) => {
      if (forceTimer !== undefined) {
        clearTimeout(forceTimer);
        if (child.pid !== undefined) terminate(child.pid, "SIGKILL");
      }
      if (settled) return;
      settled = true;
      clearLifecycleTimers();
      spec.signal?.removeEventListener("abort", abort);
      if (bindingFailure !== undefined) {
        try {
          spec.onExit?.(activeProcess);
        } catch {
          // Preserve the binding failure as the primary error.
        }
        reject(
          new MillError(
            "PROCESS_STATE_BINDING_FAILED",
            "The child process started but its durable PID binding failed.",
            ExitCode.io,
            {
              cause:
                bindingFailure instanceof Error
                  ? bindingFailure.message
                  : "unknown binding failure",
            },
          ),
        );
        return;
      }
      if (cancellationPollFailed) {
        try {
          spec.onExit?.(activeProcess);
        } catch {
          // Preserve the cancellation-state read failure.
        }
        reject(
          new MillError(
            "PROCESS_STATE_BINDING_FAILED",
            "The child process was stopped because durable cancellation state could not be read.",
            ExitCode.io,
          ),
        );
        return;
      }
      try {
        spec.onExit?.(activeProcess);
      } catch (error) {
        reject(
          new MillError(
            "PROCESS_STATE_BINDING_FAILED",
            "The child process exited but its durable PID binding could not be cleared.",
            ExitCode.io,
            { cause: String(error) },
          ),
        );
        return;
      }
      resolve({
        exitCode,
        signal,
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
        durationMs: Date.now() - startedAt,
        timedOut,
        outputExceeded,
        cancelled,
      });
    });
  });
}
