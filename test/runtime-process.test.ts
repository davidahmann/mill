import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  processCancellationScope,
  processIdentityStatus,
  runProcess,
  type ActiveProcess,
} from "../src/runtime/process.js";
import { temporaryDirectory } from "./helpers.js";

describe("controlled process runner", () => {
  it("propagates and disposes an optional operation cancellation scope", () => {
    const sigintListeners = process.listenerCount("SIGINT");
    const sigtermListeners = process.listenerCount("SIGTERM");
    const parent = new AbortController();
    const scope = processCancellationScope(parent.signal);
    expect(scope.signal.aborted).toBe(false);
    parent.abort();
    expect(scope.signal.aborted).toBe(true);
    scope.dispose();
    expect(process.listenerCount("SIGINT")).toBe(sigintListeners);
    expect(process.listenerCount("SIGTERM")).toBe(sigtermListeners);

    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    const inherited = processCancellationScope(alreadyAborted.signal);
    expect(inherited.signal.aborted).toBe(true);
    inherited.dispose();

    const standalone = processCancellationScope();
    expect(standalone.signal.aborted).toBe(false);
    standalone.dispose();
  });

  it("enforces absolute deadlines and output budgets", async () => {
    const timed = await runProcess({
      executable: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      cwd: process.cwd(),
      env: {},
      deadlineMs: Date.now() + 100,
      maxOutputBytes: 1024,
    });
    expect(timed.timedOut).toBe(true);

    const noisy = await runProcess({
      executable: process.execPath,
      args: [
        "-e",
        "process.stdout.write('x'.repeat(10000));setInterval(() => {}, 1000)",
      ],
      cwd: process.cwd(),
      env: {},
      deadlineMs: Date.now() + 5_000,
      maxOutputBytes: 1024,
    });
    expect(noisy.outputExceeded).toBe(true);
    expect(noisy.stdout.length).toBeLessThanOrEqual(1024);
  });

  it("cancels the detached process group", async () => {
    const temporary = await temporaryDirectory("mill-process-group-");
    const pidFile = path.join(temporary.path, "descendant.pid");
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 250).unref();
    try {
      const result = await runProcess({
        executable: process.execPath,
        args: [
          "-e",
          'const {spawn}=require("node:child_process");const {writeFileSync}=require("node:fs");const target=process.env.MILL_TEST_PID_FILE;if(!target)process.exit(2);const child=spawn(process.execPath,["-e","process.on(\'SIGTERM\',()=>{});setInterval(()=>{},1000)"],{stdio:"ignore"});writeFileSync(target,String(child.pid));setInterval(()=>{},1000)',
        ],
        cwd: process.cwd(),
        env: { MILL_TEST_PID_FILE: pidFile },
        deadlineMs: Date.now() + 5_000,
        maxOutputBytes: 1024,
        signal: controller.signal,
      });
      expect(result.cancelled).toBe(true);
      expect(result.signal).not.toBeNull();
      const descendantPid = Number(await readFile(pidFile, "utf8"));
      for (let attempt = 0; attempt < 20; attempt += 1) {
        try {
          process.kill(descendantPid, 0);
          await new Promise((resolve) => setTimeout(resolve, 25));
        } catch (error) {
          if (
            error instanceof Error &&
            "code" in error &&
            error.code === "ESRCH"
          ) {
            break;
          }
          throw error;
        }
      }
      expect(() => process.kill(descendantPid, 0)).toThrow(
        expect.objectContaining({ code: "ESRCH" }),
      );
    } finally {
      await temporary.cleanup();
    }
  });

  it("rejects stale deadlines and missing executables with typed failures", async () => {
    await expect(
      runProcess({
        executable: process.execPath,
        args: [],
        cwd: process.cwd(),
        env: {},
        deadlineMs: Date.now() - 1,
        maxOutputBytes: 1024,
      }),
    ).rejects.toMatchObject({ code: "INVALID_PROCESS_DEADLINE" });
    await expect(
      runProcess({
        executable: "/definitely/missing/mill-tool",
        args: [],
        cwd: process.cwd(),
        env: {},
        deadlineMs: Date.now() + 5_000,
        maxOutputBytes: 1024,
      }),
    ).rejects.toMatchObject({ code: "PROCESS_START_FAILED" });
    await expect(
      runProcess({
        executable: process.execPath,
        args: [],
        cwd: process.cwd(),
        env: {},
        deadlineMs: Date.now() + 5_000,
        maxOutputBytes: 0,
      }),
    ).rejects.toMatchObject({ code: "INVALID_PROCESS_OUTPUT_BUDGET" });
  });

  it("streams stdin and binds process lifecycle callbacks", async () => {
    const temporary = await temporaryDirectory("mill-process-binding-");
    const sideEffect = path.join(temporary.path, "side-effect");
    let pid: number | undefined;
    let exited = false;
    const result = await runProcess({
      executable: process.execPath,
      args: [
        "-e",
        "let value='';process.stdin.on('data',c=>value+=c);process.stdin.on('end',()=>process.stdout.write(value.toUpperCase()))",
      ],
      cwd: process.cwd(),
      env: {},
      stdin: "bounded input",
      deadlineMs: Date.now() + 5_000,
      maxOutputBytes: 1024,
      onSpawn(value) {
        pid = value.pid;
      },
      onExit() {
        exited = true;
      },
    });
    expect(pid).toBeTypeOf("number");
    expect(exited).toBe(true);
    expect(result).toMatchObject({
      exitCode: 0,
      stdout: "BOUNDED INPUT",
      timedOut: false,
      outputExceeded: false,
      cancelled: false,
    });

    let failedExitCalled = false;
    await expect(
      runProcess({
        executable: process.execPath,
        args: [
          "-e",
          'const {writeFileSync}=require("node:fs");const target=process.env.MILL_TEST_SIDE_EFFECT;if(!target)process.exit(2);process.stdin.resume();process.stdin.on("end",()=>writeFileSync(target,"ran"));setInterval(()=>{},1000)',
        ],
        cwd: process.cwd(),
        env: { MILL_TEST_SIDE_EFFECT: sideEffect },
        stdin: "authorized work",
        deadlineMs: Date.now() + 5_000,
        maxOutputBytes: 1024,
        onSpawn() {
          throw new Error("state unavailable");
        },
        onExit() {
          failedExitCalled = true;
        },
      }),
    ).rejects.toMatchObject({ code: "PROCESS_STATE_BINDING_FAILED" });
    expect(failedExitCalled).toBe(true);
    await expect(readFile(sideEffect, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });

    await expect(
      runProcess({
        executable: process.execPath,
        args: ["-e", "process.exit(0)"],
        cwd: process.cwd(),
        env: {},
        deadlineMs: Date.now() + 5_000,
        maxOutputBytes: 1024,
        onExit() {
          throw new Error("state unavailable");
        },
      }),
    ).rejects.toMatchObject({ code: "PROCESS_STATE_BINDING_FAILED" });
    await temporary.cleanup();
  });

  it("honors a signal that was already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runProcess({
      executable: process.execPath,
      args: ["-e", "setInterval(()=>{},1000)"],
      cwd: process.cwd(),
      env: {},
      deadlineMs: Date.now() + 5_000,
      maxOutputBytes: 1024,
      signal: controller.signal,
    });
    expect(result.cancelled).toBe(true);
  });

  it("polls durable cancellation and distinguishes exact from reused process identity", async () => {
    let active: ActiveProcess | undefined;
    let checks = 0;
    const result = await runProcess({
      executable: process.execPath,
      args: ["-e", "setInterval(()=>{},1000)"],
      cwd: process.cwd(),
      env: {},
      deadlineMs: Date.now() + 5_000,
      maxOutputBytes: 1024,
      onSpawn(process) {
        active = process;
        expect(processIdentityStatus(process)).toBe("match");
        expect(
          processIdentityStatus({
            ...process,
            identity: `sha256:${"0".repeat(64)}`,
          }),
        ).toBe("mismatch");
      },
      cancellationRequested() {
        checks += 1;
        return checks >= 2;
      },
    });
    expect(result.cancelled).toBe(true);
    expect(active).toBeDefined();
    if (active === undefined) throw new Error("active process missing");
    expect(processIdentityStatus(active)).toBe("mismatch");
    expect(
      processIdentityStatus({
        id: "malformed",
        pid: 0,
        processGroup: 0,
        identity: `sha256:${"0".repeat(64)}`,
      }),
    ).toBe("unknown");
  });
});
