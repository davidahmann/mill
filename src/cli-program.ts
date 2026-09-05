import path from "node:path";

import { Command, CommanderError, InvalidArgumentError } from "commander";
import { parse as parseYaml } from "yaml";

import { auditRepository } from "./audit/repository.js";
import { findRepositoryRoot, enforceExactVersion } from "./config/lock.js";
import { contractSchemas, type ContractKind } from "./contracts/schemas.js";
import { doctor, doctorReady, type DoctorMode } from "./doctor.js";
import { asMillError, ExitCode, MillError } from "./errors.js";
import { inspectPrd } from "./intake/prd.js";
import { scanRepository } from "./repository/scan.js";
import { discoverRepository } from "./repository/intelligence.js";
import {
  applyAdoptionIntegration,
  applyGreenfieldIntegration,
  planAdoptionIntegration,
  planDetach,
  planGreenfieldIntegration,
} from "./repository/integration.js";
import {
  assessSpecificationProposal,
  loadPlanningSources,
  loadSpecificationProposal,
  promoteSpecificationProposal,
  semanticProposalDiff,
} from "./planning/specification.js";
import {
  assessImpactManifest,
  loadImpactPlanningInputs,
} from "./planning/impact.js";
import { loadPublicAlphaQualification } from "./qualification/public-alpha.js";
import {
  finalizeDraftPr,
  observeDraftPr,
  openDraftPr,
  planDraftPr,
  reconcileDraftPr,
} from "./runtime/delivery.js";
import {
  cancelRun,
  codexAuthStatus,
  qualifyBaseline,
  resumeRun,
  reviewRun,
  runStatus,
  startLocalRun,
  stateBackup,
  statePurge,
  stateRestore,
  supportBundle,
  verifyRun,
} from "./runtime/lifecycle.js";
import { commandResult, formatHuman, type CommandResult } from "./result.js";
import { safeReadText } from "./security/safe-path.js";
import { MILL_VERSION } from "./version.js";
import { applyMerge, planMerge, reconcileMerge } from "./runtime/merge.js";
import {
  abandonAuthorityPlan,
  reconcileAuthorityPlans,
} from "./runtime/authority-plans.js";
import { planOutcomeClosure } from "./planning/closure.js";
import { compileChangeTasks, applyChangeTasks } from "./planning/tasks.js";
import {
  planNativeAdoption,
  applyNativeAdoption,
} from "./repository/native-adoption.js";
import {
  prepareRepositoryDependencies,
  startNextReadyOutcome,
  startFounderDelivery,
} from "./workflows/founder.js";

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

function requiredValue(value: string | undefined, option: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new MillError(
      "USAGE_ERROR",
      `${option} is required for this operation.`,
      ExitCode.usage,
    );
  }
  return value;
}

interface IntegrationCliOptions {
  prd?: string;
  sources?: string;
  proposal?: string;
  approveProduct?: string;
  approvePlan?: string;
  repositoryId?: string;
  approvedBy?: string;
  approvedAt?: string;
  authorName?: string;
  authorEmail?: string;
  attended?: boolean;
}

function integrationOptions(
  root: string,
  options: IntegrationCliOptions,
): {
  sourceRoot: string;
  prdPath: string;
  sourceManifestPath: string;
  proposalPath: string;
  productApprovalDigest: string;
  repositoryId: string;
  approvedBy: string;
  approvedAt: string;
  authorName: string;
  authorEmail: string;
} {
  return {
    sourceRoot: root,
    prdPath: requiredValue(options.prd, "--prd"),
    sourceManifestPath: requiredValue(options.sources, "--sources"),
    proposalPath: requiredValue(options.proposal, "--proposal"),
    productApprovalDigest: requiredValue(
      options.approveProduct,
      "--approve-product",
    ),
    repositoryId: requiredValue(options.repositoryId, "--repository-id"),
    approvedBy: requiredValue(options.approvedBy, "--approved-by"),
    approvedAt: requiredValue(options.approvedAt, "--approved-at"),
    authorName: requiredValue(options.authorName, "--author-name"),
    authorEmail: requiredValue(options.authorEmail, "--author-email"),
  };
}

