import { execFile } from "node:child_process";
import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";

import { canonicalDigest, type JsonValue } from "../src/contracts/canonical.js";
import {
  adaptationManifestSchema,
  impactManifestSchema,
  millConfigSchema,
  productContractSchema,
  scenarioSetSchema,
  taskPacketV2Schema,
} from "../src/contracts/schemas.js";
import {
  qualifyBaseline,
  reviewRun,
  runOutcome,
  startLocalRun,
  verifyRun,
} from "../src/runtime/lifecycle.js";
import { textDigest } from "../src/runtime/inputs.js";
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

async function secondReplayFixture() {
  const fixture = await runtimeFixture({
    repositoryPrefix: "mill-webhook-adaptation-replay-",
  });
  process.env.MILL_STATE_HOME = fixture.stateHome;
  process.env.MILL_CODEX_PATH = fixture.codexPath;
  process.env.MILL_DOCKER_PATH = fixture.dockerPath;

  const initialSource = `export async function dispatch(provider, event) {
  const response = await provider.request('/v1/hooks', event);
  if (response.status === 403) throw new Error('permission denied');
  return provider.create({ event, idempotencyKey: event.id });
}
`;
  const migratedSource = `export async function dispatch(provider, event) {
  const response = await provider.request('/v2/events/' + encodeURIComponent(event.workspace), event);
  if (response.status === 403) throw new Error('permission denied');
  return provider.create({ event, idempotencyKey: event.id });
}
`;
  const notice =
    "Synthetic webhook provider retires /v1/hooks for /v2/events/{workspace}.\n";
  const scope =
    "src/dispatch.js calls the retired route for outbound customer events.\n";
  const standard = '{"id":"standard","workspace":"sales"}\n';
  const restricted = '{"id":"restricted","workspace":"finance"}\n';
  const capturedAt = new Date(Date.now() - 60_000).toISOString();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const reference = (file: string, content: string) => ({
    path: file,
    digest: textDigest(content),
  });
  const product = productContractSchema.parse({
    schemaVersion: "1",
    id: "webhook-adaptation",
    title: "Webhook adaptation replay",
    primaryUser: "Synthetic integration owner",
    jobToBeDone: "Preserve outbound event behavior across the provider change.",
    outcomes: [
      { id: "OUT-WEBHOOK-MIGRATION", statement: "Migrate webhook dispatch." },
    ],
    nonGoals: ["Live provider and customer acceptance"],
    assumptions: ["Deterministic synthetic verifier only"],
    unknowns: [],
    sourceRefs: ["SRC-PRD"],
    acceptance: [
      {
        id: "ACC-IDEMPOTENCY",
        kind: "functional",
        statement: "Preserve idempotency and permission propagation.",
        sourceRefs: ["SRC-PRD"],
      },
      {
        id: "ACC-STANDARD-WEBHOOK",
        kind: "functional",
        statement: "Dispatch the standard configuration through the v2 route.",
        sourceRefs: ["SRC-PRD"],
      },
      {
        id: "ACC-RESTRICTED-WEBHOOK",
        kind: "functional",
        statement: "Reject a restricted configuration before a write.",
        sourceRefs: ["SRC-PRD"],
      },
    ],
    invariants: [
      {
        id: "INV-WEBHOOK-IDEMPOTENCY",
        statement: "Repeated events retain the same idempotency key.",
        owner: "repository",
        criticality: "high",
        surfaceRefs: ["src/dispatch.js"],
        verification: { mode: "command", ref: "preservation" },
        sourceRefs: ["SRC-PRD"],
        unknowns: [],
      },
    ],
    decisions: [],
  });
  const productText = stringify(product);
  const productDigest = canonicalDigest(product as unknown as JsonValue);
  const scenarios = scenarioSetSchema.parse({
    schemaVersion: "1",
    productContractDigest: productDigest,
    scenarios: [
      {
        id: "SCN-IDEMPOTENCY",
        kind: "exception",
        given: ["A repeated or forbidden event."],
        when: ["The preservation command runs."],
        then: ["No duplicate write occurs and permission failure propagates."],
        oracleOwner: "repository",
        acceptanceRefs: ["ACC-IDEMPOTENCY"],
        invariantRefs: ["INV-WEBHOOK-IDEMPOTENCY"],
        coverage: "preservation",
        visibility: "builder_visible",
        executionRef: "preservation",
        forbidden: ["Change acceptance inputs"],
      },
      {
        id: "SCN-STANDARD-WEBHOOK",
        kind: "normal",
        given: ["The standard synthetic configuration."],
        when: ["The target command runs."],
        then: ["The v2 route is used."],
        oracleOwner: "repository",
        acceptanceRefs: ["ACC-STANDARD-WEBHOOK"],
        invariantRefs: [],
        coverage: "new_behavior",
        visibility: "builder_visible",
        executionRef: "target",
        forbidden: ["Change acceptance inputs"],
      },
      {
        id: "SCN-RESTRICTED-WEBHOOK",
        kind: "exception",
        given: ["The restricted synthetic configuration."],
        when: ["The restricted command runs."],
        then: ["Permission failure occurs before a write."],
        oracleOwner: "repository",
        acceptanceRefs: ["ACC-RESTRICTED-WEBHOOK"],
        invariantRefs: [],
        coverage: "new_behavior",
        visibility: "builder_visible",
        executionRef: "restricted",
        forbidden: ["Change acceptance inputs"],
      },
    ],
  });
  const scenarioText = stringify(scenarios);
  const impactProposal = {
    schemaVersion: "1",
    id: "webhook-migration",
    productContractDigest: productDigest,
    outcomeId: "OUT-WEBHOOK-MIGRATION",
    riskClass: "medium",
    acceptanceIds: [
      "ACC-IDEMPOTENCY",
      "ACC-STANDARD-WEBHOOK",
      "ACC-RESTRICTED-WEBHOOK",
    ],
    affectedInvariantIds: ["INV-WEBHOOK-IDEMPOTENCY"],
    uncertainInvariantIds: [],
    surfaces: [
      {
        id: "src/dispatch.js",
        kind: "system",
        change: "Migrate the synthetic webhook route.",
      },
    ],
    scenarioIds: [
      "SCN-IDEMPOTENCY",
      "SCN-STANDARD-WEBHOOK",
      "SCN-RESTRICTED-WEBHOOK",
    ],
    commandIds: ["preservation", "target", "restricted"],
    materialDecisions: [],
    unresolved: [],
    exceptions: [],
    approval: null,
  } as const;
  const impact = impactManifestSchema.parse({
    ...impactProposal,
    approval: {
      approvedBy: "synthetic-replay-maintainer",
      approvedAt: "2026-09-11T12:00:00.000Z",
      proposalDigest: canonicalDigest(impactProposal),
    },
  });
  const impactText = stringify(impact);
  const adaptation = adaptationManifestSchema.parse({
    schemaVersion: "1",
    id: "synthetic-webhook-v2",
    owner: "synthetic-replay-owner",
    provider: {
      id: "synthetic-webhooks",
      from: "v1",
      to: "v2",
      notice: reference("quality/provider-notice.md", notice),
    },
    applicability: {
      statement: "The synthetic dispatcher calls the retired v1 webhook route.",
      evidence: reference("quality/applicability.md", scope),
    },
    workflows: ["dispatch-follow-up"],
    configurations: [
      {
        id: "standard",
        revision: "1",
        fixture: reference("quality/standard.json", standard),
      },
      {
        id: "restricted",
        revision: "1",
        fixture: reference("quality/restricted.json", restricted),
      },
    ],
    fixtures: {
      kind: "synthetic",
      capturedAt,
      expiresAt,
    },
    matrix: [
      {
        workflowId: "dispatch-follow-up",
        configurationId: "standard",
        disposition: "check",
        scenarioId: "SCN-STANDARD-WEBHOOK",
        commandId: "target",
      },
      {
        workflowId: "dispatch-follow-up",
        configurationId: "restricted",
        disposition: "check",
        scenarioId: "SCN-RESTRICTED-WEBHOOK",
        commandId: "restricted",
      },
    ],
  });
  const adaptationText = stringify(adaptation);
  const config = millConfigSchema.parse(
    parse(await readFile(path.join(fixture.root, "mill.yaml"), "utf8")),
  );
  const command = config.commands.test;
  if (command === undefined) throw new Error("fixture lacks a test command");
  config.commands = {
    preservation: { ...command, argv: ["node", "preservation"] },
    target: { ...command, argv: ["node", "target"] },
    restricted: { ...command, argv: ["node", "restricted"] },
  };
  const policy =
    "Only src/dispatch.js may change. Acceptance inputs are frozen.\n";
  const task = taskPacketV2Schema.parse({
    schemaVersion: "2",
    id: "webhook-migration",
    title: "Migrate synthetic webhook dispatch",
    objective:
      "Use the v2 route while preserving idempotency and permission failures.",
    riskClass: "medium",
    baseRef: "HEAD",
    authority: {
      productContract: reference("product/contract.yaml", productText),
      scenarioSet: reference("quality/scenarios.yaml", scenarioText),
      policy: reference("WORKFLOW.md", policy),
      impactManifest: reference("product/impact.yaml", impactText),
      adaptation: reference("product/adaptation.yaml", adaptationText),
    },
    contextPaths: [
      "quality/provider-notice.md",
      "quality/applicability.md",
      "quality/standard.json",
      "quality/restricted.json",
    ],
    allowedPaths: ["src/dispatch.js"],
    commandIds: ["preservation", "target", "restricted"],
    baselineCommandIds: ["preservation"],
    acceptance: [
      {
        id: "ACC-IDEMPOTENCY",
        statement: "Preserve idempotency and permission propagation.",
        invariantIds: ["INV-WEBHOOK-IDEMPOTENCY"],
        scenarioIds: ["SCN-IDEMPOTENCY"],
        coverage: "preservation",
        evidence: { mode: "command", commandId: "preservation" },
      },
      {
        id: "ACC-STANDARD-WEBHOOK",
        statement: "Dispatch the standard configuration through the v2 route.",
        invariantIds: [],
        scenarioIds: ["SCN-STANDARD-WEBHOOK"],
        coverage: "new_behavior",
        evidence: { mode: "command", commandId: "target" },
      },
      {
        id: "ACC-RESTRICTED-WEBHOOK",
        statement: "Reject a restricted configuration before a write.",
        invariantIds: [],
        scenarioIds: ["SCN-RESTRICTED-WEBHOOK"],
        coverage: "new_behavior",
        evidence: { mode: "command", commandId: "restricted" },
      },
    ],
    commit: {
      message: "fix: adapt synthetic webhook route to v2",
      authorName: "Mill Replay",
      authorEmail: "replay@example.invalid",
    },
    budget: { deadlineSeconds: 60, maxOutputBytes: 1048576, retryCount: 1 },
  });

  await Promise.all([
    writeFile(path.join(fixture.root, "src/dispatch.js"), initialSource),
    writeFile(path.join(fixture.root, "WORKFLOW.md"), policy),
    writeFile(path.join(fixture.root, "product/contract.yaml"), productText),
    writeFile(path.join(fixture.root, "product/impact.yaml"), impactText),
    writeFile(
      path.join(fixture.root, "product/adaptation.yaml"),
      adaptationText,
    ),
    writeFile(path.join(fixture.root, "quality/scenarios.yaml"), scenarioText),
    writeFile(path.join(fixture.root, "quality/provider-notice.md"), notice),
    writeFile(path.join(fixture.root, "quality/applicability.md"), scope),
    writeFile(path.join(fixture.root, "quality/standard.json"), standard),
    writeFile(path.join(fixture.root, "quality/restricted.json"), restricted),
    writeFile(path.join(fixture.root, fixture.taskPath), stringify(task)),
    writeFile(path.join(fixture.root, "mill.yaml"), stringify(config)),
  ]);
  await writeFile(
    fixture.codexPath,
    `#!${process.execPath}
import { writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("codex-cli replay-fixture"); process.exit(0); }
if (args[0] === "login") { console.log("Logged in using ChatGPT"); process.exit(0); }
if (args.includes("--approve-for-me") || !args.includes("--ignore-rules")) process.exit(2);
if (!args.some((value, index) => value === "-c" && args[index + 1] === 'approval_policy="never"')) process.exit(2);
const sandbox = args.indexOf("--sandbox");
if (sandbox < 0 || args[sandbox + 1] !== (args.includes("--output-schema") ? "read-only" : "workspace-write")) process.exit(2);
const cwd = args[args.indexOf("--cd") + 1];
let prompt = ""; for await (const chunk of process.stdin) prompt += chunk;
if (args.includes("--output-schema")) {
  const candidateCommit = execFileSync("/usr/bin/git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
  const scope = JSON.parse(prompt.split("Review scope JSON: ")[1]?.split("\\n")[0] ?? "null");
  const output = args[args.indexOf("--output-last-message") + 1];
  await writeFile(output, JSON.stringify({ schemaVersion: "1", candidateCommit, scope, summary: "clean", findings: [] }), { mode: 0o600 });
  console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } }));
} else {
  await writeFile(path.join(cwd, "src/dispatch.js"), ${JSON.stringify(migratedSource)});
  console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } }));
}
`,
  );
  await chmod(fixture.codexPath, 0o755);
  await writeFile(
    fixture.dockerPath,
    `#!${process.execPath}
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("Docker version 29.7.2"); process.exit(0); }
if (args[0] === "image" && args[1] === "inspect") { console.log("[]"); process.exit(0); }
if (args[0] === "rm") process.exit(0);
const mount = args.find((value) => value.includes("target=/workspace/src,readonly")) ?? "";
const source = /source=([^,]+)/u.exec(mount)?.[1];
const command = args.at(-1);
if (!source) process.exit(2);
const { dispatch } = await import(pathToFileURL(path.join(source, "dispatch.js")).href);
const event = { id: "event-1", workspace: "sales" };
let writes = 0;
const created = new Set();
const provider = {
  request: async (route) => ({ status: 200, route }),
  create: async ({ idempotencyKey }) => {
    if (!created.has(idempotencyKey)) writes += 1;
    created.add(idempotencyKey);
    return { idempotencyKey };
  },
};
if (command === "preservation") {
  await dispatch(provider, event);
  await dispatch(provider, event);
  assert.equal(writes, 1);
  let forbiddenWrites = 0;
  await assert.rejects(
    dispatch(
      { request: async () => ({ status: 403 }), create: async () => { forbiddenWrites += 1; } },
      event,
    ),
    /permission denied/u,
  );
  assert.equal(forbiddenWrites, 0);
} else if (command === "target") {
  let route = "";
  await dispatch(
    { ...provider, request: async (value) => { route = value; return { status: 200 }; } },
    event,
  );
  assert.equal(route, "/v2/events/sales");
} else if (command === "restricted") {
  let restrictedWrites = 0;
  await assert.rejects(
    dispatch(
      {
        request: async (_route, input) => {
          assert.equal(input.workspace, "finance");
          return { status: 403 };
        },
        create: async () => { restrictedWrites += 1; },
      },
      { id: "event-restricted", workspace: "finance" },
    ),
    /permission denied/u,
  );
  assert.equal(restrictedWrites, 0);
} else process.exit(2);
`,
  );
  await chmod(fixture.dockerPath, 0o755);
  await execute(
    "/usr/bin/git",
    [
      "-c",
      "user.name=Mill Replay",
      "-c",
      "user.email=replay@example.invalid",
      "add",
      ".",
    ],
    { cwd: fixture.root },
  );
  await execute(
    "/usr/bin/git",
    [
      "-c",
      "user.name=Mill Replay",
      "-c",
      "user.email=replay@example.invalid",
      "commit",
      "-m",
      "test: freeze synthetic webhook adaptation",
    ],
    { cwd: fixture.root },
  );
  return fixture;
}

