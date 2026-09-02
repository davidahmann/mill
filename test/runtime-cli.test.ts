import { describe, expect, it } from "vitest";

import { runCli } from "../src/cli-program.js";
import { runtimeFixture } from "./runtime-fixture.js";

function capture(): {
  io: {
    stdout: { write(value: string): void };
    stderr: { write(value: string): void };
  };
  stdout: string[];
  stderr: string[];
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: { write: (value) => void stdout.push(value) },
      stderr: { write: (value) => void stderr.push(value) },
    },
    stdout,
    stderr,
  };
}

async function jsonCommand(args: readonly string[]): Promise<{
  exitCode: number;
  value: Record<string, unknown>;
}> {
  const output = capture();
  const exitCode = await runCli(["--json", ...args], output.io);
  expect(output.stderr).toEqual([]);
  return {
    exitCode,
    value: JSON.parse(output.stdout.join("")) as Record<string, unknown>,
  };
}

describe("runtime CLI contracts", () => {
  it("exposes the attended local lifecycle, state controls, and redacted support projection", async () => {
    const fixture = await runtimeFixture();
    const previous = {
      state: process.env.MILL_STATE_HOME,
      codex: process.env.MILL_CODEX_PATH,
      docker: process.env.MILL_DOCKER_PATH,
    };
    process.env.MILL_STATE_HOME = fixture.stateHome;
    process.env.MILL_CODEX_PATH = fixture.codexPath;
    process.env.MILL_DOCKER_PATH = fixture.dockerPath;
    try {
      const auth = await jsonCommand(["--cwd", fixture.root, "auth", "status"]);
      expect(auth).toMatchObject({ exitCode: 0, value: { ok: true } });

      const baseline = await jsonCommand([
        "--cwd",
        fixture.root,
        "qualify",
        "--baseline",
        "--task",
        fixture.taskPath,
      ]);
      expect(baseline).toMatchObject({
        exitCode: 0,
        value: {
          ok: true,
        },
      });
      const approvalDigest = (baseline.value.data as { approvalDigest: string })
        .approvalDigest;
      expect(approvalDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);

      const rejected = await jsonCommand([
        "--cwd",
        fixture.root,
        "run",
        "--task",
        fixture.taskPath,
        "--approve",
        `sha256:${"0".repeat(64)}`,
        "--attended",
      ]);
      expect(rejected).toMatchObject({
        exitCode: 78,
        value: { reasons: [{ code: "TASK_APPROVAL_REQUIRED" }] },
      });

      const started = await jsonCommand([
        "--cwd",
        fixture.root,
        "run",
        "--task",
        fixture.taskPath,
        "--approve",
        approvalDigest,
        "--attended",
      ]);
      const startedData = started.value.data as {
        run: { id: string; status: string };
      };
      const runId = startedData.run.id;
      expect(startedData.run.status).toBe("committed");

      const status = await jsonCommand([
        "--cwd",
        fixture.root,
        "status",
        "--run",
        runId,
      ]);
      expect(status).toMatchObject({
        exitCode: 0,
        value: { data: { run: { status: "committed" } } },
      });

      expect(
        await jsonCommand([
          "--cwd",
          fixture.root,
          "verify",
          "--task",
          fixture.taskPath,
          "--run",
          runId,
        ]),
      ).toMatchObject({ exitCode: 0, value: { ok: true } });
      expect(
        await jsonCommand([
          "--cwd",
          fixture.root,
          "review",
          "--task",
          fixture.taskPath,
          "--run",
          runId,
        ]),
      ).toMatchObject({ exitCode: 0, value: { ok: true } });

      const support = await jsonCommand([
        "--cwd",
        fixture.root,
        "support-bundle",
        "--run",
        runId,
      ]);
      const supportSource = JSON.stringify(support.value);
      expect(supportSource).toContain("credentials, prompts");
      expect(supportSource).not.toContain(fixture.stateHome);
      expect(supportSource).not.toContain("export const value");

      const backedUp = await jsonCommand([
        "--cwd",
        fixture.root,
        "state",
        "backup",
      ]);
      const backupPath = (backedUp.value.data as { backupPath: string })
        .backupPath;
      expect(
        await jsonCommand([
          "--cwd",
          fixture.root,
          "state",
          "restore",
          "--from",
          backupPath,
        ]),
      ).toMatchObject({ exitCode: 0, value: { ok: true } });

      expect(
        await jsonCommand(["--cwd", fixture.root, "cancel", "--run", runId]),
      ).toMatchObject({
        exitCode: 0,
        value: { data: { run: { status: "cancelled" } } },
      });

      const second = await jsonCommand([
        "--cwd",
        fixture.root,
        "run",
        "--task",
        fixture.taskPath,
        "--approve",
        approvalDigest,
        "--attended",
      ]);
      const secondId = (second.value.data as { run: { id: string } }).run.id;
      expect(
        await jsonCommand(["--cwd", fixture.root, "cancel", "--run", secondId]),
      ).toMatchObject({
        exitCode: 0,
        value: { data: { run: { status: "cancelled" } } },
      });

      const mismatch = await jsonCommand([
        "--cwd",
        fixture.root,
        "state",
        "purge",
        "--confirm",
        "22222222-2222-4222-8222-222222222222",
      ]);
      expect(mismatch).toMatchObject({
        exitCode: 78,
        value: { reasons: [{ code: "PURGE_CONFIRMATION_MISMATCH" }] },
      });
      expect(
        await jsonCommand([
          "--cwd",
          fixture.root,
          "state",
          "purge",
          "--confirm",
          "11111111-1111-4111-8111-111111111111",
        ]),
      ).toMatchObject({ exitCode: 0, value: { ok: true } });
    } finally {
      if (previous.state === undefined) delete process.env.MILL_STATE_HOME;
      else process.env.MILL_STATE_HOME = previous.state;
      if (previous.codex === undefined) delete process.env.MILL_CODEX_PATH;
      else process.env.MILL_CODEX_PATH = previous.codex;
      if (previous.docker === undefined) delete process.env.MILL_DOCKER_PATH;
      else process.env.MILL_DOCKER_PATH = previous.docker;
      await fixture.cleanup();
    }
  });
});
