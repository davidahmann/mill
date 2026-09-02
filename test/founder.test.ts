import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { afterEach, describe, expect, it } from "vitest";

import { canonicalDigest, type JsonValue } from "../src/contracts/canonical.js";
import { productContractSchema } from "../src/contracts/schemas.js";
import {
  nextReadyOutcome,
  prepareRepositoryDependencies,
  startNextReadyOutcome,
  startFounderDelivery,
} from "../src/workflows/founder.js";
import { cancelRun, qualifyBaseline } from "../src/runtime/lifecycle.js";
import { loadRuntimeInputs } from "../src/runtime/inputs.js";
import { commonGitDirectory } from "../src/runtime/repository.js";
import { StateStore } from "../src/runtime/state.js";
import { temporaryDirectory } from "./helpers.js";
import { runtimeFixture } from "./runtime-fixture.js";

const originalEnvironment = {
  codex: process.env.MILL_CODEX_PATH,
  docker: process.env.MILL_DOCKER_PATH,
  state: process.env.MILL_STATE_HOME,
};
const execFileAsync = promisify(execFile);

afterEach(() => {
  if (originalEnvironment.codex === undefined)
    delete process.env.MILL_CODEX_PATH;
  else process.env.MILL_CODEX_PATH = originalEnvironment.codex;
  if (originalEnvironment.docker === undefined)
    delete process.env.MILL_DOCKER_PATH;
  else process.env.MILL_DOCKER_PATH = originalEnvironment.docker;
  if (originalEnvironment.state === undefined)
    delete process.env.MILL_STATE_HOME;
  else process.env.MILL_STATE_HOME = originalEnvironment.state;
});

