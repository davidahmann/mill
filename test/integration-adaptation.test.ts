import { describe, expect, it } from "vitest";
import { adaptationManifestSchema } from "../src/contracts/schemas.js";
import {
  assessAdaptation,
  adaptationEvidence,
} from "../src/planning/adaptation.js";

const hash = `sha256:${"a".repeat(64)}`;
const ref = { path: "quality/fixture.json", digest: hash };
function manifest() {
  return adaptationManifestSchema.parse({
    schemaVersion: "1",
    id: "provider-migration",
    owner: "integration-owner",
    provider: { id: "example", from: "v1", to: "v2", notice: ref },
    applicability: {
      statement: "The integration uses the retired route.",
      evidence: ref,
    },
    workflows: ["assign-owner"],
    configurations: [{ id: "standard", revision: "1", fixture: ref }],
    fixtures: {
      kind: "synthetic",
      capturedAt: "2026-09-09T00:00:00.000Z",
      expiresAt: "2026-10-09T00:00:00.000Z",
    },
    matrix: [
      {
        workflowId: "assign-owner",
        configurationId: "standard",
        disposition: "check",
        scenarioId: "SCN-OWNER",
        commandId: "owner-standard",
      },
    ],
  });
}
const now = new Date("2026-09-09T12:00:00.000Z");
const selected = {
  commandIds: ["owner-standard"],
  requiredCommandIds: ["owner-standard"],
  scenarios: [{ id: "SCN-OWNER", executionRef: "owner-standard" }],
};

describe("integration adaptation evidence", () => {
  it("binds actual command results to explicit configuration coverage without claiming live compatibility", () => {
    const plan = manifest();
    expect(assessAdaptation(plan, selected, now)).toEqual([]);
    const evidence = adaptationEvidence(plan, hash, [
      {
        commandId: "owner-standard",
        required: true,
        status: "passed",
        exitCode: 0,
        durationMs: 1,
        outputDigest: hash,
      },
    ]);
    expect(evidence.assurance).toBe("offline_fixture_execution");
    expect(evidence.ownerAcceptance).toBe("not_recorded");
    expect(evidence.matrix[0]).toMatchObject({
      configurationId: "standard",
      status: "passed",
      outputDigest: hash,
    });
  });
  it("does not turn absent or failed command execution into passing evidence", () => {
    expect(adaptationEvidence(manifest(), hash, []).matrix[0]?.status).toBe(
      "blocked",
    );
    expect(
      adaptationEvidence(manifest(), hash, [
        {
          commandId: "owner-standard",
          required: true,
          status: "failed",
          exitCode: 1,
          durationMs: 1,
          outputDigest: hash,
        },
      ]).matrix[0]?.status,
    ).toBe("failed");
  });
  it("marks results blocked when fixture evidence expires during verification", () => {
    const plan = manifest();
    const now = new Date("2026-11-01T00:00:00.000Z");
    const result = adaptationEvidence(
      plan,
      hash,
      [
        {
          commandId: "owner-standard",
          required: true,
          status: "passed",
          exitCode: 0,
          durationMs: 1,
          outputDigest: hash,
        },
      ],
      now,
    );
    expect(result.matrix[0]).toMatchObject({
      status: "blocked",
      reason: "Fixture evidence expired before verification completed.",
    });
  });
  it("rejects missing and duplicate pairs, unknown profiles, optional commands and stale fixtures", () => {
    const plan = manifest();
    expect(
      assessAdaptation({ ...plan, matrix: [] }, selected, now).length,
    ).toBeGreaterThan(0);
    expect(
      assessAdaptation(
        { ...plan, matrix: [...plan.matrix, ...plan.matrix] },
        selected,
        now,
      ).length,
    ).toBeGreaterThan(0);
    expect(
      assessAdaptation({ ...plan, configurations: [] }, selected, now).length,
    ).toBeGreaterThan(0);
    expect(
      assessAdaptation(plan, { ...selected, requiredCommandIds: [] }, now)
        .length,
    ).toBeGreaterThan(0);
    expect(
      assessAdaptation(plan, selected, new Date("2026-11-01")).length,
    ).toBeGreaterThan(0);
  });
});

// The lifecycle below uses deterministic process adapters. The attended canary
// separately exercises real Codex and OCI; these tests assert authority routing.
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach } from "vitest";
import { parse, stringify } from "yaml";
import {
  millConfigSchema,
  taskPacketV2Schema,
} from "../src/contracts/schemas.js";
import { loadRuntimeInputs, textDigest } from "../src/runtime/inputs.js";
import {
  qualifyBaseline,
  startLocalRun,
  verifyRun,
  reviewRun,
} from "../src/runtime/lifecycle.js";
import { runtimeFixture } from "./runtime-fixture.js";

