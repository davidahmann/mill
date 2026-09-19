import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createProgram, runCli } from "../src/cli-program.js";
import { temporaryDirectory } from "./helpers.js";

const approval = `sha256:${"0".repeat(64)}`;
function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: { write: (value: string) => void stdout.push(value) },
      stderr: { write: (value: string) => void stderr.push(value) },
    },
  };
}

describe("nested command authority option routing", () => {
  it.each(["after-next", "before-next", "equals-and-trailing-globals"])(
    "routes run next approval and attendance to real safe admission: %s",
    async (placement) => {
      const temporary = await temporaryDirectory("mill-cli-next-");
      try {
        await mkdir(path.join(temporary.path, "product"));
        await writeFile(
          path.join(temporary.path, "product", "plan.yaml"),
          JSON.stringify({
            schemaVersion: "1",
            productContractDigest: approval,
            outcomes: [
              {
                id: "OUT-NOT-APPROVED",
                title: "Unapproved outcome",
                acceptance: ["An owner must approve work"],
                dependsOn: [],
                status: "proposed",
              },
            ],
          }),
        );
        const args =
          placement === "before-next"
            ? [
                "--json",
                "--cwd",
                temporary.path,
                "run",
                "--approve",
                approval,
                "--attended",
                "next",
              ]
            : placement === "equals-and-trailing-globals"
              ? [
                  "run",
                  "next",
                  `--approve=${approval}`,
                  "--attended",
                  "--json",
                  "--cwd",
                  temporary.path,
                ]
              : [
                  "--json",
                  "--cwd",
                  temporary.path,
                  "run",
                  "next",
                  "--approve",
                  approval,
                  "--attended",
                ];
        const output = capture();
        expect(await runCli(args, output.io)).toBe(78);
        expect(JSON.parse(output.stdout.join(""))).toMatchObject({
          ok: false,
          reasons: [{ code: "NO_READY_OUTCOME" }],
        });
        expect(output.stderr).toEqual([]);
        expect(await readdir(temporary.path)).toEqual(["product"]);
      } finally {
        await temporary.cleanup();
      }
    },
  );

  it.each([
    { args: ["--attended"], missing: "--approve" },
    { args: ["--approve", approval], missing: "--attended" },
  ])(
    "still requires explicit $missing before any admission",
    async ({ args, missing }) => {
      const output = capture();
      expect(await runCli(["--json", "run", "next", ...args], output.io)).toBe(
        64,
      );
      expect(JSON.parse(output.stdout.join(""))).toMatchObject({
        reasons: [
          {
            code: "USAGE_ERROR",
          },
        ],
      });
      expect(output.stdout.join("")).toContain(`required option '${missing}`);
    },
  );

  it.each([
    {
      args: ["--isolation", "isolated"],
      code: "BUILDER_ISOLATION_UNQUALIFIED",
      message: "will not silently fall back",
      exit: 78,
    },
    {
      args: ["--task", "product/tasks/other.yaml"],
      code: "USAGE_ERROR",
      message: "--task is only supported by run",
      exit: 64,
    },
  ])(
    "rejects incompatible next-run options: $code",
    async ({ args, code, message, exit }) => {
      const temporary = await temporaryDirectory("mill-cli-next-boundary-");
      try {
        const output = capture();
        expect(
          await runCli(
            [
              "--json",
              "--cwd",
              temporary.path,
              "run",
              "next",
              "--approve",
              approval,
              "--attended",
              ...args,
            ],
            output.io,
          ),
        ).toBe(exit);
        expect(JSON.parse(output.stdout.join(""))).toMatchObject({
          reasons: [{ code }],
        });
        expect(output.stdout.join("")).toContain(message);
        expect(await readdir(temporary.path)).toEqual([]);
      } finally {
        await temporary.cleanup();
      }
    },
  );

  it("preserves direct run and other command/global option placement", async () => {
    for (const args of [
      [
        "run",
        "--task",
        "task.yaml",
        "--approve",
        approval,
        "--attended",
        "--json",
        "--cwd",
        "/fixture",
      ],
      [
        "--json",
        "--cwd",
        "/fixture",
        "run",
        "--task",
        "task.yaml",
        "--approve",
        approval,
        "--attended",
      ],
    ]) {
      const program = createProgram(capture().io, true);
      const command = program.commands.find((item) => item.name() === "run");
      if (command === undefined) throw new Error("missing run command");
      const calls: unknown[] = [];
      command.action((options: unknown) => {
        calls.push(options);
      });
      await program.parseAsync(args, { from: "user" });
      expect(calls).toEqual([
        {
          task: "task.yaml",
          approve: approval,
          attended: true,
          isolation: "trusted-host",
        },
      ]);
      expect(program.opts()).toMatchObject({ json: true, cwd: "/fixture" });
    }
    const program = createProgram(capture().io, true);
    const command = program.commands
      .find((item) => item.name() === "qualify")
      ?.commands.find((item) => item.name() === "public-alpha");
    if (command === undefined) throw new Error("missing qualification command");
    const calls: unknown[] = [];
    command.action((options: unknown) => {
      calls.push(options);
    });
    await program.parseAsync(
      [
        "qualify",
        "public-alpha",
        "--file",
        "qualification.json",
        "--cwd",
        "/fixture",
        "--json",
      ],
      { from: "user" },
    );
    expect(calls).toEqual([{ file: "qualification.json" }]);
    expect(program.opts()).toMatchObject({ json: true, cwd: "/fixture" });
  });
});