describe("second synthetic integration adaptation replay", () => {
  it("runs an independent provider transition and configuration matrix through the lifecycle", async () => {
    const fixture = await secondReplayFixture();
    try {
      const input = { root: fixture.root, taskPath: fixture.taskPath };
      const baseline = await qualifyBaseline(input);
      expect(baseline.approvalDigest).not.toBeNull();
      if (baseline.approvalDigest === null)
        throw new Error("second replay baseline did not qualify");
      const started = await startLocalRun({
        ...input,
        approvalDigest: baseline.approvalDigest,
      });
      const runInput = { ...input, runId: started.run.id };
      const verified = await verifyRun(runInput);
      expect(verified.evidence.adaptation?.matrix).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            configurationId: "standard",
            status: "passed",
          }),
          expect.objectContaining({
            configurationId: "restricted",
            status: "passed",
          }),
        ]),
      );
      await expect(reviewRun(runInput)).resolves.toMatchObject({
        run: { status: "reviewed" },
      });
      await expect(
        runOutcome({ root: fixture.root, runId: started.run.id }),
      ).resolves.toMatchObject({
        integrity: { status: "consistent", reasons: [] },
        validation: {
          adaptation: {
            provider: { id: "synthetic-webhooks", from: "v1", to: "v2" },
            configurations: [
              { id: "standard", revision: "1" },
              { id: "restricted", revision: "1" },
            ],
          },
        },
        ownerAcceptance: "not_recorded",
      });
    } finally {
      await fixture.cleanup();
    }
  });
});
