import path from "node:path";

import { Command, CommanderError, InvalidArgumentError } from "commander";
import { parse as parseYaml } from "yaml";

import { findRepositoryRoot, enforceExactVersion } from "./config/lock.js";
import { contractSchemas, type ContractKind } from "./contracts/schemas.js";
import { doctor, doctorReady, type DoctorMode } from "./doctor.js";
import { asMillError, ExitCode, MillError } from "./errors.js";
import { inspectPrd } from "./intake/prd.js";
import { scanRepository } from "./repository/scan.js";
import { commandResult, formatHuman, type CommandResult } from "./result.js";
import { safeReadText } from "./security/safe-path.js";
import { MILL_VERSION } from "./version.js";

export interface CliIo {
  stdout: { write(value: string): unknown };
  stderr: { write(value: string): unknown };
}

interface GlobalOptions {
  cwd: string;
  json?: boolean;
}

function parseMode(value: string): DoctorMode {
  if (value === "inspect" || value === "build" || value === "propose") {
    return value;
  }
  throw new InvalidArgumentError("mode must be inspect, build, or propose");
}

function emit(io: CliIo, json: boolean, result: CommandResult<unknown>): void {
  io.stdout.write(json ? `${JSON.stringify(result)}\n` : formatHuman(result));
}

function globals(program: Command): GlobalOptions {
  return program.opts<GlobalOptions>();
}

export function createProgram(io: CliIo): Command {
  const program = new Command();
  program
    .name("millctl")
    .description("Local-first, repo-native software delivery")
    .version(MILL_VERSION)
    .option("--json", "emit a stable JSON result envelope")
    .option("--cwd <path>", "repository or directory to inspect", process.cwd())
    .exitOverride()
    .configureOutput({
      writeOut: (value) => io.stdout.write(value),
      writeErr: (value) => io.stderr.write(value),
    });

  program
    .command("doctor")
    .description(
      "report host and repository readiness without running repository code",
    )
    .option("--mode <mode>", "readiness target", parseMode, "inspect")
    .action(async (options: { mode: DoctorMode }) => {
      const global = globals(program);
      const report = await doctor(global.cwd, options.mode);
      const ok = doctorReady(report);
      emit(
        io,
        global.json === true,
        commandResult({
          command: "doctor",
          ok,
          data: report,
          reasons: ok
            ? []
            : [
                {
                  code: "READINESS_BLOCKED",
                  message:
                    "One or more required runtime, tool, or lock checks failed.",
                },
              ],
        }),
      );
      if (!ok) {
        throw new MillError(
          "READINESS_BLOCKED",
          "Readiness checks failed.",
          ExitCode.unavailable,
          { resultAlreadyEmitted: true },
        );
      }
    });

  program
    .command("inspect")
    .description("inspect an untrusted PRD without executing it")
    .requiredOption("--prd <path>", "PRD path inside the selected root")
    .action(async (options: { prd: string }) => {
      const global = globals(program);
      const root = await findRepositoryRoot(global.cwd);
      await enforceExactVersion(root);
      const inspection = await inspectPrd(root, options.prd);
      emit(
        io,
        global.json === true,
        commandResult({ command: "inspect", ok: true, data: inspection }),
      );
    });

  program
    .command("adopt")
    .description(
      "inspect an existing repository without executing its commands",
    )
    .requiredOption("--scan-only", "perform only the static adoption scan")
    .action(async () => {
      const global = globals(program);
      const root = await findRepositoryRoot(global.cwd);
      await enforceExactVersion(root);
      const report = await scanRepository(root);
      const blocked = report.gitConfigHazards.length > 0;
      emit(
        io,
        global.json === true,
        commandResult({
          command: "adopt.scan",
          ok: !blocked,
          status: blocked ? "blocked" : "ok",
          data: report,
          reasons: blocked
            ? [
                {
                  code: "UNSAFE_GIT_CONFIGURATION",
                  message:
                    "Repository Git configuration requires human disposition.",
                },
              ]
            : [],
        }),
      );
      if (blocked) {
        throw new MillError(
          "UNSAFE_GIT_CONFIGURATION",
          "Repository Git configuration requires human disposition.",
          ExitCode.configuration,
          { resultAlreadyEmitted: true },
        );
      }
    });

  program
    .command("validate-contract")
    .description("validate one compact Mill YAML or JSON contract")
    .requiredOption("--kind <kind>", "contract kind")
    .requiredOption("--file <path>", "contract path inside the selected root")
    .action(async (options: { kind: string; file: string }) => {
      const global = globals(program);
      const root = await findRepositoryRoot(global.cwd);
      await enforceExactVersion(root);
      if (!(options.kind in contractSchemas)) {
        throw new MillError(
          "UNKNOWN_CONTRACT_KIND",
          `Unknown contract kind: ${options.kind}`,
          ExitCode.usage,
          { supported: Object.keys(contractSchemas) },
        );
      }
      const source = await safeReadText(root, options.file);
      const extension = path.extname(options.file).toLowerCase();
      const raw: unknown =
        extension === ".json" ? JSON.parse(source) : parseYaml(source);
      const parsed =
        contractSchemas[options.kind as ContractKind].safeParse(raw);
      if (!parsed.success) {
        throw new MillError(
          "INVALID_CONTRACT",
          "Contract validation failed.",
          ExitCode.data,
          { issues: parsed.error.issues },
        );
      }
      emit(
        io,
        global.json === true,
        commandResult({
          command: "validate-contract",
          ok: true,
          data: { kind: options.kind, file: options.file },
        }),
      );
    });

  return program;
}

export async function runCli(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const program = createProgram(io);
  try {
    await program.parseAsync(argv, { from: "user" });
    return ExitCode.ok;
  } catch (error) {
    if (error instanceof CommanderError) {
      if (
        error.code === "commander.version" ||
        error.code === "commander.helpDisplayed"
      ) {
        return ExitCode.ok;
      }
      return ExitCode.usage;
    }
    const millError = asMillError(error);
    if (millError.details.resultAlreadyEmitted !== true) {
      const global = program.opts<GlobalOptions>();
      const result = commandResult({
        command: program.args[0] ?? "millctl",
        ok: false,
        status: "error",
        data: {},
        reasons: [
          {
            code: millError.code,
            message: millError.message,
            details: millError.details,
          },
        ],
      });
      emit(io, global.json === true, result);
    }
    return millError.exitCode;
  }
}