const execute = promisify(execFile);
const saved = {
  MILL_STATE_HOME: process.env.MILL_STATE_HOME,
  MILL_CODEX_PATH: process.env.MILL_CODEX_PATH,
  MILL_DOCKER_PATH: process.env.MILL_DOCKER_PATH,
};
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) Reflect.deleteProperty(process.env, key);
    else process.env[key] = value;
  }
});
async function prepared() {
  const fixture = await runtimeFixture();
  process.env.MILL_STATE_HOME = fixture.stateHome;
  process.env.MILL_CODEX_PATH = fixture.codexPath;
  process.env.MILL_DOCKER_PATH = fixture.dockerPath;
  const taskFile = path.join(fixture.root, fixture.taskPath);
  const task = taskPacketV2Schema.parse(
    parse(await readFile(taskFile, "utf8")),
  );
  const config = millConfigSchema.parse(
    parse(await readFile(path.join(fixture.root, "mill.yaml"), "utf8")),
  );
  const originalCommand = config.commands.test;
  if (originalCommand === undefined) throw new Error("fixture missing test");
  config.commands.target = { ...originalCommand, argv: ["node", "target"] };
  task.commandIds.push("target");
  task.baselineCommandIds = ["test"];
  const fixtureText = '{"owner":"sales"}\n';
  await writeFile(path.join(fixture.root, "quality/fixture.json"), fixtureText);
  const plan = manifest();
  const bound = {
    path: "quality/fixture.json",
    digest: textDigest(fixtureText),
  };
  plan.provider.notice = bound;
  plan.applicability.evidence = bound;
  const firstConfiguration = plan.configurations[0];
  if (firstConfiguration === undefined)
    throw new Error("adaptation fixture has no configuration");
  firstConfiguration.fixture = bound;
  plan.matrix = [
    {
      workflowId: "assign-owner",
      configurationId: "standard",
      disposition: "check",
      scenarioId: "SCN-POSITIVE",
      commandId: "test",
    },
  ];
  plan.fixtures.capturedAt = new Date(Date.now() - 1000).toISOString();
  plan.fixtures.expiresAt = new Date(Date.now() + 3600000).toISOString();
  const planText = stringify(plan);
  await writeFile(path.join(fixture.root, "product/adaptation.yaml"), planText);
  task.contextPaths.push(bound.path);
  task.authority.adaptation = {
    path: "product/adaptation.yaml",
    digest: textDigest(planText),
  };
  await writeFile(taskFile, stringify(task));
  await writeFile(path.join(fixture.root, "mill.yaml"), stringify(config));
  const docker = await readFile(fixture.dockerPath, "utf8");
  await writeFile(
    fixture.dockerPath,
    docker.replace(
      "process.exit(/value",
      'if(args.at(-1)==="target" && /value = 1/u.test(value))process.exit(1);\nprocess.exit(/value',
    ),
  );
  await execute(
    "/usr/bin/git",
    [
      "-c",
      "user.name=Mill Test",
      "-c",
      "user.email=test@example.invalid",
      "add",
      ".",
    ],
    { cwd: fixture.root },
  );
  await execute(
    "/usr/bin/git",
    [
      "-c",
      "user.name=Mill Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-m",
      "test: freeze adaptation",
    ],
    { cwd: fixture.root },
  );
  return { ...fixture, task, taskFile };
}

