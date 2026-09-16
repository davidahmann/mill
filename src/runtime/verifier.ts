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
import {
  adaptationEvidence,
  type AdaptationManifest,
} from "../planning/adaptation.js";
import { ExitCode, MillError } from "../errors.js";
import { isWithin } from "../security/safe-path.js";
import {
  buildSemanticEvidence,
  type ContinuityProductContract,
  type ContinuityScenarioSet,
  type ImpactManifest,
} from "../planning/impact.js";
import { dependencyLockPaths } from "./dependencies.js";
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
  artifacts?: readonly {
    path: string;
    sha256: string;
    bytes: number;
  }[];
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

function artifactDirectoryName(commandId: string): string {
  return createHash("sha256").update(commandId, "utf8").digest("hex");
}

function artifactTransportBudget(
  retained: NonNullable<MillConfig["commands"][string]["retainedArtifacts"]>,
): number {
  const encodedPayload = Math.ceil(retained.maxTotalBytes / 3) * 4;
  const framing = retained.paths.reduce(
    (total, artifactPath) =>
      total + Buffer.byteLength(artifactPath, "utf8") + 64,
    256,
  );
  return encodedPayload + framing;
}

function artifactTmpfsBytes(
  retained: NonNullable<MillConfig["commands"][string]["retainedArtifacts"]>,
): number {
  const pageBytes = 4096;
  return retained.maxTotalBytes + (retained.maxFiles + 1) * pageBytes;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function retainedArtifactProtocolScript(input: {
  paths: readonly string[];
  maxFileBytes: number;
}): string {
  const paths = input.paths.map(shellQuote).join(" ");
  return [
    "set +e",
    '"$@"',
    "mill_status=$?",
    'printf "\\n%s:begin\\n" "$MILL_ARTIFACT_PROTOCOL"',
    `for mill_artifact_path in ${paths}; do`,
    '  mill_artifact_full="/mill-artifacts/$mill_artifact_path"',
    '  mill_artifact_parent=$(dirname "$mill_artifact_full")',
    "  mill_artifact_invalid=0",
    '  while [ "$mill_artifact_parent" != "/mill-artifacts" ]; do',
    '    if [ -L "$mill_artifact_parent" ]; then mill_artifact_invalid=1; break; fi',
    '    mill_artifact_parent=$(dirname "$mill_artifact_parent")',
    "  done",
    '  if [ "$mill_artifact_invalid" = 1 ] || [ -L "$mill_artifact_full" ]; then',
    '    printf "invalid\\n"',
    '  elif [ ! -f "$mill_artifact_full" ]; then',
    '    printf "missing\\n"',
    "  else",
    '    mill_artifact_bytes=$(wc -c < "$mill_artifact_full" | tr -d " ")',
    '    case "$mill_artifact_bytes" in',
    "      ''|*[!0-9]*) printf \"invalid\\n\" ;;",
    `      *) if [ "$mill_artifact_bytes" -gt ${input.maxFileBytes} ]; then printf "too_large\\n"; else printf "regular:%s\\n" "$mill_artifact_bytes"; base64 -w 0 "$mill_artifact_full"; printf "\\n"; fi ;;`,
    "    esac",
    "  fi",
    "done",
    'printf "%s:end:%s\\n" "$MILL_ARTIFACT_PROTOCOL" "$mill_status"',
    "exit 0",
  ].join("\n");
}

async function decodeRetainedArtifactProtocol(input: {
  stdout: string;
  marker: string;
  commandId: string;
  command: NonNullable<MillConfig["commands"][string]>;
  outputRoot: string;
}): Promise<{ stdout: string; exitCode: number }> {
  const retained = input.command.retainedArtifacts;
  if (retained === undefined) {
    throw new Error(
      "artifact protocol requires retained-artifact configuration",
    );
  }
  const begin = `\n${input.marker}:begin\n`;
  const beginAt = input.stdout.lastIndexOf(begin);
  if (beginAt < 0) {
    throw new MillError(
      "VERIFIER_ARTIFACT_COLLECTION_FAILED",
      "The verifier did not return its bounded artifact protocol.",
      ExitCode.temporary,
      { commandId: input.commandId },
    );
  }
  let offset = beginAt + begin.length;
  const protocolFailure = (): MillError =>
    new MillError(
      "VERIFIER_ARTIFACT_COLLECTION_FAILED",
      "The verifier returned a malformed bounded artifact protocol.",
      ExitCode.temporary,
      { commandId: input.commandId },
    );
  for (const artifactPath of retained.paths) {
    const lineEnd = input.stdout.indexOf("\n", offset);
    if (lineEnd < 0) throw protocolFailure();
    const status = input.stdout.slice(offset, lineEnd);
    offset = lineEnd + 1;
    if (status === "missing") continue;
    if (status === "invalid") {
      throw new MillError(
        "VERIFIER_ARTIFACT_TYPE_INVALID",
        "A retained verifier artifact cannot traverse a symbolic link or use a non-regular file.",
        ExitCode.data,
        { commandId: input.commandId, path: artifactPath },
      );
    }
    if (status === "too_large") {
      throw new MillError(
        "VERIFIER_ARTIFACT_FILE_LIMIT_EXCEEDED",
        "A retained verifier artifact exceeded its approved file-size limit.",
        ExitCode.data,
        { commandId: input.commandId, path: artifactPath },
      );
    }
    const matched = /^regular:([0-9]+)$/u.exec(status);
    if (matched?.[1] === undefined) throw protocolFailure();
    const bytes = Number(matched[1]);
    if (!Number.isSafeInteger(bytes) || bytes > retained.maxFileBytes) {
      throw protocolFailure();
    }
    const encodedBytes = Math.ceil(bytes / 3) * 4;
    const encoded = input.stdout.slice(offset, offset + encodedBytes);
    if (
      encoded.length !== encodedBytes ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
        encoded,
      ) ||
      input.stdout.at(offset + encodedBytes) !== "\n"
    ) {
      throw protocolFailure();
    }
    offset += encodedBytes + 1;
    const contents = Buffer.from(encoded, "base64");
    if (contents.length !== bytes) throw protocolFailure();
    const destination = path.resolve(input.outputRoot, artifactPath);
    if (!isWithin(input.outputRoot, destination)) {
      throw new MillError(
        "VERIFIER_ARTIFACT_PATH_INVALID",
        "A verifier artifact path escaped its dedicated output directory.",
        ExitCode.configuration,
        { commandId: input.commandId, path: artifactPath },
      );
    }
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, contents, { flag: "wx", mode: 0o600 });
  }
  const end = `${input.marker}:end:`;
  if (!input.stdout.startsWith(end, offset)) throw protocolFailure();
  const exitCode = Number(input.stdout.slice(offset + end.length).trim());
  if (!Number.isSafeInteger(exitCode) || exitCode < 0 || exitCode > 255) {
    throw protocolFailure();
  }
  return { stdout: input.stdout.slice(0, beginAt), exitCode };
}