describe("founder workflow", { concurrent: false }, () => {
  it("requires exactly one ready outcome with an explicit task", async () => {
    const temporary = await temporaryDirectory("mill-founder-plan-");
    try {
      await mkdir(path.join(temporary.path, "product"), { recursive: true });
      const writePlan = async (outcomes: unknown[]): Promise<void> =>
        writeFile(
          path.join(temporary.path, "product", "plan.yaml"),
          stringifyYaml({
            schemaVersion: "1",
            productContractDigest: `sha256:${"a".repeat(64)}`,
            outcomes,
          }),
        );
      await writePlan([
        {
          id: "OUT-FIRST",
          title: "First outcome",
          acceptance: ["It works"],
          acceptanceIds: ["ACC-FIRST"],
          dependsOn: [],
          status: "ready",
          taskRef: "product/tasks/first.yaml",
        },
      ]);
      await expect(nextReadyOutcome(temporary.path)).resolves.toEqual({
        outcomeId: "OUT-FIRST",
        title: "First outcome",
        taskPath: "product/tasks/first.yaml",
        productContractDigest: `sha256:${"a".repeat(64)}`,
        acceptanceIds: ["ACC-FIRST"],
      });
      await writePlan([
        {
          id: "OUT-FIRST",
          title: "First outcome",
          acceptance: ["It works"],
          dependsOn: [],
          status: "ready",
          taskRef: "product/tasks/first.yaml",
        },
      ]);
      await expect(nextReadyOutcome(temporary.path)).resolves.toMatchObject({
        outcomeId: "OUT-FIRST",
        acceptanceIds: [],
      });

      await writePlan([
        {
          id: "OUT-FIRST",
          title: "First outcome",
          acceptance: ["It works"],
          dependsOn: [],
          status: "approved",
        },
      ]);
      await expect(nextReadyOutcome(temporary.path)).rejects.toMatchObject({
        code: "NO_READY_OUTCOME",
      });

      await writePlan([
        {
          id: "OUT-FIRST",
          title: "First outcome",
          acceptance: ["It works"],
          dependsOn: [],
          status: "ready",
          taskRef: "product/tasks/first.yaml",
        },
        {
          id: "OUT-SECOND",
          title: "Second outcome",
          acceptance: ["It also works"],
          dependsOn: [],
          status: "ready",
          taskRef: "product/tasks/second.yaml",
        },
      ]);
      await expect(nextReadyOutcome(temporary.path)).rejects.toMatchObject({
        code: "AMBIGUOUS_READY_OUTCOME",
      });

      await writePlan([
        {
          id: "OUT-FIRST",
          title: "First outcome",
          acceptance: ["It works"],
          dependsOn: [],
          status: "ready",
        },
      ]);
      await expect(nextReadyOutcome(temporary.path)).rejects.toMatchObject({
        code: "AMBIGUOUS_READY_OUTCOME",
      });
      await writeFile(
        path.join(temporary.path, "product", "plan.yaml"),
        "not: [valid\n",
      );
      await expect(nextReadyOutcome(temporary.path)).rejects.toMatchObject({
        code: "OUTCOME_PLAN_INVALID",
      });
    } finally {
      await temporary.cleanup();
    }
  });

  it("advances one approved outcome through build, verification, and local review", async () => {
    const fixture = await runtimeFixture();
    process.env.MILL_CODEX_PATH = fixture.codexPath;
    process.env.MILL_DOCKER_PATH = fixture.dockerPath;
    process.env.MILL_STATE_HOME = fixture.stateHome;
    try {
      const product = productContractSchema.parse(
        parseYaml(
          await readFile(
            path.join(fixture.root, "product", "contract.yaml"),
            "utf8",
          ),
        ),
      );
      await writeFile(
        path.join(fixture.root, "product", "plan.yaml"),
        stringifyYaml({
          schemaVersion: "1",
          productContractDigest: canonicalDigest(
            product as unknown as JsonValue,
          ),
          outcomes: [
            {
              id: "OUT-POSITIVE-VALUE",
              title: "Keep the exported value positive",
              acceptance: ["The native test passes"],
              acceptanceIds: ["ACC-POSITIVE"],
              dependsOn: [],
              status: "ready",
              taskRef: fixture.taskPath,
            },
          ],
        }),
      );
      await execFileAsync(
        "/usr/bin/git",
        [
          "-c",
          "user.name=Mill Test",
          "-c",
          "user.email=mill-test@example.invalid",
          "add",
          "product/plan.yaml",
        ],
        { cwd: fixture.root },
      );
      await execFileAsync(
        "/usr/bin/git",
        [
          "-c",
          "user.name=Mill Test",
          "-c",
          "user.email=mill-test@example.invalid",
          "commit",
          "--no-gpg-sign",
          "-m",
          "test: add outcome plan",
        ],
        { cwd: fixture.root },
      );
      const approvedPlan = await readFile(
        path.join(fixture.root, "product", "plan.yaml"),
        "utf8",
      );
      await writeFile(
        path.join(fixture.root, "product", "plan.yaml"),
        approvedPlan.replace("OUT-POSITIVE-VALUE", "OUT-OTHER"),
      );
      await expect(
        startFounderDelivery({
          root: fixture.root,
          prdPath: "product/PRD.md",
          attended: true,
          draftPr: false,
        }),
      ).rejects.toMatchObject({ code: "OUTCOME_TASK_AUTHORITY_MISMATCH" });
      await expect(
        startNextReadyOutcome({
          root: fixture.root,
          approvalDigest: `sha256:${"0".repeat(64)}`,
        }),
      ).rejects.toMatchObject({ code: "OUTCOME_TASK_AUTHORITY_MISMATCH" });
      await writeFile(
        path.join(fixture.root, "product", "plan.yaml"),
        approvedPlan.replace("ACC-POSITIVE", "ACC-OTHER"),
      );
      await expect(
        startFounderDelivery({
          root: fixture.root,
          prdPath: "product/PRD.md",
          attended: true,
          draftPr: false,
        }),
      ).rejects.toMatchObject({ code: "OUTCOME_TASK_AUTHORITY_MISMATCH" });
      await writeFile(
        path.join(fixture.root, "product", "plan.yaml"),
        approvedPlan,
      );
      await expect(
        startFounderDelivery({
          root: fixture.root,
          prdPath: "product/PRD.md",
          attended: false,
          draftPr: false,
        }),
      ).rejects.toMatchObject({ code: "ATTENDANCE_REQUIRED" });
      expect(
        await prepareRepositoryDependencies(fixture.root, true),
      ).toBeUndefined();

      const qualification = await qualifyBaseline({
        root: fixture.root,
        taskPath: fixture.taskPath,
      });
      if (qualification.approvalDigest === null) {
        throw new Error("expected passing founder baseline qualification");
      }
      const next = await startNextReadyOutcome({
        root: fixture.root,
        approvalDigest: qualification.approvalDigest,
      });
      expect(next).toMatchObject({
        outcome: { outcomeId: "OUT-POSITIVE-VALUE" },
        result: { run: { status: "committed" } },
      });
      await expect(
        startNextReadyOutcome({
          root: fixture.root,
          approvalDigest: qualification.approvalDigest,
        }),
      ).rejects.toMatchObject({ code: "ACTIVE_OUTCOME_CONFLICT" });
      const result = await startFounderDelivery({
        root: fixture.root,
        prdPath: "product/PRD.md",
        attended: true,
        draftPr: false,
      });
      expect(result).toMatchObject({
        outcome: { outcomeId: "OUT-POSITIVE-VALUE" },
        stage: "reviewed",
        run: { status: "reviewed" },
      });
      expect(result.nextAction).toContain("millctl ship --draft");
      process.env.MILL_CODEX_PATH = path.join(fixture.root, "missing-codex");
      process.env.MILL_DOCKER_PATH = path.join(fixture.root, "missing-docker");
      await expect(
        startFounderDelivery({
          root: fixture.root,
          prdPath: "product/PRD.md",
          attended: true,
          draftPr: false,
        }),
      ).resolves.toMatchObject({ stage: "reviewed" });
      process.env.MILL_CODEX_PATH = fixture.codexPath;
      process.env.MILL_DOCKER_PATH = fixture.dockerPath;
      await expect(
        startFounderDelivery({
          root: fixture.root,
          prdPath: "product/contract.yaml",
          attended: true,
          draftPr: false,
        }),
      ).rejects.toMatchObject({ code: "PRD_AUTHORITY_MISMATCH" });
      const sourceManifestPath = path.join(
        fixture.root,
        "product",
        "sources.yaml",
      );
      const sourceManifest = await readFile(sourceManifestPath, "utf8");
      await writeFile(sourceManifestPath, "bad: true\n");
      await expect(
        startFounderDelivery({
          root: fixture.root,
          prdPath: "product/PRD.md",
          attended: true,
          draftPr: false,
        }),
      ).rejects.toMatchObject({ code: "PRD_SOURCE_MANIFEST_INVALID" });
      await writeFile(sourceManifestPath, sourceManifest);

      const originalTask = await readFile(
        path.join(fixture.root, fixture.taskPath),
        "utf8",
      );
      const otherTaskPath = "product/tasks/other.yaml";
      const runtimeInputs = await loadRuntimeInputs(
        fixture.root,
        fixture.taskPath,
        "readback",
      );
      const state = await StateStore.open(
        runtimeInputs.config.repositoryId,
        await commonGitDirectory(fixture.root),
      );
      const newerTerminal = state.createRun({
        repositoryId: runtimeInputs.config.repositoryId,
        taskId: "newer-terminal-marker",
        taskDigest: runtimeInputs.taskDigest,
        configDigest: runtimeInputs.configDigest,
        baseCommit: result.run?.baseCommit ?? "0".repeat(40),
        deadlineAt: new Date(Date.now() + 60_000).toISOString(),
      });
      state.transition(newerTerminal.id, "cancelled", "run.cancelled", {
        code: "TEST_TERMINAL_MARKER",
      });
      state.close();
      await writeFile(
        path.join(fixture.root, otherTaskPath),
        originalTask.replace("id: positive-value", "id: other-value"),
      );
      const planSource = await readFile(
        path.join(fixture.root, "product", "plan.yaml"),
        "utf8",
      );
      await writeFile(
        path.join(fixture.root, "product", "plan.yaml"),
        planSource.replace(fixture.taskPath, otherTaskPath),
      );
      await execFileAsync(
        "/usr/bin/git",
        [
          "-c",
          "user.name=Mill Test",
          "-c",
          "user.email=mill-test@example.invalid",
          "add",
          "product/plan.yaml",
          otherTaskPath,
        ],
        { cwd: fixture.root },
      );
      await execFileAsync(
        "/usr/bin/git",
        [
          "-c",
          "user.name=Mill Test",
          "-c",
          "user.email=mill-test@example.invalid",
          "commit",
          "--no-gpg-sign",
          "-m",
          "test: select another outcome task",
        ],
        { cwd: fixture.root },
      );
      await expect(
        startFounderDelivery({
          root: fixture.root,
          prdPath: "product/PRD.md",
          attended: true,
          draftPr: false,
        }),
      ).rejects.toMatchObject({ code: "ACTIVE_OUTCOME_CONFLICT" });
      const firstRun = result.run;
      if (firstRun === undefined) throw new Error("expected reviewed run");
      await cancelRun({ root: fixture.root, runId: firstRun.id });
      await expect(
        startFounderDelivery({
          root: fixture.root,
          prdPath: "product/PRD.md",
          attended: true,
          draftPr: false,
        }),
      ).resolves.toMatchObject({
        outcome: { outcomeId: "OUT-POSITIVE-VALUE" },
        stage: "reviewed",
        run: { taskId: "other-value", status: "reviewed" },
      });
    } finally {
      await fixture.cleanup();
    }
  }, 15_000);

  it("reports preflight and native-baseline blockers before model execution", async () => {
    const preflight = await runtimeFixture();
    process.env.MILL_CODEX_PATH = path.join(preflight.root, "missing-codex");
    process.env.MILL_DOCKER_PATH = preflight.dockerPath;
    process.env.MILL_STATE_HOME = preflight.stateHome;
    try {
      const product = productContractSchema.parse(
        parseYaml(
          await readFile(
            path.join(preflight.root, "product", "contract.yaml"),
            "utf8",
          ),
        ),
      );
      await writeFile(
        path.join(preflight.root, "product", "plan.yaml"),
        stringifyYaml({
          schemaVersion: "1",
          productContractDigest: canonicalDigest(
            product as unknown as JsonValue,
          ),
          outcomes: [
            {
              id: "OUT-POSITIVE-VALUE",
              title: "Keep the exported value positive",
              acceptance: ["The native test passes"],
              acceptanceIds: ["ACC-POSITIVE"],
              dependsOn: [],
              status: "ready",
              taskRef: preflight.taskPath,
            },
          ],
        }),
      );
      await expect(
        startFounderDelivery({
          root: preflight.root,
          prdPath: "product/PRD.md",
          attended: true,
          draftPr: false,
        }),
      ).rejects.toMatchObject({ code: "START_PREFLIGHT_BLOCKED" });
    } finally {
      await preflight.cleanup();
    }

    const baseline = await runtimeFixture();
    process.env.MILL_CODEX_PATH = baseline.codexPath;
    process.env.MILL_DOCKER_PATH = baseline.dockerPath;
    process.env.MILL_STATE_HOME = baseline.stateHome;
    try {
      const product = productContractSchema.parse(
        parseYaml(
          await readFile(
            path.join(baseline.root, "product", "contract.yaml"),
            "utf8",
          ),
        ),
      );
      await writeFile(
        path.join(baseline.root, "product", "plan.yaml"),
        stringifyYaml({
          schemaVersion: "1",
          productContractDigest: canonicalDigest(
            product as unknown as JsonValue,
          ),
          outcomes: [
            {
              id: "OUT-POSITIVE-VALUE",
              title: "Keep the exported value positive",
              acceptance: ["The native test passes"],
              dependsOn: [],
              status: "ready",
              taskRef: baseline.taskPath,
            },
          ],
        }),
      );
      await writeFile(
        path.join(baseline.root, "src", "value.js"),
        "export const value = 0;\n",
      );
      await execFileAsync(
        "/usr/bin/git",
        [
          "-c",
          "user.name=Mill Test",
          "-c",
          "user.email=mill-test@example.invalid",
          "add",
          "product/plan.yaml",
          "src/value.js",
        ],
        { cwd: baseline.root },
      );
      await execFileAsync(
        "/usr/bin/git",
        [
          "-c",
          "user.name=Mill Test",
          "-c",
          "user.email=mill-test@example.invalid",
          "commit",
          "--no-gpg-sign",
          "-m",
          "test: seed failing baseline",
        ],
        { cwd: baseline.root },
      );
      const blocked = await startFounderDelivery({
        root: baseline.root,
        prdPath: "product/PRD.md",
        attended: true,
        draftPr: false,
      });
      expect(blocked.stage).toBe("baseline_blocked");
      expect(blocked.nextAction).toContain("baseline failure");
    } finally {
      await baseline.cleanup();
    }
  });
});
