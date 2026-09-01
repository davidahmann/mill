import { mkdir } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { temporaryDirectory } from "./helpers.js";

const finalizeDraftPr = vi.hoisted(() => vi.fn());

vi.mock("../src/runtime/delivery.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/runtime/delivery.js")>()),
  finalizeDraftPr,
}));

const { runCli } = await import("../src/cli-program.js");

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

describe("finalization CLI result", () => {
  it("never reports pending or failed post-merge evidence as success", async () => {
    const temporary = await temporaryDirectory("mill-finalize-cli-");
    try {
      await mkdir(path.join(temporary.path, ".git"));
      for (const [status, blockCode, exitCode, reasonCode] of [
        ["merged", undefined, 75, "POST_MERGE_CHECKS_PENDING"],
        ["blocked", "POST_MERGE_CHECKS_FAILED", 78, "POST_MERGE_CHECKS_FAILED"],
      ] as const) {
        finalizeDraftPr.mockResolvedValueOnce({
          run: {
            status,
            ...(blockCode === undefined ? {} : { blockCode }),
          },
          delivery: {},
        });
        const output = capture();
        expect(
          await runCli(
            [
              "--json",
              "--cwd",
              temporary.path,
              "pr",
              "finalize",
              "--task",
              "product/tasks/task.yaml",
              "--run",
              "123e4567-e89b-42d3-a456-426614174000",
            ],
            output.io,
          ),
        ).toBe(exitCode);
        expect(output.stderr).toEqual([]);
        expect(JSON.parse(output.stdout.join(""))).toMatchObject({
          command: "pr.finalize",
          ok: false,
          status: "blocked",
          reasons: [{ code: reasonCode }],
        });
      }
    } finally {
      await temporary.cleanup();
    }
  });
});