async function collectRetainedArtifacts(input: {
  commandId: string;
  command: NonNullable<MillConfig["commands"][string]>;
  outputRoot: string;
  destinationRoot: string | undefined;
}): Promise<{
  artifacts: { path: string; sha256: string; bytes: number }[];
  missingRequired: boolean;
}> {
  const retained = input.command.retainedArtifacts;
  if (retained === undefined) return { artifacts: [], missingRequired: false };
  if (input.destinationRoot === undefined) {
    throw new MillError(
      "VERIFIER_ARTIFACT_STORE_REQUIRED",
      "Retained verifier artifacts require a lifecycle-owned storage directory.",
      ExitCode.configuration,
      { commandId: input.commandId },
    );
  }
  if (retained.paths.length > retained.maxFiles) {
    throw new MillError(
      "VERIFIER_ARTIFACT_COUNT_EXCEEDED",
      "The declared verifier artifact paths exceed the approved file limit.",
      ExitCode.configuration,
      { commandId: input.commandId },
    );
  }
  const destination = path.join(
    input.destinationRoot,
    artifactDirectoryName(input.commandId),
  );
  await mkdir(destination, { recursive: true, mode: 0o700 });
  await chmod(destination, 0o700);
  const artifacts: { path: string; sha256: string; bytes: number }[] = [];
  let totalBytes = 0;
  let missingRequired = false;
  for (const artifactPath of retained.paths) {
    const source = path.resolve(input.outputRoot, artifactPath);
    if (!isWithin(input.outputRoot, source)) {
      throw new MillError(
        "VERIFIER_ARTIFACT_PATH_INVALID",
        "A verifier artifact path escaped its dedicated output directory.",
        ExitCode.configuration,
        { commandId: input.commandId, path: artifactPath },
      );
    }
    let ancestor = input.outputRoot;
    for (const segment of artifactPath.split("/")) {
      ancestor = path.join(ancestor, segment);
      let ancestorInfo;
      try {
        ancestorInfo = await lstat(ancestor);
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )
          break;
        throw error;
      }
      if (ancestorInfo.isSymbolicLink()) {
        throw new MillError(
          "VERIFIER_ARTIFACT_TYPE_INVALID",
          "A retained verifier artifact cannot traverse a symbolic link.",
          ExitCode.data,
          { commandId: input.commandId, path: artifactPath },
        );
      }
    }
    let before;
    try {
      before = await lstat(source);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        missingRequired ||= retained.required;
        continue;
      }
      throw error;
    }
    if (!before.isFile() || before.isSymbolicLink()) {
      throw new MillError(
        "VERIFIER_ARTIFACT_TYPE_INVALID",
        "A retained verifier artifact must be a regular non-symlink file.",
        ExitCode.data,
        { commandId: input.commandId, path: artifactPath },
      );
    }
    if (before.size > retained.maxFileBytes) {
      throw new MillError(
        "VERIFIER_ARTIFACT_FILE_LIMIT_EXCEEDED",
        "A retained verifier artifact exceeded its approved file-size limit.",
        ExitCode.data,
        { commandId: input.commandId, path: artifactPath },
      );
    }
    if (totalBytes + before.size > retained.maxTotalBytes) {
      throw new MillError(
        "VERIFIER_ARTIFACT_TOTAL_LIMIT_EXCEEDED",
        "Retained verifier artifacts exceeded their approved aggregate limit.",
        ExitCode.data,
        { commandId: input.commandId },
      );
    }
    const bytes = await readFile(source);
    const after = await lstat(source);
    if (
      !after.isFile() ||
      after.isSymbolicLink() ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    ) {
      throw new MillError(
        "VERIFIER_ARTIFACT_CHANGED_DURING_COLLECTION",
        "A verifier artifact changed while Mill was collecting it.",
        ExitCode.data,
        { commandId: input.commandId, path: artifactPath },
      );
    }
    const destinationPath = path.join(destination, artifactPath);
    await mkdir(path.dirname(destinationPath), {
      recursive: true,
      mode: 0o700,
    });
    await writeFile(destinationPath, bytes, { flag: "wx", mode: 0o600 });
    const sha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    artifacts.push({ path: artifactPath, sha256, bytes: bytes.length });
    totalBytes += bytes.length;
  }
  return { artifacts, missingRequired };
}