describe("adaptation lifecycle admission", () => {
  it("qualifies preservation, then executes the full candidate gate and reports exact matrix results", async () => {
    const fixture = await prepared();
    try {
      const input = { root: fixture.root, taskPath: fixture.taskPath };
      const baseline = await qualifyBaseline(input);
      expect(baseline.evidence.commands.map((item) => item.commandId)).toEqual([
        "test",
      ]);
      expect(baseline.evidence.adaptation).toBeUndefined();
      expect(baseline.approvalDigest).not.toBeNull();
      if (baseline.approvalDigest === null)
        throw new Error("baseline approval was unexpectedly absent");
      const started = await startLocalRun({
        ...input,
        approvalDigest: baseline.approvalDigest,
      });
      const runInput = { ...input, runId: started.run.id };
      const verified = await verifyRun(runInput);
      expect(verified.evidence.commands.map((item) => item.commandId)).toEqual([
        "test",
        "target",
      ]);
      expect(verified.evidence.passed).toBe(true);
      expect(verified.evidence.adaptation?.matrix[0]?.status).toBe("passed");
      expect((await reviewRun(runInput)).run.status).toBe("reviewed");
    } finally {
      await fixture.cleanup();
    }
  });
  it("retains the old default of running all commands at baseline", async () => {
    const fixture = await prepared();
    try {
      delete fixture.task.baselineCommandIds;
      await writeFile(fixture.taskFile, stringify(fixture.task));
      await execute(
        "/usr/bin/git",
        [
          "-c",
          "user.name=Mill Test",
          "-c",
          "user.email=test@example.invalid",
          "commit",
          "-am",
          "test: default baseline",
        ],
        { cwd: fixture.root },
      );
      const baseline = await qualifyBaseline({
        root: fixture.root,
        taskPath: fixture.taskPath,
      });
      expect(baseline.approvalDigest).toBeNull();
      expect(
        baseline.evidence.commands.find((item) => item.commandId === "target")
          ?.status,
      ).toBe("failed");
    } finally {
      await fixture.cleanup();
    }
  });
  it.each([
    { ids: ["test", "test"] },
    { ids: ["unknown"] },
    { ids: ["target"] },
  ])(
    "blocks invalid or preservation-omitting baseline selection %j",
    async ({ ids }) => {
      const fixture = await prepared();
      try {
        fixture.task.baselineCommandIds = ids;
        await writeFile(fixture.taskFile, stringify(fixture.task));
        await expect(
          loadRuntimeInputs(fixture.root, fixture.taskPath),
        ).rejects.toThrow();
      } finally {
        await fixture.cleanup();
      }
    },
  );
  it("rejects unfrozen or changed fixture bytes and builder overlap", async () => {
    const fixture = await prepared();
    try {
      fixture.task.contextPaths = fixture.task.contextPaths.filter(
        (item) => item !== "quality/fixture.json",
      );
      await writeFile(fixture.taskFile, stringify(fixture.task));
      await expect(
        loadRuntimeInputs(fixture.root, fixture.taskPath),
      ).rejects.toThrow(/inconsistent/u);
      fixture.task.contextPaths.push("quality/fixture.json");
      fixture.task.allowedPaths.push("quality/fixture.json");
      await writeFile(fixture.taskFile, stringify(fixture.task));
      await expect(
        loadRuntimeInputs(fixture.root, fixture.taskPath),
      ).rejects.toMatchObject({ code: "BOUND_INPUT_SCOPE_OVERLAP" });
      fixture.task.allowedPaths.pop();
      await writeFile(fixture.taskFile, stringify(fixture.task));
      await writeFile(
        path.join(fixture.root, "quality/fixture.json"),
        "changed\n",
      );
      await expect(
        loadRuntimeInputs(fixture.root, fixture.taskPath),
      ).rejects.toThrow(/inconsistent/u);
    } finally {
      await fixture.cleanup();
    }
  });
});

import { prepareDependencySnapshot } from "../src/runtime/dependencies.js";

describe("dependency-free native repositories", () => {
  it.each([
    { rootEntry: true, declared: false, passes: true },
    { rootEntry: false, declared: false, passes: false },
    { rootEntry: true, declared: true, passes: false },
  ])(
    "requires a proven empty root graph before materializing empty modules: %j",
    async ({ rootEntry, declared, passes }) => {
      const fixture = await runtimeFixture();
      process.env.MILL_DOCKER_PATH = fixture.dockerPath;
      try {
        await writeFile(
          fixture.dockerPath,
          `#!${process.execPath}\nprocess.exit(0);\n`,
        );
        await writeFile(
          path.join(fixture.root, "package.json"),
          JSON.stringify({
            name: "empty-fixture",
            ...(declared ? { dependencies: { example: "1.0.0" } } : {}),
          }),
        );
        await writeFile(
          path.join(fixture.root, "package-lock.json"),
          JSON.stringify({
            lockfileVersion: 3,
            packages: rootEntry ? { "": { name: "empty-fixture" } } : {},
          }),
        );
        const config = millConfigSchema.parse(
          parse(await readFile(path.join(fixture.root, "mill.yaml"), "utf8")),
        );
        const verifier = config.verifier;
        if (verifier === undefined) throw new Error("fixture verifier missing");
        verifier.dependencies = {
          manager: "npm",
          registry: "https://registry.npmjs.org",
          targetPath: "node_modules",
          lockPaths: ["package.json", "package-lock.json"],
        };
        const operation = prepareDependencySnapshot({
          root: fixture.root,
          stateDirectory: fixture.stateHome,
          config,
          attended: true,
        });
        if (passes) expect((await operation).reused).toBe(false);
        else
          await expect(operation).rejects.toMatchObject({
            code: "DEPENDENCY_OUTPUT_INVALID",
          });
      } finally {
        await fixture.cleanup();
      }
    },
  );
});
