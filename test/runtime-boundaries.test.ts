import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertContextFresh,
  buildContextManifest,
} from "../src/runtime/context.js";
import { loadRuntimeInputs } from "../src/runtime/inputs.js";
import type { MillConfig, TaskPacket } from "../src/runtime/inputs.js";
import {
  assertCandidateScope,
  assertGitControlState,
  captureGitControlState,
  createCandidateWorktree,
  qualifyRepositoryForBuild,
  removeCandidateWorktree,
  validateAllowedPatterns,
} from "../src/runtime/repository.js";
import { verifyDeclaredCommands } from "../src/runtime/verifier.js";
import { runtimeFixture } from "./runtime-fixture.js";
import { temporaryDirectory } from "./helpers.js";

const execFileAsync = promisify(execFile);
const originalDocker = process.env.MILL_DOCKER_PATH;

afterEach(() => {
  if (originalDocker === undefined) delete process.env.MILL_DOCKER_PATH;
  else process.env.MILL_DOCKER_PATH = originalDocker;
});

async function git(root: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync(
    "/usr/bin/git",
    [
      "-c",
      "user.name=Mill Test",
      "-c",
      "user.email=mill-test@example.invalid",
      ...args,
    ],
    { cwd: root },
  );
  return result.stdout;
}

