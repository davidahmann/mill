import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { stringify as yaml } from "yaml";
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
import { reconcileAuthorityPlans } from "../src/runtime/authority-plans.js";
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