function validationEvidence(input: {
  candidateCommit: string;
  verifierImage: string;
  commands: readonly CommandEvidence[];
  task: TaskPacket;
  adaptation?: { manifest: AdaptationManifest; digest: string };
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
  const adaptation =
    input.adaptation === undefined
      ? undefined
      : adaptationEvidence(
          input.adaptation.manifest,
          input.adaptation.digest,
          input.commands,
        );
  return validationEvidenceSchema.parse({
    schemaVersion: "1",
    candidateCommit: input.candidateCommit,
    verifierImage: input.verifierImage,
    network: "none",
    ...(adaptation === undefined ? {} : { adaptation }),
    commands: input.commands,
    ...(semantic === undefined ? {} : { semantic }),
    passed:
      commandsPassed &&
      (semantic?.passed ?? true) &&
      (adaptation?.matrix.every(
        (cell) => cell.status === "passed" || cell.status === "excluded",
      ) ??
        true),
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
        stderrDigest: digestOutput("", result.stderr),
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
  workspacePaths: readonly string[] = [],
): Promise<{
  mounts: string[];
  workspaceDirectories: readonly string[];
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
    const workspaceDirectories: string[] = [];
    const workspaceParents = new Set(
      workspacePaths.map((workspacePath) => workspacePath.slice(0, -2)),
    );
    const addWorkspaceParent = async (parent: string): Promise<void> => {
      const sourceParent = path.join(root, parent);
      const parentInfo = await lstat(sourceParent);
      if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()) {
        throw new MillError(
          "VERIFIER_WORKSPACE_ENTRY_UNSUPPORTED",
          "A declared pnpm workspace parent must be a regular directory.",
          ExitCode.configuration,
          { path: parent },
        );
      }
      const targetParent = path.join(skeleton, parent);
      await mkdir(targetParent, { mode: 0o700 });
      const childHandle = await opendir(sourceParent);
      const children = [];
      for await (const child of childHandle) children.push(child);
      if (children.length > 256) {
        throw new MillError(
          "VERIFIER_WORKSPACE_ENTRY_LIMIT_EXCEEDED",
          "A declared pnpm workspace parent has too many direct entries.",
          ExitCode.configuration,
          { path: parent },
        );
      }
      for (const child of children.sort((left, right) =>
        left.name.localeCompare(right.name),
      )) {
        const relative = `${parent}/${child.name}`;
        if (child.name.includes(",")) {
          throw new MillError(
            "VERIFIER_WORKSPACE_ENTRY_UNSUPPORTED",
            "A pnpm workspace entry contains a comma and cannot be bound safely.",
            ExitCode.configuration,
            { path: relative },
          );
        }
        const sourceWorkspace = path.join(sourceParent, child.name);
        const workspaceInfo = await lstat(sourceWorkspace);
        if (!workspaceInfo.isDirectory() || workspaceInfo.isSymbolicLink()) {
          throw new MillError(
            "VERIFIER_WORKSPACE_ENTRY_UNSUPPORTED",
            "A declared pnpm workspace entry must be a regular directory.",
            ExitCode.configuration,
            { path: relative },
          );
        }
        try {
          await lstat(path.join(sourceWorkspace, "node_modules"));
          throw new MillError(
            "VERIFIER_WORKSPACE_NODE_MODULES_OCCUPIED",
            "A candidate pnpm workspace must not contain node_modules before verification.",
            ExitCode.configuration,
            { path: relative },
          );
        } catch (error) {
          if (
            error instanceof MillError ||
            !(
              error instanceof Error &&
              "code" in error &&
              error.code === "ENOENT"
            )
          ) {
            throw error;
          }
        }
        const targetWorkspace = path.join(targetParent, child.name);
        await mkdir(targetWorkspace, { mode: 0o700 });
        await mkdir(path.join(targetWorkspace, "node_modules"), {
          mode: 0o700,
        });
        const workspaceHandle = await opendir(sourceWorkspace);
        const workspaceEntries = [];
        for await (const entry of workspaceHandle) workspaceEntries.push(entry);
        if (workspaceEntries.length > 256) {
          throw new MillError(
            "VERIFIER_WORKSPACE_ENTRY_LIMIT_EXCEEDED",
            "A pnpm workspace has too many direct entries.",
            ExitCode.configuration,
            { path: relative },
          );
        }
        for (const entry of workspaceEntries.sort((left, right) =>
          left.name.localeCompare(right.name),
        )) {
          const entryPath = `${relative}/${entry.name}`;
          if (entry.name === "node_modules" || entry.name.includes(",")) {
            throw new MillError(
              "VERIFIER_WORKSPACE_ENTRY_UNSUPPORTED",
              "A pnpm workspace has an unsupported verifier mount entry.",
              ExitCode.configuration,
              { path: entryPath },
            );
          }
          const sourceEntry = path.join(sourceWorkspace, entry.name);
          const entryInfo = await lstat(sourceEntry);
          if (entryInfo.isSymbolicLink()) {
            throw new MillError(
              "VERIFIER_WORKSPACE_ENTRY_UNSUPPORTED",
              "A pnpm workspace symbolic link cannot cross the verifier mount boundary.",
              ExitCode.configuration,
              { path: entryPath },
            );
          }
          const targetEntry = path.join(targetWorkspace, entry.name);
          if (entryInfo.isDirectory()) {
            await mkdir(targetEntry, { mode: 0o700 });
          } else if (entryInfo.isFile()) {
            await writeFile(targetEntry, "", { flag: "wx", mode: 0o600 });
          } else {
            throw new MillError(
              "VERIFIER_WORKSPACE_ENTRY_UNSUPPORTED",
              "A pnpm workspace entry has an unsupported filesystem type.",
              ExitCode.configuration,
              { path: entryPath },
            );
          }
          mounts.push(
            "--mount",
            `type=bind,source=${path.join(source.source, parent, child.name, entry.name)},target=/workspace/${entryPath},readonly`,
          );
        }
        workspaceDirectories.push(relative);
      }
    };
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      if (mountPaths.includes(entry.name)) continue;
      if (workspaceParents.has(entry.name)) {
        await addWorkspaceParent(entry.name);
        continue;
      }
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
      workspaceDirectories,
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
  artifactDirectory?: string;
  candidateCommit: string;
  config: MillConfig;
  task: TaskPacket;
  adaptation?: { manifest: AdaptationManifest; digest: string };
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
      ...(input.adaptation === undefined
        ? {}
        : { adaptation: input.adaptation }),
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
  if (input.artifactDirectory !== undefined) {
    await mkdir(input.artifactDirectory, { recursive: true, mode: 0o700 });
    await chmod(input.artifactDirectory, 0o700);
  }
  const uid = process.getuid?.() ?? 1000;
  const gid = process.getgid?.() ?? 1000;
  const canonicalRoot = await realpath(input.root);
  const dependencyMounts: string[] = [];
  let dependencyMount:
    Awaited<ReturnType<typeof verifierMountSource>> | undefined;
  let dependencyRoot: string | undefined;
  const workspaceDependencyMounts: Awaited<
    ReturnType<typeof verifierMountSource>
  >[] = [];
  if (input.config.verifier.dependencies !== undefined) {
    if (input.dependencyRoot === undefined) {
      throw new MillError(
        "VERIFIER_DEPENDENCIES_UNAVAILABLE",
        "The verifier requires a qualified local dependency installation.",
        ExitCode.unavailable,
      );
    }
    const canonicalDependencyRoot = await realpath(input.dependencyRoot);
    dependencyRoot = canonicalDependencyRoot;
    const lockPaths = await dependencyLockPaths({
      root: canonicalRoot,
      config: input.config,
    });
    for (const lockPath of lockPaths) {
      let candidateLock: string;
      let dependencyLock: string;
      try {
        [candidateLock, dependencyLock] = await Promise.all([
          realpath(path.resolve(canonicalRoot, lockPath)),
          realpath(path.resolve(canonicalDependencyRoot, lockPath)),
        ]);
      } catch {
        throw new MillError(
          "VERIFIER_DEPENDENCY_LOCK_DRIFT",
          "The dependency installation is missing a bound package-manager input.",
          ExitCode.configuration,
          { lockPath },
        );
      }
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
    workspace = await workspaceMountPlan(
      canonicalRoot,
      [
        ...(input.config.verifier.dependencies === undefined
          ? []
          : [input.config.verifier.dependencies.targetPath]),
        ...input.task.commandIds.flatMap(
          (commandId) =>
            input.config.commands[commandId]?.writablePaths?.map(
              (configuredPath) => configuredPath.replace(/\/\*\*$/u, ""),
            ) ?? [],
        ),
      ],
      input.config.verifier.dependencies?.manager === "pnpm"
        ? input.config.verifier.dependencies.workspacePaths
        : [],
    );
    if (
      input.config.verifier.dependencies?.manager === "pnpm" &&
      dependencyRoot !== undefined
    ) {
      for (const workspaceDirectory of workspace.workspaceDirectories) {
        const candidate = path.join(
          dependencyRoot,
          workspaceDirectory,
          "node_modules",
        );
        let information;
        try {
          information = await lstat(candidate);
        } catch (error) {
          if (
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          ) {
            continue;
          }
          throw error;
        }
        if (!information.isDirectory() || information.isSymbolicLink()) {
          throw new MillError(
            "VERIFIER_DEPENDENCIES_UNAVAILABLE",
            "A pnpm workspace dependency directory is not a qualified regular directory.",
            ExitCode.unavailable,
            { path: `${workspaceDirectory}/node_modules` },
          );
        }
        const mount = await verifierMountSource(candidate);
        workspaceDependencyMounts.push(mount);
        dependencyMounts.push(
          "--mount",
          `type=bind,source=${mount.source},target=/workspace/${workspaceDirectory}/node_modules,readonly`,
        );
      }
    }
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
      const retainedArtifactsConfig = command.retainedArtifacts;
      const artifactOutput =
        retainedArtifactsConfig === undefined
          ? undefined
          : await mkdtemp(path.join(tmpdir(), "mill-verifier-artifacts-"));
      if (artifactOutput !== undefined) await chmod(artifactOutput, 0o700);
      const artifactProtocol =
        retainedArtifactsConfig === undefined ? undefined : randomUUID();
      let result: ProcessResult;
      let retainedArtifacts:
        Awaited<ReturnType<typeof collectRetainedArtifacts>> | undefined;
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
              ? [
                  "--init",
                  "--tmpfs",
                  "/mill-fixtures:rw,exec,nosuid,nodev,size=256m",
                ]
              : []),
            ...workspace.mounts,
            ...dependencyMounts,
            ...writableMounts,
            ...(retainedArtifactsConfig === undefined
              ? []
              : [
                  "--tmpfs",
                  `/mill-artifacts:rw,size=${artifactTmpfsBytes(retainedArtifactsConfig)},mode=1777`,
                ]),
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
            ...(retainedArtifactsConfig === undefined
              ? []
              : [
                  "--env",
                  "MILL_ARTIFACTS_DIR=/mill-artifacts",
                  "--env",
                  `MILL_ARTIFACT_PROTOCOL=${artifactProtocol}`,
                ]),
            "--entrypoint",
            retainedArtifactsConfig === undefined
              ? commandExecutable
              : "/bin/sh",
            input.config.verifier.image,
            ...(retainedArtifactsConfig === undefined
              ? command.argv.slice(1)
              : [
                  "-ec",
                  retainedArtifactProtocolScript({
                    paths: retainedArtifactsConfig.paths,
                    maxFileBytes: retainedArtifactsConfig.maxFileBytes,
                  }),
                  "mill-artifact-protocol",
                  commandExecutable,
                  ...command.argv.slice(1),
                ]),
          ],
          cwd: input.root,
          env: {
            HOME: process.env.HOME,
            PATH: "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin",
            LANG: "C",
            LC_ALL: "C",
          },
          deadlineMs: commandDeadline,
          maxOutputBytes:
            input.maxOutputBytes +
            (retainedArtifactsConfig === undefined
              ? 0
              : artifactTransportBudget(retainedArtifactsConfig)),
          ...(input.signal === undefined ? {} : { signal: input.signal }),
          ...(input.onSpawn === undefined ? {} : { onSpawn: input.onSpawn }),
          ...(input.onExit === undefined ? {} : { onExit: input.onExit }),
          ...(input.cancellationRequested === undefined
            ? {}
            : { cancellationRequested: input.cancellationRequested }),
        });
        if (artifactOutput !== undefined) {
          if (
            !result.timedOut &&
            !result.cancelled &&
            !result.outputExceeded &&
            artifactProtocol !== undefined
          ) {
            const decoded = await decodeRetainedArtifactProtocol({
              stdout: result.stdout,
              marker: artifactProtocol,
              commandId,
              command,
              outputRoot: artifactOutput,
            });
            result = {
              ...result,
              stdout: decoded.stdout,
              exitCode: decoded.exitCode,
              outputExceeded:
                Buffer.byteLength(decoded.stdout, "utf8") +
                  Buffer.byteLength(result.stderr, "utf8") >
                input.maxOutputBytes,
            };
          }
          retainedArtifacts = await collectRetainedArtifacts({
            commandId,
            command,
            outputRoot: artifactOutput,
            destinationRoot: input.artifactDirectory,
          });
        }
      } finally {
        try {
          await removeVerifierContainer(docker, input.root, containerName);
        } finally {
          if (artifactOutput !== undefined) {
            await rm(artifactOutput, { recursive: true, force: true });
          }
        }
      }
      const passed =
        result.exitCode === 0 &&
        !result.timedOut &&
        !result.outputExceeded &&
        !result.cancelled &&
        retainedArtifacts?.missingRequired !== true;
      evidence.push({
        commandId,
        required: command.required,
        status: passed ? "passed" : "failed",
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        outputDigest: digestOutput(result.stdout, result.stderr),
        ...(retainedArtifacts === undefined
          ? {}
          : { artifacts: retainedArtifacts.artifacts }),
        ...(passed
          ? {}
          : {
              reason: result.cancelled
                ? "CANCELLED"
                : result.timedOut
                  ? "DEADLINE_EXCEEDED"
                  : result.outputExceeded
                    ? "OUTPUT_BUDGET_EXCEEDED"
                    : retainedArtifacts?.missingRequired === true
                      ? "RETAINED_ARTIFACT_MISSING"
                      : "NONZERO_EXIT",
            }),
      });
    }
    return validationEvidence({
      candidateCommit: input.candidateCommit,
      verifierImage: input.config.verifier.image,
      commands: evidence,
      task: input.task,
      ...(input.adaptation === undefined
        ? {}
        : { adaptation: input.adaptation }),
      ...(input.impact === undefined ? {} : { impact: input.impact }),
      ...(input.product === undefined ? {} : { product: input.product }),
      ...(input.scenarios === undefined ? {} : { scenarios: input.scenarios }),
    });
  } finally {
    try {
      await workspace?.dispose();
    } finally {
      try {
        await Promise.all(
          workspaceDependencyMounts.map((mount) => mount.dispose()),
        );
      } finally {
        await dependencyMount?.dispose();
      }
    }
  }
}
