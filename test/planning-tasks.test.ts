import { execFile } from "node:child_process";
import { readFile, writeFile, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stringify as yaml, parse as parseYaml } from "yaml";
import { outcomePlanSchema } from "../src/contracts/schemas.js";
import { runCli } from "../src/cli-program.js";
import { compileChangeTasks, applyChangeTasks } from "../src/planning/tasks.js";
import { loadRuntimeInputs, textDigest } from "../src/runtime/inputs.js";
import {
  qualifyBaseline,
  startLocalRun,
  verifyRun,
  reviewRun,
  statePurge,
} from "../src/runtime/lifecycle.js";
import { runtimeFixture } from "./runtime-fixture.js";
import {
  abandonAuthorityPlan,
  reconcileAuthorityPlans,
} from "../src/runtime/authority-plans.js";
import { commonGitDirectory } from "../src/runtime/repository.js";
import {
  StateStore,
  restoreStateBackup,
  purgeRepositoryState,
} from "../src/runtime/state.js";

const exec = promisify(execFile);
const original = {
  state: process.env.MILL_STATE_HOME,
  codex: process.env.MILL_CODEX_PATH,
  docker: process.env.MILL_DOCKER_PATH,
};
afterEach(() => {
  if (original.state === undefined) delete process.env.MILL_STATE_HOME;
  else process.env.MILL_STATE_HOME = original.state;
  if (original.codex === undefined) delete process.env.MILL_CODEX_PATH;
  else process.env.MILL_CODEX_PATH = original.codex;
  if (original.docker === undefined) delete process.env.MILL_DOCKER_PATH;
  else process.env.MILL_DOCKER_PATH = original.docker;
});
const git = (root: string, args: string[]) =>
  exec(
    "/usr/bin/git",
    [
      "-c",
      "user.name=Mill Test",
      "-c",
      "user.email=test@example.invalid",
      ...args,
    ],
    { cwd: root },
  );

async function requestFixture(kind = "prd", allowedPaths = ["src/value.js"]) {
  const fixture = await runtimeFixture();
  process.env.MILL_STATE_HOME = fixture.stateHome;
  process.env.MILL_CODEX_PATH = fixture.codexPath;
  process.env.MILL_DOCKER_PATH = fixture.dockerPath;
  const inputs = await loadRuntimeInputs(fixture.root, fixture.taskPath);
  if (inputs.task.schemaVersion !== "2") throw new Error("expected v2 fixture");
  const sourcePath = "product/PRD.md";
  const request = {
    schemaVersion: "1",
    repositoryIntelligence: true,
    id: "compiled-change",
    kind,
    source: {
      path: sourcePath,
      digest: textDigest(
        await readFile(path.join(fixture.root, sourcePath), "utf8"),
      ),
    },
    productPath: inputs.task.authority.productContract.path,
    scenariosPath: inputs.task.authority.scenarioSet.path,
    policyPath: inputs.task.authority.policy.path,
    commit: inputs.task.commit,
    budget: inputs.task.budget,
    readyOutcomeId: "OUT-POSITIVE-VALUE",
    tasks: [
      {
        id: "compiled-value",
        outcomeId: "OUT-POSITIVE-VALUE",
        title: "Improve the positive value",
        objective: inputs.task.objective,
        dependsOn: [],
        impactPath: inputs.task.authority.impactManifest.path,
        allowedPaths,
        contextPaths: inputs.task.contextPaths,
      },
    ],
  };
  await writeFile(path.join(fixture.root, "change.yaml"), yaml(request));
  await git(fixture.root, ["add", "change.yaml"]);
  await git(fixture.root, ["commit", "-m", "test: approve change inputs"]);
  return {
    fixture,
    request,
    input: { root: fixture.root, requestPath: "change.yaml" },
  };
}

