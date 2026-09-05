import { lstat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as yaml } from "yaml";
import { canonicalDigest, type JsonValue } from "../contracts/canonical.js";
import { millConfigSchema, millLockSchema } from "../contracts/schemas.js";
import { ExitCode, MillError } from "../errors.js";
import { textDigest } from "../runtime/inputs.js";
import {
  assertRepositoryWorktreeClean,
  commonGitDirectory,
  createCandidateWorktree,
  readCandidateIdentity,
} from "../runtime/repository.js";
import {
  acquireWriterLease,
  StateStore,
  isTerminalRun,
} from "../runtime/state.js";
import { safeReadText } from "../security/safe-path.js";
import { MILL_PACKAGE, MILL_VERSION } from "../version.js";
import { scanRepository } from "./scan.js";

/** Experimental Node/npm adoption preserves all native source and acceptance oracles. */
export async function planNativeAdoption(input: {
  root: string;
  configPath: string;
}) {
  await assertRepositoryWorktreeClean(input.root);
  const base = await readCandidateIdentity(input.root);
  const config = millConfigSchema.parse(
    parseYaml(await safeReadText(input.root, input.configPath)),
  );
  if (
    config.trustCeiling !== "build" ||
    config.propose !== undefined ||
    config.verifier?.dependencies?.manager !== "npm" ||
    !config.verifier.dependencies.lockPaths.includes("package-lock.json") ||
    !config.verifier.dependencies.lockPaths.includes("package.json")
  )
    throw new MillError(
      "NATIVE_ADOPTION_POLICY_INVALID",
      "Native adoption requires a build-only, OCI, npm-lock-bound configuration. Forge authority is a separate change.",
      ExitCode.configuration,
    );
  const scan = await scanRepository(input.root);
  if (
    scan.gitConfigHazards.length > 0 ||
    scan.secretReferences.length > 0 ||
    scan.symlinksSkipped.length > 0 ||
    scan.truncatedDirectories.length > 0
  )
    throw new MillError(
      "NATIVE_ADOPTION_UNSAFE",
      "Resolve Git, credential-path, symlink or incomplete-scan hazards before native adoption.",
      ExitCode.configuration,
    );
  const packageText = await safeReadText(input.root, "package.json");
  const lockText = await safeReadText(
    input.root,
    "package-lock.json",
    8 * 1024 * 1024,
  );
  const pkg = JSON.parse(packageText) as {
    scripts?: Record<string, unknown>;
    type?: unknown;
  };
  const lock = JSON.parse(lockText) as { lockfileVersion?: unknown };
  if (pkg.type !== "module" || lock.lockfileVersion !== 3)
    throw new MillError(
      "NATIVE_ADOPTION_STACK_UNSUPPORTED",
      "This experimental adapter requires Node ESM and npm lockfile version 3.",
      ExitCode.configuration,
    );
  const commands = Object.entries(config.commands);
  if (
    !commands.some(
      ([, command]) => command.required && command.capability === "test",
    )
  )
    throw new MillError(
      "NATIVE_ADOPTION_TEST_REQUIRED",
      "At least one required native test command is necessary.",
      ExitCode.configuration,
    );
  for (const [id, command] of commands) {
    const script = command.argv[2];
    if (
      command.execution !== "oci" ||
      command.cwd !== "." ||
      command.argv.length !== 3 ||
      command.argv[0] !== "/usr/local/bin/npm" ||
      command.argv[1] !== "run" ||
      script === undefined ||
      typeof pkg.scripts?.[script] !== "string" ||
      command.capability === "read" ||
      !command.controlPaths.includes("package.json") ||
      !command.controlPaths.includes("package-lock.json")
    )
      throw new MillError(
        "NATIVE_ADOPTION_COMMAND_UNSUPPORTED",
        "Commands must explicitly run existing root npm scripts in OCI and freeze their package and lock controls.",
        ExitCode.configuration,
        { commandId: id },
      );
  }
  for (const file of ["mill.yaml", "mill.lock"]) {
    try {
      await lstat(path.join(input.root, file));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        continue;
      throw error;
    }
    throw new MillError(
      "NATIVE_ADOPTION_CONFLICT",
      "Existing Mill controls must be migrated explicitly, never overwritten by adoption.",
      ExitCode.configuration,
    );
  }
  const files = [
    { path: "mill.yaml", content: yaml(config) },
    {
      path: "mill.lock",
      content: yaml(
        millLockSchema.parse({
          schemaVersion: "1",
          mill: { package: MILL_PACKAGE, version: MILL_VERSION },
        }),
      ),
    },
  ];
  const result = {
    schemaVersion: "1",
    status: "experimental",
    repositoryId: config.repositoryId,
    baseCommit: base.commit,
    baseTree: base.tree,
    configDigest: canonicalDigest(config as unknown as JsonValue),
    nativePackageDigest: textDigest(packageText),
    nativeLockDigest: textDigest(lockText),
    scanDigest: scan.digest,
    files,
    qualification: "not_executed",
  };
  await assertRepositoryWorktreeClean(input.root);
  if ((await readCandidateIdentity(input.root)).commit !== base.commit)
    throw new MillError(
      "NATIVE_ADOPTION_BASE_STALE",
      "Repository identity changed during native adoption planning.",
      ExitCode.configuration,
    );
  return { ...result, approvalDigest: canonicalDigest(result) };
}