export function createProgram(io: CliIo, jsonErrors = false): Command {
  const program = new Command();
  program
    .name("millctl")
    .description("Local-first, repo-native software delivery")
    .version(MILL_VERSION)
    .option("--json", "emit a stable JSON result envelope")
    .option("--cwd <path>", "repository or directory to inspect", process.cwd())
    .exitOverride()
    .configureOutput({
      writeOut: (value) => {
        if (!jsonErrors) {
          io.stdout.write(value);
        }
      },
      writeErr: (value) => {
        if (!jsonErrors) {
          io.stderr.write(value);
        }
      },
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
    .command("discover <repository>")
    .description(
      "derive bounded, read-only TypeScript repository evidence without executing repository code",
    )
    .option(
      "--changed <path...>",
      "relative source paths whose importer leads should be reported",
    )
    .action(async (repository: string, options: { changed?: string[] }) => {
      const global = globals(program);
      const report = await discoverRepository({
        root: path.resolve(global.cwd, repository),
        ...(options.changed === undefined
          ? {}
          : { changedPaths: options.changed }),
      });
      emit(
        io,
        global.json === true,
        commandResult({ command: "discover", ok: true, data: report }),
      );
    });

  program
    .command("new <directory>")
    .description("preview or transactionally create the supported web recipe")
    .option("--dry-run", "return the exact approved file plan without writes")
    .option("--apply", "apply the exact approved file plan")
    .option("--prd <path>", "PRD path inside the selected root")
    .option("--sources <path>", "source manifest path")
    .option("--proposal <path>", "approved specification proposal path")
    .option("--approve-product <digest>", "exact specification approval digest")
    .option("--approve-plan <digest>", "exact integration-plan approval digest")
    .option("--repository-id <uuid>", "new stable repository UUID")
    .option("--approved-by <identity>", "human integration approver")
    .option("--approved-at <time>", "exact ISO approval time")
    .option("--author-name <name>", "initial commit author name")
    .option("--author-email <email>", "initial commit author email")
    .option("--attended", "approve disclosed registry and local Git effects")
    .action(
      async (
        directory: string,
        options: IntegrationCliOptions & { dryRun?: boolean; apply?: boolean },
      ) => {
        const global = globals(program);
        const root = await findRepositoryRoot(global.cwd);
        await enforceExactVersion(root);
        if (options.dryRun === options.apply) {
          throw new MillError(
            "USAGE_ERROR",
            "Choose exactly one of --dry-run or --apply.",
            ExitCode.usage,
          );
        }
        const common = {
          ...integrationOptions(root, options),
          targetDirectory: directory,
        };
        if (options.dryRun === true) {
          const planned = await planGreenfieldIntegration(common);
          emit(
            io,
            global.json === true,
            commandResult({
              command: "new.plan",
              ok: true,
              data: {
                plan: planned.plan,
                approvalDigest: planned.approvalDigest,
              },
            }),
          );
          return;
        }
        if (options.attended !== true) {
          throw new MillError(
            "ATTENDANCE_REQUIRED",
            "Greenfield apply requires attended registry and local Git authority.",
            ExitCode.configuration,
          );
        }
        const result = await applyGreenfieldIntegration({
          ...common,
          attended: true,
          planApprovalDigest: requiredValue(
            options.approvePlan,
            "--approve-plan",
          ),
        });
        emit(
          io,
          global.json === true,
          commandResult({ command: "new.apply", ok: true, data: result }),
        );
      },
    );

  program
    .command("adopt")
    .description(
      "scan, plan, or transactionally integrate an existing repository",
    )
    .option("--scan-only", "perform only the static adoption scan")
    .option("--plan", "return an exact adoption file plan")
    .option("--apply", "apply an approved plan in an isolated branch")
    .option("--prd <path>", "repo-native PRD path")
    .option("--sources <path>", "source manifest path")
    .option("--proposal <path>", "approved specification proposal path")
    .option("--approve-product <digest>", "exact specification approval digest")
    .option("--approve-plan <digest>", "exact integration-plan approval digest")
    .option("--repository-id <uuid>", "new stable repository UUID")
    .option("--approved-by <identity>", "human integration approver")
    .option("--approved-at <time>", "exact ISO approval time")
    .option("--author-name <name>", "adoption commit author name")
    .option("--author-email <email>", "adoption commit author email")
    .option("--attended", "approve isolated local branch creation")
    .action(
      async (
        options: IntegrationCliOptions & {
          scanOnly?: boolean;
          plan?: boolean;
          apply?: boolean;
        },
      ) => {
        const global = globals(program);
        const root = await findRepositoryRoot(global.cwd);
        await enforceExactVersion(root);
        const selected = [options.scanOnly, options.plan, options.apply].filter(
          (value) => value === true,
        ).length;
        if (selected !== 1) {
          throw new MillError(
            "USAGE_ERROR",
            "Choose exactly one of --scan-only, --plan, or --apply.",
            ExitCode.usage,
          );
        }
        if (options.plan === true || options.apply === true) {
          const common = {
            ...integrationOptions(root, options),
            repositoryRoot: root,
          };
          if (options.plan === true) {
            const planned = await planAdoptionIntegration(common);
            emit(
              io,
              global.json === true,
              commandResult({
                command: "adopt.plan",
                ok: true,
                data: {
                  plan: planned.plan,
                  approvalDigest: planned.approvalDigest,
                },
              }),
            );
            return;
          }
          if (options.attended !== true) {
            throw new MillError(
              "ATTENDANCE_REQUIRED",
              "Adoption apply requires attended local branch authority.",
              ExitCode.configuration,
            );
          }
          const result = await applyAdoptionIntegration({
            ...common,
            attended: true,
            planApprovalDigest: requiredValue(
              options.approvePlan,
              "--approve-plan",
            ),
          });
          emit(
            io,
            global.json === true,
            commandResult({ command: "adopt.apply", ok: true, data: result }),
          );
          return;
        }
        const report = await scanRepository(root);
        const blocked =
          report.gitConfigHazards.length > 0 ||
          report.truncatedDirectories.length > 0 ||
          report.symlinksSkipped.length > 0 ||
          report.secretReferences.length > 0;
        const reasons = [
          ...(report.gitConfigHazards.length > 0
            ? [
                {
                  code: "UNSAFE_GIT_CONFIGURATION",
                  message:
                    "Repository Git configuration requires human disposition.",
                },
              ]
            : []),
          ...(report.truncatedDirectories.length > 0
            ? [
                {
                  code: "SCAN_INCOMPLETE",
                  message:
                    "Repository scan reached its depth limit and is incomplete.",
                },
              ]
            : []),
          ...(report.symlinksSkipped.length > 0
            ? [
                {
                  code: "SYMLINKS_UNSUPPORTED",
                  message:
                    "Repository symbolic links require human disposition before adoption.",
                },
              ]
            : []),
          ...(report.secretReferences.length > 0
            ? [
                {
                  code: "SENSITIVE_PATHS_PRESENT",
                  message:
                    "Repository credential-like files require human disposition before adoption.",
                },
              ]
            : []),
        ];
        emit(
          io,
          global.json === true,
          commandResult({
            command: "adopt.scan",
            ok: !blocked,
            status: blocked ? "blocked" : "ok",
            data: report,
            reasons,
          }),
        );
        if (blocked) {
          throw new MillError(
            reasons[0]?.code ?? "SCAN_INCOMPLETE",
            reasons[0]?.message ?? "Repository scan is incomplete.",
            ExitCode.configuration,
            { resultAlreadyEmitted: true },
          );
        }
      },
    );

  const dependencies = program
    .command("dependencies")
    .description("manage exact local verifier dependency snapshots");
  program
    .command("adopt-native")
    .description(
      "experimentally adopt existing Node ESM/npm native tests without replacing source or oracles",
    )
    .requiredOption(
      "--config <path>",
      "proposed build-only OCI configuration in the repository",
    )
    .option("--apply", "create new Mill controls in an isolated worktree")
    .option("--approve <digest>", "exact native adoption plan digest")
    .option("--attended", "the operator approves this exact adoption")
    .action(
      async (options: {
        config: string;
        apply?: boolean;
        approve?: string;
        attended?: boolean;
      }) => {
        const global = globals(program);
        const root = await findRepositoryRoot(global.cwd);
        const data =
          options.apply === true
            ? await applyNativeAdoption({
                root,
                configPath: options.config,
                approvalDigest: requiredValue(options.approve, "--approve"),
                attended: options.attended === true,
              })
            : await planNativeAdoption({ root, configPath: options.config });
        emit(
          io,
          global.json === true,
          commandResult({
            command:
              options.apply === true
                ? "adopt-native.apply"
                : "adopt-native.plan",
            ok: true,
            data,
          }),
        );
      },
    );
  dependencies
    .command("prepare")
    .description("prepare one lock-bound snapshot through the exact OCI image")
    .requiredOption(
      "--attended",
      "approve disclosed npm registry network access",
    )
    .action(async () => {
      const global = globals(program);
      const root = await findRepositoryRoot(global.cwd);
      await enforceExactVersion(root);
      const result = await prepareRepositoryDependencies(root, true);
      emit(
        io,
        global.json === true,
        commandResult({
          command: "dependencies.prepare",
          ok: true,
          data: result ?? { configured: false },
        }),
      );
    });

  const detach = program
    .command("detach")
    .description("inspect manual Mill detachment");
  detach
    .command("plan")
    .description(
      "report Mill-only removals and downstream-owned retained files",
    )
    .action(async () => {
      const global = globals(program);
      const root = await findRepositoryRoot(global.cwd);
      await enforceExactVersion(root);
      emit(
        io,
        global.json === true,
        commandResult({
          command: "detach.plan",
          ok: true,
          data: await planDetach(root),
        }),
      );
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
      if (!Object.hasOwn(contractSchemas, options.kind)) {
        throw new MillError(
          "UNKNOWN_CONTRACT_KIND",
          `Unknown contract kind: ${options.kind}`,
          ExitCode.usage,
          { supported: Object.keys(contractSchemas) },
        );
      }
      const source = await safeReadText(root, options.file);
      const extension = path.extname(options.file).toLowerCase();
      let raw: unknown;
      try {
        raw = extension === ".json" ? JSON.parse(source) : parseYaml(source);
      } catch (error) {
        throw new MillError(
          "INVALID_CONTRACT",
          `Contract syntax is invalid: ${String(error)}`,
          ExitCode.data,
        );
      }
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

  const plan = program
    .command("plan")
    .description(
      "compile and assess product-continuity authority without writes",
    );
  plan
    .command("close-outcome")
    .description("propose plan closure from an exact provider-finalized run")
    .requiredOption("--task <path>", "task packet path")
    .requiredOption("--run <id>", "finalized run identity")
    .option("--next <outcome-id>", "one already approved successor")
    .action(async (options: { task: string; run: string; next?: string }) => {
      const global = globals(program);
      const root = await findRepositoryRoot(global.cwd);
      await enforceExactVersion(root);
      const data = await planOutcomeClosure({
        root,
        taskPath: options.task,
        runId: options.run,
        ...(options.next === undefined ? {} : { nextOutcomeId: options.next }),
      });
      emit(
        io,
        global.json === true,
        commandResult({ command: "plan.close-outcome", ok: true, data }),
      );
    });
  plan
    .command("tasks")
    .description(
      "compile a source-backed PRD, follow-up plan, bug or review into version-2 tasks",
    )
    .requiredOption(
      "--request <path>",
      "change request with approved outcome and impact references",
    )
    .option("--apply", "write the approved files in a new disposable worktree")
    .option("--approve <digest>", "exact compilation approval digest")
    .option("--attended", "the operator approves the compiled authority files")
    .action(
      async (options: {
        request: string;
        apply?: boolean;
        approve?: string;
        attended?: boolean;
      }) => {
        const global = globals(program);
        const root = await findRepositoryRoot(global.cwd);
        await enforceExactVersion(root);
        const data =
          options.apply === true
            ? await applyChangeTasks({
                root,
                requestPath: options.request,
                approvalDigest: requiredValue(options.approve, "--approve"),
                attended: options.attended === true,
              })
            : await compileChangeTasks({ root, requestPath: options.request });
        emit(
          io,
          global.json === true,
          commandResult({
            command: options.apply === true ? "plan.tasks.apply" : "plan.tasks",
            ok: true,
            data,
          }),
        );
      },
    );
  plan
    .command("specification")
    .description(
      "assess one source-backed product proposal and approval digest",
    )
    .requiredOption("--prd <path>", "PRD path inside the selected root")
    .requiredOption(
      "--sources <path>",
      "source manifest path inside the selected root",
    )
    .requiredOption("--proposal <path>", "specification proposal path")
    .action(
      async (options: { prd: string; sources: string; proposal: string }) => {
        const global = globals(program);
        const root = await findRepositoryRoot(global.cwd);
        await enforceExactVersion(root);
        const [planning, proposal] = await Promise.all([
          loadPlanningSources({
            root,
            prdPath: options.prd,
            sourceManifestPath: options.sources,
          }),
          loadSpecificationProposal(root, options.proposal),
        ]);
        const assessment = assessSpecificationProposal({
          proposal,
          prdPath: planning.prdPath,
          prdDigest: planning.prdDigest,
          sourceManifest: planning.sourceManifest,
          sourceManifestDigest: planning.sourceManifestDigest,
        });
        emit(
          io,
          global.json === true,
          commandResult({
            command: "plan.specification",
            ok: assessment.promotable,
            status: assessment.promotable ? "ok" : "blocked",
            data: assessment,
            reasons: assessment.blockers.map((message) => ({
              code: "SPECIFICATION_PROMOTION_BLOCKED",
              message,
            })),
          }),
        );
        if (!assessment.promotable) {
          throw new MillError(
            "SPECIFICATION_PROMOTION_BLOCKED",
            "The specification proposal is not promotable.",
            ExitCode.configuration,
            { resultAlreadyEmitted: true },
          );
        }
      },
    );
  plan
    .command("promote")
    .description(
      "return exact frozen artifacts for one explicitly approved proposal",
    )
    .requiredOption("--prd <path>", "PRD path inside the selected root")
    .requiredOption("--sources <path>", "source manifest path")
    .requiredOption("--proposal <path>", "specification proposal path")
    .requiredOption("--approve <digest>", "exact proposal digest")
    .action(
      async (options: {
        prd: string;
        sources: string;
        proposal: string;
        approve: string;
      }) => {
        const global = globals(program);
        const root = await findRepositoryRoot(global.cwd);
        await enforceExactVersion(root);
        const [planning, proposal] = await Promise.all([
          loadPlanningSources({
            root,
            prdPath: options.prd,
            sourceManifestPath: options.sources,
          }),
          loadSpecificationProposal(root, options.proposal),
        ]);
        const assessment = assessSpecificationProposal({
          proposal,
          prdPath: planning.prdPath,
          prdDigest: planning.prdDigest,
          sourceManifest: planning.sourceManifest,
          sourceManifestDigest: planning.sourceManifestDigest,
        });
        const promoted = promoteSpecificationProposal({
          proposal,
          approvalDigest: options.approve,
          assessment,
        });
        emit(
          io,
          global.json === true,
          commandResult({
            command: "plan.promote",
            ok: true,
            data: promoted,
          }),
        );
      },
    );
  plan
    .command("diff")
    .description("compare a regenerated proposal without replacing approval")
    .requiredOption("--approved <path>", "approved proposal path")
    .requiredOption("--proposal <path>", "regenerated proposal path")
    .action(async (options: { approved: string; proposal: string }) => {
      const global = globals(program);
      const root = await findRepositoryRoot(global.cwd);
      await enforceExactVersion(root);
      const [approved, proposal] = await Promise.all([
        loadSpecificationProposal(root, options.approved),
        loadSpecificationProposal(root, options.proposal),
      ]);
      emit(
        io,
        global.json === true,
        commandResult({
          command: "plan.diff",
          ok: true,
          data: { changedPaths: semanticProposalDiff(approved, proposal) },
        }),
      );
    });
  plan
    .command("impact")
    .description("assess one exact approved JIT impact manifest")
    .requiredOption("--product <path>", "product contract path")
    .requiredOption("--scenarios <path>", "scenario set path")
    .requiredOption("--manifest <path>", "impact manifest path")
    .action(
      async (options: {
        product: string;
        scenarios: string;
        manifest: string;
      }) => {
        const global = globals(program);
        const root = await findRepositoryRoot(global.cwd);
        await enforceExactVersion(root);
        const inputs = await loadImpactPlanningInputs({
          root,
          productPath: options.product,
          scenarioPath: options.scenarios,
          impactPath: options.manifest,
        });
        const assessment = assessImpactManifest(inputs);
        emit(
          io,
          global.json === true,
          commandResult({
            command: "plan.impact",
            ok: assessment.approved,
            status: assessment.approved ? "ok" : "blocked",
            data: assessment,
            reasons: assessment.blockers.map((message) => ({
              code: "IMPACT_PROMOTION_BLOCKED",
              message,
            })),
          }),
        );
        if (!assessment.approved) {
          throw new MillError(
            "IMPACT_PROMOTION_BLOCKED",
            "The impact manifest is not approved for execution.",
            ExitCode.configuration,
            { resultAlreadyEmitted: true },
          );
        }
      },
    );

  const auth = program
    .command("auth")
    .description("inspect adapter authentication readiness");
  auth
    .command("status")
    .description("report operator-owned Codex authentication readiness")
    .action(async () => {
      const global = globals(program);
      const root = await findRepositoryRoot(global.cwd);
      await enforceExactVersion(root);
      const status = await codexAuthStatus(root);
      emit(
        io,
        global.json === true,
        commandResult({
          command: "auth.status",
          ok: status.available,
          data: status,
        }),
      );
      if (!status.available) {
        throw new MillError(
          "CODEX_AUTH_UNAVAILABLE",
          "The operator's Codex CLI is not logged in.",
          ExitCode.unavailable,
          { resultAlreadyEmitted: true },
        );
      }
    });

  const qualify = program
    .command("qualify")
    .description(
      "qualify declared commands in a disposable exact-base worktree",
    )
    .option("--baseline", "qualify the pre-change base")
    .option("--task <path>", "approved task packet path")
    .action(async (options: { baseline?: boolean; task?: string }) => {
      const global = globals(program);
      const root = await findRepositoryRoot(global.cwd);
      await enforceExactVersion(root);
      if (options.baseline !== true) {
        throw new MillError(
          "USAGE_ERROR",
          "Baseline qualification requires --baseline.",
          ExitCode.usage,
        );
      }
      const result = await qualifyBaseline({
        root,
        taskPath: requiredValue(options.task, "--task"),
      });
      const { evidence } = result;
      emit(
        io,
        global.json === true,
        commandResult({
          command: "qualify.baseline",
          ok: evidence.passed,
          status: evidence.passed ? "ok" : "blocked",
          data: result,
          reasons: evidence.passed
            ? []
            : [
                {
                  code: "BASELINE_QUALIFICATION_FAILED",
                  message: "A required baseline command failed or was blocked.",
                },
              ],
        }),
      );
      if (!evidence.passed) {
        throw new MillError(
          "BASELINE_QUALIFICATION_FAILED",
          "A required baseline command failed or was blocked.",
          ExitCode.configuration,
          { resultAlreadyEmitted: true },
        );
      }
    });
  qualify
    .command("public-alpha")
    .description(
      "assess one exact longitudinal and clean-room qualification record",
    )
    .requiredOption("--file <path>", "qualification record path")
    .action(async (options: { file: string }) => {
      const global = globals(program);
      const root = await findRepositoryRoot(global.cwd);
      await enforceExactVersion(root);
      const assessment = await loadPublicAlphaQualification({
        root,
        file: options.file,
      });
      emit(
        io,
        global.json === true,
        commandResult({
          command: "qualify.public-alpha",
          ok: assessment.passed,
          status: assessment.passed ? "ok" : "blocked",
          data: assessment,
          reasons: assessment.blockers.map((message) => ({
            code: "PUBLIC_ALPHA_QUALIFICATION_BLOCKED",
            message,
          })),
        }),
      );
      if (!assessment.passed) {
        throw new MillError(
          "PUBLIC_ALPHA_QUALIFICATION_BLOCKED",
          "The public-alpha qualification record is not promotable.",
          ExitCode.configuration,
          { resultAlreadyEmitted: true },
        );
      }
    });

  program
    .command("audit")
    .description("run the bounded read-only public-alpha repository audit")
    .action(async () => {
      const global = globals(program);
      const root = await findRepositoryRoot(global.cwd);
      await enforceExactVersion(root);
      const report = await auditRepository({ root });
      const ok = report.status === "passed";
      emit(
        io,
        global.json === true,
        commandResult({
          command: "audit",
          ok,
          status: ok ? "ok" : "blocked",
          data: report,
          reasons: report.checks
            .filter((check) => check.status === "blocked")
            .map((check) => ({
              code: "AUDIT_CHECK_BLOCKED",
              message: check.summary,
              details: { category: check.category, checkId: check.id },
            })),
        }),
      );
      if (!ok) {
        throw new MillError(
          "AUDIT_BLOCKED",
          "One or more bounded audit categories are blocked.",
          ExitCode.configuration,
          { resultAlreadyEmitted: true },
        );
      }
    });

  const run = program
    .command("run")
    .description(
      "build one explicitly approved task in an isolated local worktree",
    )
    .option("--task <path>", "approved task packet path")
    .option(
      "--approve <digest>",
      "approval digest from successful matching baseline qualification",
    )
    .option("--attended", "acknowledge attended trusted-host Codex execution")
    .action(
      async (options: {
        task?: string;
        approve?: string;
        attended?: boolean;
      }) => {
        const global = globals(program);
        const root = await findRepositoryRoot(global.cwd);
        await enforceExactVersion(root);
        if (options.attended !== true) {
          throw new MillError(
            "ATTENDANCE_REQUIRED",
            "Run requires attended trusted-host Codex authority.",
            ExitCode.configuration,
          );
        }
        const result = await startLocalRun({
          root,
          taskPath: requiredValue(options.task, "--task"),
          approvalDigest: requiredValue(options.approve, "--approve"),
        });
        emit(
          io,
          global.json === true,
          commandResult({ command: "run", ok: true, data: result }),
        );
      },
    );
  run
    .command("next")
    .description(
      "run the one ready approved outcome through the existing lifecycle",
    )
    .requiredOption(
      "--approve <digest>",
      "approval digest from successful matching baseline qualification",
    )
    .requiredOption("--attended", "acknowledge attended trusted-host execution")
    .action(async (options: { approve: string }) => {
      const global = globals(program);
      const root = await findRepositoryRoot(global.cwd);
      await enforceExactVersion(root);
      const started = await startNextReadyOutcome({
        root,
        approvalDigest: options.approve,
      });
      emit(
        io,
        global.json === true,
        commandResult({
          command: "run.next",
          ok: true,
          data: { outcome: started.outcome, ...started.result },
        }),
      );
    });

  program
    .command("start")
    .description(
      "advance the one ready outcome through the resumable founder path",
    )
    .requiredOption("--prd <path>", "approved repo-native PRD path")
    .option("--repo <path>", "managed repository path")
    .option(
      "--draft-pr",
      "prepare the later exact reviewed candidate's draft-PR plan",
    )
    .requiredOption(
      "--attended",
      "approve attended dependency, model, and scoped forge use",
    )
    .action(
      async (options: { prd: string; repo?: string; draftPr?: boolean }) => {
        const global = globals(program);
        const root = await findRepositoryRoot(options.repo ?? global.cwd);
        await enforceExactVersion(root);
        const inspectedPrd = path
          .normalize(options.prd)
          .split(path.sep)
          .join("/");
        await safeReadText(root, inspectedPrd, 2 * 1024 * 1024);
        const result = await startFounderDelivery({
          root,
          prdPath: inspectedPrd,
          attended: true,
          draftPr: options.draftPr === true,
        });
        emit(
          io,
          global.json === true,
          commandResult({ command: "start", ok: true, data: result }),
        );
      },
    );

  program
    .command("status")
    .description("report durable local run state")
    .option("--run <id>", "run identifier")
    .action(async (options: { run?: string }) => {
      const global = globals(program);
      const root = await findRepositoryRoot(global.cwd);
      await enforceExactVersion(root);
      const data = await runStatus({
        root,
        ...(options.run === undefined ? {} : { runId: options.run }),
      });
      emit(
        io,
        global.json === true,
        commandResult({ command: "status", ok: true, data }),
      );
    });

  program
    .command("verify")
    .description(
      "validate an exact committed candidate through declared commands",
    )
    .requiredOption("--task <path>", "approved task packet path")
    .requiredOption("--run <id>", "run identifier")
    .action(async (options: { task: string; run: string }) => {
      const global = globals(program);
      const root = await findRepositoryRoot(global.cwd);
      await enforceExactVersion(root);
      const result = await verifyRun({
        root,
        taskPath: options.task,
        runId: options.run,
      });
      emit(
        io,
        global.json === true,
        commandResult({
          command: "verify",
          ok: result.evidence.passed,
          status: result.evidence.passed ? "ok" : "blocked",
          data: result,
          reasons: result.evidence.passed
            ? []
            : [
                {
                  code: "VALIDATION_FAILED",
                  message: "A required command failed or was blocked.",
                },
              ],
        }),
      );
      if (!result.evidence.passed) {
        throw new MillError(
          "VALIDATION_FAILED",
          "A required command failed or was blocked.",
          ExitCode.configuration,
          { resultAlreadyEmitted: true },
        );
      }
    });

  program
    .command("review")
    .description(
      "obtain a fresh read-only review of the exact verified candidate",
    )
    .requiredOption("--task <path>", "approved task packet path")
    .requiredOption("--run <id>", "run identifier")
    .option("--refresh", "refresh stale scope before any remote attempt")
    .option(
      "--base <commit>",
      "exact locally available provider-base commit for refresh",
    )
    .option("--attended", "confirm attended review-scope selection")
    .action(
      async (options: {
        task: string;
        run: string;
        refresh?: boolean;
        base?: string;
        attended?: boolean;
      }) => {
        const global = globals(program);
        const root = await findRepositoryRoot(global.cwd);
        await enforceExactVersion(root);
        const result = await reviewRun({
          root,
          taskPath: options.task,
          runId: options.run,
          ...(options.refresh === undefined
            ? {}
            : { refresh: options.refresh }),
          ...(options.base === undefined ? {} : { baseCommit: options.base }),
          ...(options.attended === undefined
            ? {}
            : { attended: options.attended }),
        });
        const ok = result.review.findings.length === 0;
        emit(
          io,
          global.json === true,
          commandResult({
            command: "review",
            ok,
            status: ok ? "ok" : "blocked",
            data: result,
            reasons: ok
              ? []
              : [
                  {
                    code: result.run.blockCode ?? "REVIEW_FINDINGS",
                    message:
                      "The exact-candidate review reported actionable findings.",
                  },
                ],
          }),
        );
        if (!ok) {
          throw new MillError(
            result.run.blockCode ?? "REVIEW_FINDINGS",
            "The exact-candidate review reported actionable findings.",
            ExitCode.configuration,
            { resultAlreadyEmitted: true },
          );
        }
      },
    );

  program
    .command("resume")
    .description("resume one safe blocked checkpoint within its retry budget")
    .requiredOption("--task <path>", "approved task packet path")
    .requiredOption("--run <id>", "run identifier")
    .action(async (options: { task: string; run: string }) => {
      const global = globals(program);
      const root = await findRepositoryRoot(global.cwd);
      await enforceExactVersion(root);
      const run = await resumeRun({
        root,
        taskPath: options.task,
        runId: options.run,
      });
      emit(
        io,
        global.json === true,
        commandResult({ command: "resume", ok: true, data: { run } }),
      );
    });

  const pr = program
    .command("pr")
    .description("deliver an exact reviewed candidate through a draft PR");
  pr.command("merge-plan")
    .description(
      "plan a distinct human-approved merge, including readiness when needed",
    )
    .requiredOption("--task <path>", "approved task packet path")
    .requiredOption("--run <id>", "run identifier")
    .option("--method <method>", "squash or merge", "squash")
    .action(async (options: { task: string; run: string; method: string }) => {
      if (options.method !== "squash" && options.method !== "merge")
        throw new MillError(
          "MERGE_METHOD_INVALID",
          "Choose squash or merge.",
          ExitCode.usage,
        );
      const global = globals(program);
      const root = await findRepositoryRoot(global.cwd);
      await enforceExactVersion(root);
      const data = await planMerge({
        root,
        taskPath: options.task,
        runId: options.run,
        method: options.method,
      });
      emit(
        io,
        global.json === true,
        commandResult({ command: "pr.merge-plan", ok: true, data }),
      );
    });
  pr.command("merge")
    .description(
      "apply an exact merge plan at the trusted attended operator boundary",
    )
    .requiredOption("--task <path>", "approved task packet path")
    .requiredOption("--run <id>", "run identifier")
    .requiredOption("--approve <digest>", "exact displayed merge-plan digest")
    .requiredOption("--attended", "operator has approved this exact plan")
    .action(
      async (options: {
        task: string;
        run: string;
        approve: string;
        attended: boolean;
      }) => {
        const global = globals(program);
        const root = await findRepositoryRoot(global.cwd);
        await enforceExactVersion(root);
        const data = await applyMerge({
          root,
          taskPath: options.task,
          runId: options.run,
          approvalDigest: options.approve,
          attended: options.attended,
        });
        emit(
          io,
          global.json === true,
          commandResult({ command: "pr.merge", ok: true, data }),
        );
      },
    );
  pr.command("merge-reconcile")
    .description("read back a possibly started merge without retrying it")
    .requiredOption("--task <path>", "approved task packet path")
    .requiredOption("--run <id>", "run identifier")
    .action(async (options: { task: string; run: string }) => {
      const global = globals(program);
      const root = await findRepositoryRoot(global.cwd);
      await enforceExactVersion(root);
      const data = await reconcileMerge({
        root,
        taskPath: options.task,
        runId: options.run,
      });
      emit(
        io,
        global.json === true,
        commandResult({
          command: "pr.merge-reconcile",
          ok: data.state === "merged",
          status: data.state === "merged" ? "ok" : "blocked",
          data,
        }),
      );
    });
  pr.command("plan")
    .description("read live GitHub identity and create a local approval plan")
    .requiredOption("--task <path>", "approved task packet path")
    .requiredOption("--run <id>", "run identifier")
    .action(async (options: { task: string; run: string }) => {
      const global = globals(program);
      const root = await findRepositoryRoot(global.cwd);
      await enforceExactVersion(root);
      const result = await planDraftPr({
        root,
        taskPath: options.task,
        runId: options.run,
      });
      emit(
        io,
        global.json === true,
        commandResult({ command: "pr.plan", ok: true, data: result }),
      );
    });
  pr.command("open")
    .description("push and open the explicitly approved draft PR")
    .requiredOption("--task <path>", "approved task packet path")
    .requiredOption("--run <id>", "run identifier")
    .requiredOption(
      "--approve <digest>",
      "exact, unexpired proposal digest returned by pr plan",
    )
    .requiredOption(
      "--attended",
      "acknowledge attended use of the operator-owned GitHub session",
    )
    .action(
      async (options: {
        task: string;
        run: string;
        approve: string;
        attended: boolean;
      }) => {
        const global = globals(program);
        const root = await findRepositoryRoot(global.cwd);
        await enforceExactVersion(root);
        const result = await openDraftPr({
          root,
          taskPath: options.task,
          runId: options.run,
          approvalDigest: options.approve,
          attended: options.attended,
        });
        emit(
          io,
          global.json === true,
          commandResult({ command: "pr.open", ok: true, data: result }),
        );
      },
    );
  pr.command("reconcile")
    .description("classify one unknown GitHub effect through readback only")
    .requiredOption("--task <path>", "approved task packet path")
    .requiredOption("--run <id>", "run identifier")
    .action(async (options: { task: string; run: string }) => {
      const global = globals(program);
      const root = await findRepositoryRoot(global.cwd);
      await enforceExactVersion(root);
      const result = await reconcileDraftPr({
        root,
        taskPath: options.task,
        runId: options.run,
      });
      emit(
        io,
        global.json === true,
        commandResult({ command: "pr.reconcile", ok: true, data: result }),
      );
    });
  pr.command("observe")
    .description("read exact-head checks and configured GitHub review policy")
    .requiredOption("--task <path>", "approved task packet path")
    .requiredOption("--run <id>", "run identifier")
    .action(async (options: { task: string; run: string }) => {
      const global = globals(program);
      const root = await findRepositoryRoot(global.cwd);
      await enforceExactVersion(root);
      const result = await observeDraftPr({
        root,
        taskPath: options.task,
        runId: options.run,
      });
      const blocked = result.run.status === "blocked";
      emit(
        io,
        global.json === true,
        commandResult({
          command: "pr.observe",
          ok: !blocked,
          status: blocked ? "blocked" : "ok",
          data: result,
          reasons: blocked
            ? [
                {
                  code: result.run.blockCode ?? "REMOTE_POLICY_BLOCKED",
                  message:
                    "GitHub checks or configured review policy blocked this exact candidate.",
                },
              ]
            : [],
        }),
      );
      if (blocked) {
        throw new MillError(
          result.run.blockCode ?? "REMOTE_POLICY_BLOCKED",
          "GitHub policy blocked this exact candidate.",
          ExitCode.configuration,
          { resultAlreadyEmitted: true },
        );
      }
    });
  pr.command("finalize")
    .description("read back human merge and exact main checks before closure")
    .requiredOption("--task <path>", "approved task packet path")
    .requiredOption("--run <id>", "run identifier")
    .action(async (options: { task: string; run: string }) => {
      const global = globals(program);
      const root = await findRepositoryRoot(global.cwd);
      await enforceExactVersion(root);
      const result = await finalizeDraftPr({
        root,
        taskPath: options.task,
        runId: options.run,
      });
      const closed = result.run.status === "closed";
      const reasonCode =
        result.run.status === "blocked"
          ? (result.run.blockCode ?? "POST_MERGE_CHECKS_FAILED")
          : "POST_MERGE_CHECKS_PENDING";
      emit(
        io,
        global.json === true,
        commandResult({
          command: "pr.finalize",
          ok: closed,
          status: closed ? "ok" : "blocked",
          data: result,
          reasons: closed
            ? []
            : [
                {
                  code: reasonCode,
                  message:
                    "Post-merge required checks have not produced passing exact-commit evidence.",
                },
              ],
        }),
      );
      if (!closed) {
        throw new MillError(
          reasonCode,
          "Post-merge verification is not complete.",
          result.run.status === "blocked"
            ? ExitCode.configuration
            : ExitCode.temporary,
          { resultAlreadyEmitted: true },
        );
      }
    });

  program
    .command("ship")
    .description(
      "plan or open one draft PR through the existing delivery state machine",
    )
    .requiredOption("--draft", "limit shipping to one draft pull request")
    .requiredOption("--task <path>", "approved task packet path")
    .requiredOption("--run <id>", "reviewed run identifier")
    .option(
      "--approve <digest>",
      "exact unexpired digest returned by this wrapper",
    )
    .option("--attended", "acknowledge attended GitHub authority")
    .action(
      async (options: {
        task: string;
        run: string;
        approve?: string;
        attended?: boolean;
      }) => {
        const global = globals(program);
        const root = await findRepositoryRoot(global.cwd);
        await enforceExactVersion(root);
        if (options.approve === undefined) {
          const result = await planDraftPr({
            root,
            taskPath: options.task,
            runId: options.run,
          });
          emit(
            io,
            global.json === true,
            commandResult({
              command: "ship.draft.plan",
              ok: true,
              data: result,
            }),
          );
          return;
        }
        if (options.attended !== true) {
          throw new MillError(
            "ATTENDANCE_REQUIRED",
            "Draft shipping requires attended use of the operator-owned GitHub session.",
            ExitCode.configuration,
          );
        }
        const result = await openDraftPr({
          root,
          taskPath: options.task,
          runId: options.run,
          approvalDigest: options.approve,
          attended: true,
        });
        emit(
          io,
          global.json === true,
          commandResult({ command: "ship.draft.open", ok: true, data: result }),
        );
      },
    );

  program
    .command("cancel")
    .description("persist cancellation for the exact foreground controller")
    .requiredOption("--run <id>", "run identifier")
    .action(async (options: { run: string }) => {
      const global = globals(program);
      const root = await findRepositoryRoot(global.cwd);
      await enforceExactVersion(root);
      const run = await cancelRun({ root, runId: options.run });
      emit(
        io,
        global.json === true,
        commandResult({ command: "cancel", ok: true, data: { run } }),
      );
    });

  const state = program
    .command("state")
    .description("manage local operational state");
  state
    .command("reconcile-plans")
    .description("read back committed generated authority; never retry apply")
    .action(async () => {
      const global = globals(program);
      const root = await findRepositoryRoot(global.cwd);
      await enforceExactVersion(root);
      const data = await reconcileAuthorityPlans({ root });
      const ok = data.plans.every(
        (plan) => plan.state === "committed" || plan.state === "abandoned",
      );
      emit(
        io,
        global.json === true,
        commandResult({
          command: "state.reconcile-plans",
          ok,
          status: ok ? "ok" : "blocked",
          data,
        }),
      );
    });
  state
    .command("abandon-plan")
    .description(
      "abandon an exact failed plan while retaining its clean committed branch",
    )
    .requiredOption(
      "--approve <digest>",
      "original authority-plan approval digest",
    )
    .option("--attended", "confirm attended local disposition")
    .action(async (options: { approve: string; attended?: boolean }) => {
      const global = globals(program);
      const root = await findRepositoryRoot(global.cwd);
      await enforceExactVersion(root);
      const data = await abandonAuthorityPlan({
        root,
        approvalDigest: options.approve,
        attended: options.attended === true,
      });
      emit(
        io,
        global.json === true,
        commandResult({ command: "state.abandon-plan", ok: true, data }),
      );
    });
  state
    .command("backup")
    .description("create a user-only SQLite backup")
    .action(async () => {
      const global = globals(program);
      const root = await findRepositoryRoot(global.cwd);
      await enforceExactVersion(root);
      const backupPath = await stateBackup({ root });
      emit(
        io,
        global.json === true,
        commandResult({
          command: "state.backup",
          ok: true,
          data: { backupPath },
        }),
      );
    });
  state
    .command("restore")
    .description("restore one Mill-owned state backup")
    .requiredOption("--from <path>", "backup path returned by state backup")
    .action(async (options: { from: string }) => {
      const global = globals(program);
      const root = await findRepositoryRoot(global.cwd);
      await enforceExactVersion(root);
      const report = await stateRestore({ root, backupPath: options.from });
      emit(
        io,
        global.json === true,
        commandResult({ command: "state.restore", ok: true, data: report }),
      );
    });
  state
    .command("purge")
    .description("remove purge-safe local state and disposable worktrees")
    .requiredOption(
      "--confirm <repository-id>",
      "exact repository UUID acknowledgement",
    )
    .action(async (options: { confirm: string }) => {
      const global = globals(program);
      const root = await findRepositoryRoot(global.cwd);
      await enforceExactVersion(root);
      await statePurge({ root, confirmation: options.confirm });
      emit(
        io,
        global.json === true,
        commandResult({ command: "state.purge", ok: true, data: {} }),
      );
    });

  program
    .command("support-bundle")
    .description("emit a redacted static support bundle")
    .option("--run <id>", "run identifier")
    .action(async (options: { run?: string }) => {
      const global = globals(program);
      const root = await findRepositoryRoot(global.cwd);
      await enforceExactVersion(root);
      const data = await supportBundle({
        root,
        ...(options.run === undefined ? {} : { runId: options.run }),
      });
      emit(
        io,
        global.json === true,
        commandResult({ command: "support-bundle", ok: true, data }),
      );
    });

  return program;
}

export async function runCli(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const jsonRequested = argv.includes("--json");
  if (jsonRequested && (argv.includes("--version") || argv.includes("-V"))) {
    emit(
      io,
      true,
      commandResult({
        command: "version",
        ok: true,
        data: { version: MILL_VERSION },
      }),
    );
    return ExitCode.ok;
  }
  if (jsonRequested && (argv.includes("--help") || argv.includes("-h"))) {
    emit(
      io,
      true,
      commandResult({
        command: "millctl",
        ok: false,
        status: "error",
        data: {},
        reasons: [
          {
            code: "USAGE_ERROR",
            message: "JSON mode does not support help output; omit --json.",
          },
        ],
      }),
    );
    return ExitCode.usage;
  }
  const program = createProgram(io, jsonRequested);
  try {
    await program.parseAsync(argv, { from: "user" });
    return ExitCode.ok;
  } catch (error) {
    if (error instanceof CommanderError) {
      if (
        error.code === "commander.version" ||
        error.code === "commander.helpDisplayed" ||
        (!jsonRequested && error.code === "commander.help")
      ) {
        return ExitCode.ok;
      }
      if (jsonRequested) {
        emit(
          io,
          true,
          commandResult({
            command: program.args[0] ?? "millctl",
            ok: false,
            status: "error",
            data: {},
            reasons: [
              {
                code: "USAGE_ERROR",
                message: error.message,
                details: { commanderCode: error.code },
              },
            ],
          }),
        );
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