describe("runtime authority and repository boundaries", () => {
  it("rejects authority drift, unsupported path patterns, and sensitive context", async () => {
    const fixture = await runtimeFixture();
    try {
      const inputs = await loadRuntimeInputs(fixture.root, fixture.taskPath);
      expect(() => validateAllowedPatterns(["src/*.js"])).toThrow(
        expect.objectContaining({ code: "UNSUPPORTED_PATH_PATTERN" }),
      );
      const sensitiveConfig = {
        ...inputs.config,
        sensitivePaths: ["test/**"],
      };
      await expect(
        buildContextManifest(
          fixture.root,
          "a".repeat(40),
          inputs.task,
          sensitiveConfig,
          inputs.taskDigest,
        ),
      ).rejects.toMatchObject({ code: "SENSITIVE_CONTEXT_FORBIDDEN" });

      const configPath = path.join(fixture.root, "mill.yaml");
      const configSource = await readFile(configPath, "utf8");
      await writeFile(
        configPath,
        configSource.replace("  - .env", "  - secrets/*.json"),
      );
      await expect(
        loadRuntimeInputs(fixture.root, fixture.taskPath),
      ).rejects.toMatchObject({ code: "INVALID_RUNTIME_CONTRACT" });
      await writeFile(configPath, configSource);

      await writeFile(
        path.join(fixture.root, "product", "contract.yaml"),
        "changed\n",
      );
      await expect(
        loadRuntimeInputs(fixture.root, fixture.taskPath),
      ).rejects.toMatchObject({ code: "AUTHORITY_DIGEST_MISMATCH" });
    } finally {
      await fixture.cleanup();
    }
  });

  it("binds context only to fresh regular files", async () => {
    const fixture = await runtimeFixture();
    try {
      const inputs = await loadRuntimeInputs(fixture.root, fixture.taskPath);
      const frozen = await buildContextManifest(
        fixture.root,
        "a".repeat(40),
        inputs.task,
        inputs.config,
        inputs.taskDigest,
      );
      await writeFile(path.join(fixture.root, "WORKFLOW.md"), "changed\n");
      await expect(
        assertContextFresh(fixture.root, frozen.manifest),
      ).rejects.toMatchObject({ code: "CONTEXT_DRIFT" });

      await mkdir(path.join(fixture.root, "context-directory"));
      await expect(
        buildContextManifest(
          fixture.root,
          "a".repeat(40),
          { ...inputs.task, contextPaths: ["context-directory"] },
          inputs.config,
          inputs.taskDigest,
        ),
      ).rejects.toMatchObject({ code: "INVALID_CONTEXT_FILE" });
    } finally {
      await fixture.cleanup();
    }
  });

  it("freezes all repository instructions and a content-addressed provider scope", async () => {
    const fixture = await runtimeFixture();
    try {
      await Promise.all([
        writeFile(path.join(fixture.root, "AGENTS.md"), "# Root rules\n"),
        writeFile(
          path.join(fixture.root, "src", "AGENTS.md"),
          "# Source rules\n",
        ),
      ]);
      const inputs = await loadRuntimeInputs(fixture.root, fixture.taskPath);
      const first = await buildContextManifest(
        fixture.root,
        "a".repeat(40),
        inputs.task,
        inputs.config,
        inputs.taskDigest,
      );
      const repeated = await buildContextManifest(
        fixture.root,
        "a".repeat(40),
        inputs.task,
        inputs.config,
        inputs.taskDigest,
      );
      expect(
        first.manifest.effectiveInstructions.map((item) => item.path),
      ).toEqual(["AGENTS.md", "src/AGENTS.md"]);
      expect(first.manifest.providerVisibleScope).toMatchObject({
        repositoryScope: "worktree",
        writablePatterns: inputs.task.allowedPaths,
        observedReads: "unavailable",
      });
      expect(first.manifest.contextEpoch).toBe(repeated.manifest.contextEpoch);

      const changedScope = await buildContextManifest(
        fixture.root,
        "a".repeat(40),
        { ...inputs.task, allowedPaths: ["src/**"] },
        inputs.config,
        inputs.taskDigest,
      );
      expect(changedScope.manifest.contextEpoch).not.toBe(
        first.manifest.contextEpoch,
      );
      await writeFile(
        path.join(fixture.root, "src", "AGENTS.md"),
        "# Changed source rules\n",
      );
      await expect(
        assertContextFresh(fixture.root, first.manifest),
      ).rejects.toMatchObject({ code: "INSTRUCTION_DRIFT" });
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects output scope that overlaps task, authority, context, or command controls", async () => {
    const fixture = await runtimeFixture();
    try {
      const taskPath = path.join(fixture.root, fixture.taskPath);
      const source = await readFile(taskPath, "utf8");
      for (const allowedPath of [
        "product/**",
        "WORKFLOW.md",
        "test/**",
        "mill.yaml",
      ]) {
        await writeFile(
          taskPath,
          source.replace(
            "allowedPaths:\n  - src/value.js",
            `allowedPaths:\n  - ${allowedPath}`,
          ),
        );
        await expect(
          loadRuntimeInputs(fixture.root, fixture.taskPath),
        ).rejects.toMatchObject({ code: "BOUND_INPUT_SCOPE_OVERLAP" });
      }
      const configPath = path.join(fixture.root, "mill.yaml");
      await writeFile(
        configPath,
        (await readFile(configPath, "utf8")).replace(
          "      - test/value.test.js",
          "      - test/**",
        ),
      );
      for (const allowedPath of ["test/new.test.js", "test/**"]) {
        await writeFile(
          taskPath,
          source.replace(
            "allowedPaths:\n  - src/value.js",
            `allowedPaths:\n  - ${allowedPath}`,
          ),
        );
        await expect(
          loadRuntimeInputs(fixture.root, fixture.taskPath),
        ).rejects.toMatchObject({ code: "BOUND_INPUT_SCOPE_OVERLAP" });
      }
    } finally {
      await fixture.cleanup();
    }
  });

  it("blocks dirty checkouts and transforming Git attributes", async () => {
    const dirty = await runtimeFixture();
    try {
      await writeFile(path.join(dirty.root, "untracked.txt"), "dirty\n");
      await expect(
        qualifyRepositoryForBuild(dirty.root, "HEAD"),
      ).rejects.toMatchObject({ code: "DIRTY_CHECKOUT" });
    } finally {
      await dirty.cleanup();
    }

    const attributes = await runtimeFixture();
    try {
      await writeFile(
        path.join(attributes.root, ".gitattributes"),
        "*.txt filter=malicious\n",
      );
      await git(attributes.root, ["add", ".gitattributes"]);
      await git(attributes.root, [
        "commit",
        "--no-gpg-sign",
        "-m",
        "test: add unsafe attributes",
      ]);
      await expect(
        qualifyRepositoryForBuild(attributes.root, "HEAD"),
      ).rejects.toMatchObject({ code: "UNSAFE_GIT_ATTRIBUTES" });
    } finally {
      await attributes.cleanup();
    }
  });

  it("rejects Git replacement refs and graft metadata", async () => {
    const replacement = await runtimeFixture();
    try {
      const head = (await git(replacement.root, ["rev-parse", "HEAD"])).trim();
      await git(replacement.root, ["update-ref", `refs/replace/${head}`, head]);
      await expect(
        qualifyRepositoryForBuild(replacement.root, "HEAD"),
      ).rejects.toMatchObject({ code: "HISTORY_SUBSTITUTION_FORBIDDEN" });
    } finally {
      await replacement.cleanup();
    }

    const graft = await runtimeFixture();
    try {
      const head = (await git(graft.root, ["rev-parse", "HEAD"])).trim();
      await mkdir(path.join(graft.root, ".git", "info"), { recursive: true });
      await writeFile(path.join(graft.root, ".git", "info", "grafts"), head);
      await expect(
        qualifyRepositoryForBuild(graft.root, "HEAD"),
      ).rejects.toMatchObject({ code: "HISTORY_SUBSTITUTION_FORBIDDEN" });
    } finally {
      await graft.cleanup();
    }
  });

  it("keeps tracked symlinks and configured sensitive files out of builder worktrees", async () => {
    const sensitive = await runtimeFixture();
    try {
      await writeFile(path.join(sensitive.root, ".env"), "SECRET=value\n");
      await git(sensitive.root, ["add", ".env"]);
      await git(sensitive.root, [
        "commit",
        "--no-gpg-sign",
        "-m",
        "test: add tracked sensitive file",
      ]);
      await expect(
        qualifyRepositoryForBuild(sensitive.root, "HEAD", [".env"]),
      ).rejects.toMatchObject({ code: "TRACKED_SENSITIVE_PATH_FORBIDDEN" });
    } finally {
      await sensitive.cleanup();
    }

    const linked = await runtimeFixture();
    try {
      await symlink("value.js", path.join(linked.root, "src", "alias.js"));
      await git(linked.root, ["add", "src/alias.js"]);
      await git(linked.root, [
        "commit",
        "--no-gpg-sign",
        "-m",
        "test: add tracked symlink",
      ]);
      await expect(
        qualifyRepositoryForBuild(linked.root, "HEAD"),
      ).rejects.toMatchObject({ code: "TRACKED_SYMLINK_FORBIDDEN" });
    } finally {
      await linked.cleanup();
    }
  });

  it("rejects empty, unauthorized, and symlink candidate changes", async () => {
    const fixture = await runtimeFixture();
    const worktree = path.join(
      fixture.stateHome,
      "repositories",
      "fixture",
      "worktrees",
      "candidate",
    );
    try {
      const qualified = await qualifyRepositoryForBuild(fixture.root, "HEAD");
      await createCandidateWorktree(
        fixture.root,
        worktree,
        qualified.baseCommit,
        "fixture",
        "12345678-1234-4234-8234-123456789012",
      );
      await expect(
        assertCandidateScope(worktree, qualified.baseCommit, ["src/**"]),
      ).rejects.toMatchObject({ code: "EMPTY_CANDIDATE" });
      await writeFile(path.join(worktree, "outside.txt"), "outside\n");
      await expect(
        assertCandidateScope(worktree, qualified.baseCommit, ["src/**"]),
      ).rejects.toMatchObject({ code: "CANDIDATE_SCOPE_VIOLATION" });
      await git(worktree, ["clean", "-df"]);
      await symlink(
        "../test/value.test.js",
        path.join(worktree, "src", "link.js"),
      );
      await expect(
        assertCandidateScope(worktree, qualified.baseCommit, ["src/**"]),
      ).rejects.toMatchObject({ code: "CANDIDATE_SYMLINK_FORBIDDEN" });
      await removeCandidateWorktree(fixture.root, worktree);
      await expect(
        removeCandidateWorktree(fixture.root, worktree),
      ).resolves.toBeUndefined();
    } finally {
      try {
        await removeCandidateWorktree(fixture.root, worktree);
      } catch {
        // Worktree creation may have failed before registration.
      }
      await fixture.cleanup();
    }
  });

  it("keeps bound runtime inputs immutable even when an allowed path overlaps", async () => {
    const fixture = await runtimeFixture();
    const worktree = path.join(
      fixture.stateHome,
      "repositories",
      "fixture-bound-input",
      "worktrees",
      "candidate",
    );
    try {
      const qualified = await qualifyRepositoryForBuild(fixture.root, "HEAD");
      await createCandidateWorktree(
        fixture.root,
        worktree,
        qualified.baseCommit,
        "fixture",
        "12345678-1234-4234-8234-123456789012",
      );
      await writeFile(path.join(worktree, "WORKFLOW.md"), "rewritten\n");
      await expect(
        assertCandidateScope(
          worktree,
          qualified.baseCommit,
          ["WORKFLOW.md"],
          ["WORKFLOW.md"],
        ),
      ).rejects.toMatchObject({ code: "BOUND_INPUT_MUTATION" });
    } finally {
      try {
        await removeCandidateWorktree(fixture.root, worktree);
      } catch {
        // Worktree creation may have failed before registration.
      }
      await fixture.cleanup();
    }
  });

  it("rejects tracked mutations hidden by Git index flags", async () => {
    const fixture = await runtimeFixture();
    const worktree = path.join(
      fixture.stateHome,
      "repositories",
      "fixture-hidden-index",
      "worktrees",
      "candidate",
    );
    try {
      const qualified = await qualifyRepositoryForBuild(fixture.root, "HEAD");
      await createCandidateWorktree(
        fixture.root,
        worktree,
        qualified.baseCommit,
        "fixture",
        "12345678-1234-4234-8234-123456789012",
      );
      await git(worktree, ["update-index", "--skip-worktree", "WORKFLOW.md"]);
      await writeFile(path.join(worktree, "WORKFLOW.md"), "hidden rewrite\n");
      await expect(
        assertCandidateScope(
          worktree,
          qualified.baseCommit,
          ["src/**"],
          ["WORKFLOW.md"],
        ),
      ).rejects.toMatchObject({ code: "HIDDEN_GIT_INDEX_STATE" });
    } finally {
      try {
        await removeCandidateWorktree(fixture.root, worktree);
      } catch {
        // Worktree creation may have failed before registration.
      }
      await fixture.cleanup();
    }
  });

  it("detects Git control-plane mutation outside the candidate diff", async () => {
    const fixture = await runtimeFixture();
    const worktree = path.join(
      fixture.stateHome,
      "repositories",
      "fixture-control",
      "worktrees",
      "candidate",
    );
    try {
      const qualified = await qualifyRepositoryForBuild(fixture.root, "HEAD");
      await createCandidateWorktree(
        fixture.root,
        worktree,
        qualified.baseCommit,
        "fixture",
        "12345678-1234-4234-8234-123456789012",
      );
      const snapshot = await captureGitControlState(worktree);
      await git(worktree, ["config", "--local", "mill.probe", "changed"]);
      await expect(
        assertGitControlState(worktree, snapshot),
      ).rejects.toMatchObject({ code: "GIT_CONTROL_DRIFT" });
    } finally {
      try {
        await removeCandidateWorktree(fixture.root, worktree);
      } catch {
        // Worktree creation may have failed before registration.
      }
      await fixture.cleanup();
    }
  });

  it("blocks failed, host-only, and unsafe-directory validation commands", async () => {
    const fixture = await runtimeFixture();
    process.env.MILL_DOCKER_PATH = fixture.dockerPath;
    try {
      const inputs = await loadRuntimeInputs(fixture.root, fixture.taskPath);
      const testCommand = inputs.config.commands.test;
      if (testCommand === undefined) throw new Error("fixture command missing");
      await writeFile(
        path.join(fixture.root, "src", "value.js"),
        "export const value = -1;\n",
      );
      const failed = await verifyDeclaredCommands({
        root: fixture.root,
        candidateCommit: "a".repeat(40),
        config: inputs.config,
        task: inputs.task,
        deadlineMs: Date.now() + 30_000,
        maxOutputBytes: 1024 * 1024,
      });
      expect(failed).toMatchObject({
        passed: false,
        commands: [{ status: "failed", reason: "NONZERO_EXIT" }],
      });

      const hostConfig = {
        ...inputs.config,
        commands: {
          ...inputs.config.commands,
          test: { ...testCommand, execution: "host" as const },
        },
      };
      const host = await verifyDeclaredCommands({
        root: fixture.root,
        candidateCommit: "a".repeat(40),
        config: hostConfig,
        task: inputs.task,
        deadlineMs: Date.now() + 30_000,
        maxOutputBytes: 1024 * 1024,
      });
      expect(host.commands[0]).toMatchObject({
        status: "blocked",
        reason: "HOST_EXECUTION_NOT_QUALIFIED",
      });
      const advisoryHost = await verifyDeclaredCommands({
        root: fixture.root,
        candidateCommit: "a".repeat(40),
        config: {
          ...hostConfig,
          commands: {
            ...hostConfig.commands,
            test: { ...hostConfig.commands.test, required: false },
          },
        },
        task: inputs.task,
        deadlineMs: Date.now() + 30_000,
        maxOutputBytes: 1024 * 1024,
      });
      expect(advisoryHost.passed).toBe(true);

      const unsafeConfig = {
        ...inputs.config,
        commands: {
          ...inputs.config.commands,
          test: { ...testCommand, cwd: ".." },
        },
      };
      await expect(
        verifyDeclaredCommands({
          root: fixture.root,
          candidateCommit: "a".repeat(40),
          config: unsafeConfig,
          task: inputs.task,
          deadlineMs: Date.now() + 30_000,
          maxOutputBytes: 1024 * 1024,
        }),
      ).rejects.toMatchObject({ code: "INVALID_COMMAND_DIRECTORY" });

      await expect(
        verifyDeclaredCommands({
          root: fixture.root,
          candidateCommit: "a".repeat(40),
          config: {
            ...inputs.config,
            commands: {
              ...inputs.config.commands,
              test: { ...testCommand, cwd: "src/value.js" },
            },
          },
          task: inputs.task,
          deadlineMs: Date.now() + 30_000,
          maxOutputBytes: 1024 * 1024,
        }),
      ).rejects.toMatchObject({ code: "INVALID_COMMAND_DIRECTORY" });
    } finally {
      await fixture.cleanup();
    }
  });

  it("verifies repositories whose absolute path contains a comma", async () => {
    const fixture = await runtimeFixture({
      repositoryPrefix: "mill-runtime,repo-",
    });
    process.env.MILL_DOCKER_PATH = fixture.dockerPath;
    try {
      const inputs = await loadRuntimeInputs(fixture.root, fixture.taskPath);
      const evidence = await verifyDeclaredCommands({
        root: fixture.root,
        candidateCommit: "a".repeat(40),
        config: inputs.config,
        task: inputs.task,
        deadlineMs: Date.now() + 30_000,
        maxOutputBytes: 1024 * 1024,
      });
      expect(evidence.passed).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  });

  it("fails closed when the OCI verifier contract or image is unavailable", async () => {
    const fixture = await runtimeFixture();
    const tools = await temporaryDirectory("mill-verifier-unavailable-");
    try {
      const inputs = await loadRuntimeInputs(fixture.root, fixture.taskPath);
      const call = (config: MillConfig, task: TaskPacket = inputs.task) =>
        verifyDeclaredCommands({
          root: fixture.root,
          candidateCommit: "a".repeat(40),
          config,
          task,
          deadlineMs: Date.now() + 5_000,
          maxOutputBytes: 1024,
        });
      await expect(
        call({
          ...inputs.config,
          verifier: undefined,
        }),
      ).rejects.toMatchObject({ code: "VERIFIER_NOT_CONFIGURED" });

      process.env.MILL_DOCKER_PATH = path.join(tools.path, "missing-docker");
      await expect(call(inputs.config)).rejects.toMatchObject({
        code: "OCI_RUNTIME_UNAVAILABLE",
      });

      const docker = path.join(tools.path, "docker");
      await writeFile(docker, `#!${process.execPath}\nprocess.exit(9);\n`, {
        mode: 0o755,
      });
      await chmod(docker, 0o755);
      process.env.MILL_DOCKER_PATH = docker;
      await expect(call(inputs.config)).rejects.toMatchObject({
        code: "VERIFIER_IMAGE_UNAVAILABLE",
      });

      process.env.MILL_DOCKER_PATH = fixture.dockerPath;
      await expect(
        call(inputs.config, {
          ...inputs.task,
          commandIds: ["missing"],
        }),
      ).rejects.toMatchObject({ code: "UNKNOWN_COMMAND_ID" });
      const configuredTest = inputs.config.commands.test;
      if (configuredTest === undefined) throw new Error("test command missing");
      await expect(
        call({
          ...inputs.config,
          commands: {
            ...inputs.config.commands,
            test: { ...configuredTest, argv: [] },
          },
        }),
      ).rejects.toMatchObject({ code: "INVALID_COMMAND" });
    } finally {
      await Promise.all([fixture.cleanup(), tools.cleanup()]);
    }
  });

  it("classifies OCI deadlines, output limits, and cancellation", async () => {
    const fixture = await runtimeFixture();
    const tools = await temporaryDirectory("mill-verifier-bounds-");
    const inputs = await loadRuntimeInputs(fixture.root, fixture.taskPath);
    const writeDocker = async (
      runBody: string,
      imageBody = "process.exit(0);",
    ): Promise<void> => {
      const docker = path.join(tools.path, "docker");
      await writeFile(
        docker,
        `#!${process.execPath}\nconst args=process.argv.slice(2);if(args[0]==="image"){${imageBody}}else if(args[0]==="rm"){process.exit(0)}else{${runBody}}\n`,
        { mode: 0o755 },
      );
      await chmod(docker, 0o755);
      process.env.MILL_DOCKER_PATH = docker;
    };
    const call = (deadlineMs: number, signal?: AbortSignal) =>
      verifyDeclaredCommands({
        root: fixture.root,
        candidateCommit: "a".repeat(40),
        config: inputs.config,
        task: inputs.task,
        deadlineMs,
        maxOutputBytes: 128,
        ...(signal === undefined ? {} : { signal }),
      });
    try {
      await writeDocker("process.exit(0);", "setInterval(()=>{},1000);");
      const preflightFallback = new AbortController();
      const fallbackTimer = setTimeout(() => preflightFallback.abort(), 500);
      fallbackTimer.unref();
      try {
        await expect(
          call(Date.now() + 100, preflightFallback.signal),
        ).rejects.toMatchObject({ code: "VERIFIER_DEADLINE_EXCEEDED" });
      } finally {
        clearTimeout(fallbackTimer);
      }

      await writeDocker("setInterval(()=>{},1000);");
      const timed = await call(Date.now() + 800);
      expect(timed.commands[0]).toMatchObject({
        status: "failed",
        reason: "DEADLINE_EXCEEDED",
      });

      await writeDocker(
        'process.stdout.write("x".repeat(10000));setInterval(()=>{},1000);',
      );
      const noisy = await call(Date.now() + 5_000);
      expect(noisy.commands[0]).toMatchObject({
        status: "failed",
        reason: "OUTPUT_BUDGET_EXCEEDED",
      });

      await writeDocker("setInterval(()=>{},1000);");
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 100).unref();
      const cancelled = await call(Date.now() + 5_000, controller.signal);
      expect(cancelled.commands[0]).toMatchObject({
        status: "failed",
        reason: "CANCELLED",
      });

      const configuredTest = inputs.config.commands.test;
      if (configuredTest === undefined) throw new Error("test command missing");
      const stoppedBeforeRequired = await verifyDeclaredCommands({
        root: fixture.root,
        candidateCommit: "a".repeat(40),
        config: {
          ...inputs.config,
          commands: {
            optional: { ...configuredTest, required: false },
            required: { ...configuredTest, required: true },
          },
        },
        task: { ...inputs.task, commandIds: ["optional", "required"] },
        deadlineMs: Date.now() - 1,
        maxOutputBytes: 128,
      });
      expect(stoppedBeforeRequired).toMatchObject({
        passed: false,
        commands: [
          {
            commandId: "optional",
            required: false,
            status: "failed",
            reason: "DEADLINE_EXCEEDED",
          },
          {
            commandId: "required",
            required: true,
            status: "failed",
            reason: "DEADLINE_EXCEEDED",
          },
        ],
      });
    } finally {
      await Promise.all([fixture.cleanup(), tools.cleanup()]);
    }
  });

  it("force-removes a daemon-owned OCI container after its client times out", async () => {
    const fixture = await runtimeFixture();
    const tools = await temporaryDirectory("mill-verifier-cleanup-");
    const docker = path.join(tools.path, "docker");
    const workerPid = path.join(tools.path, "worker.pid");
    const invocationLog = path.join(tools.path, "docker.log");
    const inputs = await loadRuntimeInputs(fixture.root, fixture.taskPath);
    await writeFile(
      docker,
      `#!${process.execPath}
import {appendFileSync,readFileSync,writeFileSync} from "node:fs";
import {spawn} from "node:child_process";
const args=process.argv.slice(2);
appendFileSync(${JSON.stringify(invocationLog)},JSON.stringify(args)+"\\n");
if(args[0]==="image"){process.exit(0)}
if(args[0]==="run"){
  const worker=spawn(process.execPath,["-e","process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{detached:true,stdio:"ignore"});
  worker.unref();writeFileSync(${JSON.stringify(workerPid)},String(worker.pid));setInterval(()=>{},1000);
}else if(args[0]==="rm"){
  try{process.kill(Number(readFileSync(${JSON.stringify(workerPid)},"utf8")),"SIGKILL")}catch{}
  process.exit(0);
}else if(args[0]==="container"&&args[1]==="inspect"){process.exit(1)}else{process.exit(2)}
`,
      { mode: 0o755 },
    );
    await chmod(docker, 0o755);
    process.env.MILL_DOCKER_PATH = docker;
    try {
      const evidence = await verifyDeclaredCommands({
        root: fixture.root,
        candidateCommit: "a".repeat(40),
        config: inputs.config,
        task: inputs.task,
        deadlineMs: Date.now() + 800,
        maxOutputBytes: 1024,
      });
      expect(evidence.commands[0]).toMatchObject({
        status: "failed",
        reason: "DEADLINE_EXCEEDED",
      });
      expect(await readFile(invocationLog, "utf8")).toContain('["rm"');
      const pid = Number(await readFile(workerPid, "utf8"));
      for (let attempt = 0; attempt < 20; attempt += 1) {
        try {
          process.kill(pid, 0);
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
      expect(() => process.kill(pid, 0)).toThrow(
        expect.objectContaining({ code: "ESRCH" }),
      );
    } finally {
      await Promise.all([fixture.cleanup(), tools.cleanup()]);
    }
  });

  it("withholds validation evidence when OCI container cleanup cannot be proven", async () => {
    const fixture = await runtimeFixture();
    const tools = await temporaryDirectory("mill-verifier-cleanup-failure-");
    const docker = path.join(tools.path, "docker");
    const inputs = await loadRuntimeInputs(fixture.root, fixture.taskPath);
    await writeFile(
      docker,
      `#!${process.execPath}\nconst args=process.argv.slice(2);if(args[0]==="image"||args[0]==="run")process.exit(0);if(args[0]==="rm"){console.error("daemon unavailable");process.exit(9)}process.exit(2);\n`,
      { mode: 0o755 },
    );
    await chmod(docker, 0o755);
    process.env.MILL_DOCKER_PATH = docker;
    try {
      await expect(
        verifyDeclaredCommands({
          root: fixture.root,
          candidateCommit: "a".repeat(40),
          config: inputs.config,
          task: inputs.task,
          deadlineMs: Date.now() + 5_000,
          maxOutputBytes: 1024,
        }),
      ).rejects.toMatchObject({ code: "VERIFIER_CONTAINER_CLEANUP_FAILED" });
    } finally {
      await Promise.all([fixture.cleanup(), tools.cleanup()]);
    }
  });
});