export async function applyNativeAdoption(input: {
  root: string;
  configPath: string;
  approvalDigest: string;
  attended: boolean;
}) {
  if (!input.attended)
    throw new MillError(
      "ATTENDANCE_REQUIRED",
      "Native adoption requires the attending operator's exact plan approval.",
      ExitCode.configuration,
    );
  const plan = await planNativeAdoption(input);
  if (plan.approvalDigest !== input.approvalDigest)
    throw new MillError(
      "NATIVE_ADOPTION_APPROVAL_MISMATCH",
      "The native adoption approval is stale or mismatched.",
      ExitCode.configuration,
    );
  const store = await StateStore.open(
    plan.repositoryId,
    await commonGitDirectory(input.root),
  );
  let lease: Awaited<ReturnType<typeof acquireWriterLease>> | undefined;
  const id = plan.approvalDigest.slice(7);
  const destination = path.join(store.worktreesDirectory, `native-${id}`);
  try {
    lease = await acquireWriterLease(store);
    if (store.runs().some((run) => !isTerminalRun(run.status)))
      throw new MillError(
        "ACTIVE_RUN_CONFLICT",
        "Finish or reconcile the existing lifecycle before native adoption.",
        ExitCode.configuration,
      );
    if (
      (await planNativeAdoption(input)).approvalDigest !== plan.approvalDigest
    )
      throw new MillError(
        "NATIVE_ADOPTION_BASE_STALE",
        "The plan changed before adoption apply.",
        ExitCode.configuration,
      );
    store.beginAuthorityPlan(
      {
        kind: "native_adoption",
        state: "intent",
        approvalDigest: plan.approvalDigest,
        baseCommit: plan.baseCommit,
        worktreePath: destination,
        branch: `mill/native-adoption-${id.slice(0, 8)}`,
        files: plan.files.map((file) => ({
          path: file.path,
          digest: textDigest(file.content),
        })),
      },
      "NATIVE_ADOPTION_RECONCILIATION_REQUIRED",
    );
    const branch = await createCandidateWorktree(
      input.root,
      destination,
      plan.baseCommit,
      "native-adoption",
      id,
    );
    for (const file of plan.files)
      await writeFile(path.join(destination, file.path), file.content, {
        flag: "wx",
        mode: 0o644,
      });
    store.settleAuthorityPlan(plan.approvalDigest, { branch });
    return {
      status: "experimental",
      approvalDigest: plan.approvalDigest,
      branch,
      worktree: destination,
      preservedNativePackageDigest: plan.nativePackageDigest,
      preservedNativeLockDigest: plan.nativeLockDigest,
      nextAction:
        "Review and commit the new controls, explicitly prepare dependencies, then supply approved product/scenario/impact/task authority and run native baseline qualification. This is not a public-alpha support claim.",
    };
  } finally {
    try {
      await lease?.release();
    } finally {
      store.close();
    }
  }
}