describe("change-plan task compilation", () => {
  it.each(["intent", "applied"])(
    "abandons %s only after preserving partial output on its exact clean branch",
    async (state) => {
      const { fixture, input } = await requestFixture();
      try {
        const plan = await compileChangeTasks(input);
        const inputs = await loadRuntimeInputs(fixture.root, fixture.taskPath);
        const common = await commonGitDirectory(fixture.root);
        if (state === "intent") {
          const interrupted = vi
            .spyOn(StateStore.prototype, "settleAuthorityPlan")
            .mockImplementation(() => {
              throw new Error("interrupted apply");
            });
          try {
            await expect(
              applyChangeTasks({
                ...input,
                approvalDigest: plan.approvalDigest,
                attended: true,
              }),
            ).rejects.toThrow("interrupted apply");
          } finally {
            interrupted.mockRestore();
          }
        } else
          await applyChangeTasks({
            ...input,
            approvalDigest: plan.approvalDigest,
            attended: true,
          });
        const store = await StateStore.open(inputs.config.repositoryId, common);
        const record = store.authorityPlans()[0];
        store.close();
        if (!record?.branch) throw new Error("missing plan");
        expect(record.state).toBe(state);
        // A failed apply may not have written every approved file. It must not
        // manufacture successful completion just to unlock recovery.
        await rm(
          path.join(record.worktreePath, "product/tasks/compiled-value.yaml"),
        );
        const abandon = {
          root: fixture.root,
          approvalDigest: plan.approvalDigest,
          attended: true,
        };
        await expect(
          abandonAuthorityPlan({ ...abandon, attended: false }),
        ).rejects.toMatchObject({ code: "ATTENDANCE_REQUIRED" });
        await expect(
          abandonAuthorityPlan({
            ...abandon,
            approvalDigest: `sha256:${"0".repeat(64)}`,
          }),
        ).rejects.toMatchObject({ code: "INVALID_AUTHORITY_PLAN" });
        await expect(abandonAuthorityPlan(abandon)).rejects.toMatchObject({
          code: "DIRTY_CHECKOUT",
        });
        await git(record.worktreePath, ["add", "product"]);
        await git(record.worktreePath, [
          "commit",
          "-m",
          "test: preserve partial failed apply",
        ]);
        const retained = (
          await git(record.worktreePath, ["rev-parse", "HEAD"])
        ).stdout.trim();
        await git(record.worktreePath, ["switch", "-c", "test-wrong-branch"]);
        await expect(abandonAuthorityPlan(abandon)).rejects.toMatchObject({
          code: "AUTHORITY_PLAN_IDENTITY_MISMATCH",
        });
        await git(record.worktreePath, ["switch", record.branch]);
        const output: string[] = [];
        const errors: string[] = [];
        expect(
          await runCli(
            [
              "--json",
              "--cwd",
              fixture.root,
              "state",
              "abandon-plan",
              "--approve",
              plan.approvalDigest,
              "--attended",
            ],
            {
              stdout: { write: (value) => void output.push(value) },
              stderr: { write: (value) => void errors.push(value) },
            },
          ),
        ).toBe(0);
        expect(errors).toEqual([]);
        const envelope = JSON.parse(output.join("")) as { data: unknown };
        expect(envelope).toMatchObject({
          command: "state.abandon-plan",
          ok: true,
        });
        const result = envelope.data;
        expect(result).toMatchObject({
          state: "abandoned",
          retainedCommit: retained,
          branch: record.branch,
        });
        expect(await abandonAuthorityPlan(abandon)).toEqual(result);
        const preserved = await StateStore.open(
          inputs.config.repositoryId,
          common,
        );
        const backup = await preserved.backup();
        expect(preserved.authorityPlans()[0]).toEqual({
          ...record,
          state: "abandoned",
          abandonedCommit: retained,
        });
        const retainedBranch = record.branch;
        expect(() =>
          preserved.settleAuthorityPlan(plan.approvalDigest, {
            branch: retainedBranch,
            committedCommit: retained,
          }),
        ).toThrow();
        preserved.close();
        await restoreStateBackup(inputs.config.repositoryId, common, backup);
        expect(
          (await reconcileAuthorityPlans({ root: fixture.root })).plans[0],
        ).toMatchObject({ state: "abandoned" });
        await expect(
          applyChangeTasks({
            ...input,
            approvalDigest: plan.approvalDigest,
            attended: true,
          }),
        ).rejects.toMatchObject({
          code: "CHANGE_APPLY_RECONCILIATION_REQUIRED",
        });
        await writeFile(
          path.join(record.worktreePath, "unexpected.txt"),
          "retain me",
        );
        await expect(
          statePurge({
            root: fixture.root,
            confirmation: inputs.config.repositoryId,
          }),
        ).rejects.toMatchObject({ code: "DIRTY_CHECKOUT" });
        await rm(path.join(record.worktreePath, "unexpected.txt"));
        await statePurge({
          root: fixture.root,
          confirmation: inputs.config.repositoryId,
        });
        expect(
          (
            await git(fixture.root, [
              "rev-parse",
              `refs/heads/${record.branch}`,
            ])
          ).stdout.trim(),
        ).toBe(retained);
        await expect(
          readFile(
            path.join(fixture.root, "product/tasks/compiled-value.yaml"),
          ),
        ).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        await fixture.cleanup();
      }
    },
  );
  it("rejects existing output paths before approval or apply intent", async () => {
    const { fixture, request, input } = await requestFixture();
    try {
      const prior = await compileChangeTasks(input);
      for (const file of prior.files)
        await writeFile(path.join(fixture.root, file.path), file.content);
      const taskFile = prior.files.find(
        (file) => file.path === "product/tasks/compiled-value.yaml",
      );
      if (!taskFile) throw new Error("missing task");
      await writeFile(
        path.join(fixture.root, "change.yaml"),
        yaml({
          ...request,
          tasks: request.tasks.map((task) => ({
            ...task,
            supersedesTaskDigest: textDigest(taskFile.content),
          })),
        }),
      );
      await git(fixture.root, ["add", "product", "change.yaml"]);
      await git(fixture.root, ["commit", "-m", "test: same-ID supersession"]);
      await expect(compileChangeTasks(input)).rejects.toMatchObject({
        code: "CHANGE_OUTPUT_EXISTS",
      });
      await expect(
        applyChangeTasks({
          ...input,
          approvalDigest: prior.approvalDigest,
          attended: true,
        }),
      ).rejects.toMatchObject({ code: "CHANGE_OUTPUT_EXISTS" });
      expect(
        await readFile(path.join(fixture.root, taskFile.path), "utf8"),
      ).toBe(taskFile.content);
      const inputs = await loadRuntimeInputs(fixture.root, fixture.taskPath);
      const store = await StateStore.open(
        inputs.config.repositoryId,
        await commonGitDirectory(fixture.root),
      );
      try {
        expect(store.authorityPlans()).toEqual([]);
      } finally {
        store.close();
      }
    } finally {
      await fixture.cleanup();
    }
  });
  it("rejects a missing superseded task instead of dropping closed history", async () => {
    const { fixture, request, input } = await requestFixture();
    try {
      const proposed = await compileChangeTasks(input);
      const prior = proposed.files.find(
        (file) => file.path === "product/plan.yaml",
      );
      if (prior === undefined) throw new Error("missing plan");
      const history = outcomePlanSchema.parse(parseYaml(prior.content));
      history.outcomes.push({
        id: "OUT-RETAINED-HISTORY",
        title: "Closed history",
        acceptance: ["Previously verified outcome remains closed."],
        dependsOn: [],
        status: "closed",
      });
      await writeFile(path.join(fixture.root, prior.path), yaml(history));
      await writeFile(
        path.join(fixture.root, "change.yaml"),
        yaml({
          ...request,
          tasks: request.tasks.map((task) => ({
            ...task,
            supersedesTaskDigest: `sha256:${"a".repeat(64)}`,
          })),
        }),
      );
      await git(fixture.root, ["add", "product/plan.yaml", "change.yaml"]);
      await git(fixture.root, [
        "commit",
        "-m",
        "test: missing superseded task",
      ]);
      await expect(compileChangeTasks(input)).rejects.toMatchObject({
        code: "FILE_NOT_FOUND",
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it.each(["product/PRD.md", ".git"])(
    "recovers partial authority deletion of %s but rejects foreign content",
    async (removed) => {
      const { fixture, input } = await requestFixture();
      try {
        const plan = await compileChangeTasks(input);
        const applied = await applyChangeTasks({
          ...input,
          approvalDigest: plan.approvalDigest,
          attended: true,
        });
        await git(applied.worktree, ["add", "product"]);
        await git(applied.worktree, [
          "commit",
          "-m",
          "test: retained authority",
        ]);
        await reconcileAuthorityPlans({ root: fixture.root });
        const inputs = await loadRuntimeInputs(fixture.root, fixture.taskPath);
        const common = await commonGitDirectory(fixture.root);
        const store = await StateStore.open(inputs.config.repositoryId, common);
        const record = store.authorityPlans()[0];
        if (record?.committedCommit === undefined)
          throw new Error("missing commit");
        store.beginAuthorityPlanPurge(
          record.approvalDigest,
          record.committedCommit,
        );
        store.close();
        await rm(path.join(applied.worktree, removed));
        const foreign = path.join(applied.worktree, "foreign.txt");
        await writeFile(foreign, "not owned by purge");
        const purge = {
          root: fixture.root,
          confirmation: inputs.config.repositoryId,
        };
        await expect(statePurge(purge)).rejects.toMatchObject({
          code: "AUTHORITY_PLAN_IDENTITY_MISMATCH",
        });
        expect(await readFile(foreign, "utf8")).toBe("not owned by purge");
        await rm(foreign);
        await symlink(fixture.root, foreign);
        await expect(statePurge(purge)).rejects.toMatchObject({
          code: "AUTHORITY_PLAN_IDENTITY_MISMATCH",
        });
        await rm(foreign);
        const tracked = path.join(applied.worktree, "src/value.js");
        const retained = await readFile(tracked);
        await writeFile(tracked, "unrelated replacement");
        await expect(statePurge(purge)).rejects.toMatchObject({
          code: "AUTHORITY_PLAN_IDENTITY_MISMATCH",
        });
        expect(await readFile(tracked, "utf8")).toBe("unrelated replacement");
        await writeFile(tracked, retained);
        await statePurge(purge);
        expect(
          (
            await git(fixture.root, [
              "rev-parse",
              `refs/heads/${record.branch}`,
            ])
          ).stdout.trim(),
        ).toBe(record.committedCommit);
      } finally {
        await fixture.cleanup();
      }
    },
  );
  it("keeps inspect-only task apply free of authority writes", async () => {
    const { fixture, input } = await requestFixture();
    try {
      const configPath = path.join(fixture.root, "mill.yaml");
      await writeFile(
        configPath,
        (await readFile(configPath, "utf8")).replace(
          "trustCeiling: build",
          "trustCeiling: inspect",
        ),
      );
      await git(fixture.root, ["add", "mill.yaml"]);
      await git(fixture.root, ["commit", "-m", "test: inspect-only policy"]);
      const plan = await compileChangeTasks(input);
      await expect(
        applyChangeTasks({
          ...input,
          approvalDigest: plan.approvalDigest,
          attended: true,
        }),
      ).rejects.toMatchObject({ code: "TRUST_CEILING_EXCEEDED" });
      expect(
        (
          await git(fixture.root, ["worktree", "list", "--porcelain"])
        ).stdout.match(/^worktree /gm),
      ).toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it("resumes an interrupted authority-worktree purge only from durable exact-branch evidence", async () => {
    const { fixture, input } = await requestFixture();
    try {
      const plan = await compileChangeTasks(input);
      const applied = await applyChangeTasks({
        ...input,
        approvalDigest: plan.approvalDigest,
        attended: true,
      });
      await git(applied.worktree, ["add", "product"]);
      await git(applied.worktree, [
        "commit",
        "-m",
        "test: commit generated authority",
      ]);
      await reconcileAuthorityPlans({ root: fixture.root });
      const inputs = await loadRuntimeInputs(fixture.root, fixture.taskPath);
      const common = await commonGitDirectory(fixture.root);
      const store = await StateStore.open(inputs.config.repositoryId, common);
      const record = store.authorityPlans()[0];
      if (record?.committedCommit === undefined || record.branch === undefined)
        throw new Error("missing committed plan");
      store.beginAuthorityPlanPurge(
        record.approvalDigest,
        record.committedCommit,
      );
      store.close();
      await git(fixture.root, ["worktree", "remove", applied.worktree]);
      // Simulate interruption after removal but before database deletion.
      await git(fixture.root, [
        "update-ref",
        `refs/heads/${record.branch}`,
        record.baseCommit,
      ]);
      await expect(
        statePurge({
          root: fixture.root,
          confirmation: inputs.config.repositoryId,
        }),
      ).rejects.toMatchObject({ code: "AUTHORITY_PLAN_IDENTITY_MISMATCH" });
      await git(fixture.root, [
        "update-ref",
        `refs/heads/${record.branch}`,
        record.committedCommit,
      ]);
      await statePurge({
        root: fixture.root,
        confirmation: inputs.config.repositoryId,
      });
      expect(
        (
          await git(fixture.root, ["rev-parse", `refs/heads/${record.branch}`])
        ).stdout.trim(),
      ).toBe(record.committedCommit);
    } finally {
      await fixture.cleanup();
    }
  });
  it.each(["prd", "plan", "bug", "review", "maintenance"])(
    "compiles %s through the same deterministic authority path",
    async (kind) => {
      const { fixture, input } = await requestFixture(kind);
      try {
        const result = await compileChangeTasks(input);
        expect(await compileChangeTasks(input)).toEqual(result);
        expect(result.kind).toBe(kind);
        expect(result.files.map((file) => file.path)).toEqual([
          "product/tasks/compiled-value.yaml",
          "product/plan.yaml",
        ]);
        expect(result.files[0]?.content).toContain('schemaVersion: "2"');
        await expect(
          applyChangeTasks({
            ...input,
            approvalDigest: result.approvalDigest,
            attended: false,
          }),
        ).rejects.toMatchObject({ code: "ATTENDANCE_REQUIRED" });
        await expect(
          applyChangeTasks({
            ...input,
            approvalDigest: `sha256:${"0".repeat(64)}`,
            attended: true,
          }),
        ).rejects.toMatchObject({ code: "CHANGE_APPROVAL_MISMATCH" });
      } finally {
        await fixture.cleanup();
      }
    },
  );

  it("applies in an isolated worktree and runs the compiled task through baseline, verification and review", async () => {
    const { fixture, input } = await requestFixture();
    try {
      const plan = await compileChangeTasks(input);
      const applied = await applyChangeTasks({
        ...input,
        approvalDigest: plan.approvalDigest,
        attended: true,
      });
      expect(applied.worktree).not.toBe(fixture.root);
      const inputs = await loadRuntimeInputs(fixture.root, fixture.taskPath);
      const common = await commonGitDirectory(fixture.root);
      const store = await StateStore.open(inputs.config.repositoryId, common);
      const backup = await store.backup();
      expect(store.authorityPlans()[0]?.state).toBe("applied");
      store.close();
      expect(
        (await restoreStateBackup(inputs.config.repositoryId, common, backup))
          .quarantinedCount,
      ).toBe(0);
      await expect(
        purgeRepositoryState(inputs.config.repositoryId, common),
      ).rejects.toMatchObject({ code: "AUTHORITY_PLANS_BLOCK_PURGE" });
      expect(
        (await reconcileAuthorityPlans({ root: fixture.root })).plans[0],
      ).toMatchObject({ state: "applied", blockCode: "DIRTY_CHECKOUT" });
      await expect(
        readFile(path.join(fixture.root, "product/tasks/compiled-value.yaml")),
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        applyChangeTasks({
          ...input,
          approvalDigest: plan.approvalDigest,
          attended: true,
        }),
      ).rejects.toMatchObject({ code: "CHANGE_APPLY_RECONCILIATION_REQUIRED" });
      await git(applied.worktree, [
        "add",
        "product/tasks/compiled-value.yaml",
        "product/plan.yaml",
      ]);
      await git(applied.worktree, [
        "commit",
        "-m",
        "test: freeze compiled task authority",
      ]);
      expect(
        (await reconcileAuthorityPlans({ root: fixture.root })).plans[0]?.state,
      ).toBe("committed");
      expect(
        (await reconcileAuthorityPlans({ root: fixture.root })).plans[0]?.state,
      ).toBe("committed");
      await expect(
        purgeRepositoryState(inputs.config.repositoryId, common),
      ).rejects.toMatchObject({ code: "AUTHORITY_PLANS_BLOCK_PURGE" });
      const task = {
        root: applied.worktree,
        taskPath: "product/tasks/compiled-value.yaml",
      };
      const baseline = await qualifyBaseline(task);
      expect(baseline.evidence.passed).toBe(true);
      if (baseline.approvalDigest === null) throw new Error("baseline failed");
      const started = await startLocalRun({
        ...task,
        approvalDigest: baseline.approvalDigest,
      });
      const run = { ...task, runId: started.run.id };
      expect((await verifyRun(run)).evidence.passed).toBe(true);
      expect((await reviewRun(run)).run.status).toBe("reviewed");
    } finally {
      await fixture.cleanup();
    }
  });

  it("refuses task scope that overlaps frozen command controls", async () => {
    const { fixture, input } = await requestFixture("review", ["test/**"]);
    try {
      await expect(compileChangeTasks(input)).rejects.toMatchObject({
        code: "TASK_AUTHORITY_OVERLAP",
      });
    } finally {
      await fixture.cleanup();
    }
  });
});
