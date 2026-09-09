import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import { canonicalDigest, MILL_VERSION } from "../../dist/index.js";

// A synthetic provider contract, not a claim about an actual vendor API.
// Preparation alone does not launch a worker, install packages or access a forge.
if (!process.argv.includes("--attended"))
  throw new Error("Fixture preparation requires --attended.");
const root = await mkdtemp(path.join(tmpdir(), "mill-adaptation-fixture-"));
const image =
  "node@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e";
const digest = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const files = {};
const put = (file, text) => {
  files[file] = typeof text === "string" ? text : stringify(text);
};
const now = new Date();
const profiles = [
  {
    id: "standard",
    ownerKey: "sales",
    owners: [{ key: "sales", user: { id: "owner-sales" } }],
    expectedOwner: "owner-sales",
  },
  {
    id: "custom",
    ownerKey: "finance",
    owners: [
      { key: "sales", user: { id: "owner-sales" } },
      { key: "finance", user: { id: "owner-finance" } },
    ],
    expectedOwner: "owner-finance",
  },
  {
    id: "fallback",
    ownerKey: "missing",
    owners: [],
    expectedOwner: "owner-default",
  },
];
put(".gitignore", "node_modules/\n");
put(
  "src/onboard.ts",
  `type Config = { workspace: string; ownerKey: string; defaultOwner: string };
type Provider = { request(route: string): Promise<any>; create(kind: string, input: Record<string, string>, key: string): Promise<string> };
export async function onboard(customerId: string, config: Config, provider: Provider) {
  const response = await provider.request('/v1/owners');
  const owner = response.owners.find((item: { externalId: string; ownerId: string }) => item.externalId === config.ownerKey)?.ownerId ?? config.defaultOwner;
  const workspace = await provider.create('workspace', { customerId }, 'workspace:' + customerId);
  await provider.create('task', { workspace, owner }, 'followup:' + customerId);
  return { workspace, owner };
}
`,
);
put(
  "quality/provider-notice.md",
  `# Synthetic provider change\n\nQualification fixture only. The old GET /v1/owners route is retired.\nUse GET /v2/workspaces/{encoded workspace}/owners. Responses change from\n{owners:[{externalId,ownerId}]} to {results:[{key,user:{id}}]}.\nPermissions failures must propagate before any write. Preserve configured\nowner mapping, fallback when the mapping is absent, and idempotency keys.\nNo live provider, customer data or external network is involved.\n`,
);
put(
  "quality/applicability.md",
  "# Applicability\n\nsrc/onboard.ts calls /v1/owners and reads response.owners.\nThe three fixture profiles exercise standard, custom and absent owner mappings.\n",
);
for (const profile of profiles)
  put(
    `quality/${profile.id}.json`,
    JSON.stringify(
      { ...profile, workspace: "sales / east", defaultOwner: "owner-default" },
      null,
      2,
    ) + "\n",
  );
put(
  "test/preservation.mjs",
  `import assert from 'node:assert/strict';
import { onboard } from '../src/onboard.ts';
const writes = new Map();
const provider = {
 request: async () => ({ owners: [{externalId:'sales',ownerId:'owner-sales'}], results: [{key:'sales',user:{id:'owner-sales'}}] }),
 create: async (kind, input, key) => { if (!writes.has(key)) writes.set(key, {kind, input}); return key; }
};
const config = { workspace:'main', ownerKey:'sales', defaultOwner:'owner-default' };
await onboard('c1',config,provider); await onboard('c1',config,provider);
assert.equal(writes.size,2); assert.equal(writes.get('followup:c1').input.owner,'owner-sales');
const denied = { ...provider, request: async () => { throw new Error('403 forbidden'); } };
await assert.rejects(onboard('denied',config,denied),/403/);
assert.equal(writes.size,2);
console.log('preservation: idempotency and no writes on permission failure passed');
`,
);
put(
  "test/compatibility.mjs",
  `import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { onboard } from '../src/onboard.ts';
const profile = JSON.parse(await readFile(new URL('../quality/'+process.argv[2]+'.json',import.meta.url),'utf8'));
const writes = new Map(); const calls = [];
const provider = {
 request: async (route) => { calls.push(route); assert.equal(route,'/v2/workspaces/'+encodeURIComponent(profile.workspace)+'/owners'); return {results:profile.owners}; },
 create: async (kind,input,key) => { if (!writes.has(key)) writes.set(key,{kind,input}); return key; }
};
const result = await onboard('customer-1',profile,provider);
await onboard('customer-1',profile,provider);
assert.equal(result.owner,profile.expectedOwner);
assert.equal(writes.size,2); assert.equal(writes.get('followup:customer-1').input.owner,profile.expectedOwner);
assert.equal(calls.length,2);
const denied = { ...provider, request: async () => { throw new Error('403 forbidden'); } };
await assert.rejects(onboard('denied',profile,denied),/403/); assert.equal(writes.size,2);
console.log(profile.id+': target route, owner mapping, duplicate prevention and permission failure passed');
`,
);
const scripts = {
  "test:preservation": "node test/preservation.mjs",
  ...Object.fromEntries(
    profiles.map((profile) => [
      `test:${profile.id}`,
      `node test/compatibility.mjs ${profile.id}`,
    ]),
  ),
};
scripts.test = Object.keys(scripts)
  .map((name) => `npm run ${name}`)
  .join(" && ");
const pkg = {
  name: "mill-integration-adaptation-fixture",
  version: "1.0.0",
  private: true,
  type: "module",
  scripts,
};
put("package.json", JSON.stringify(pkg, null, 2) + "\n");
put(
  "package-lock.json",
  JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      lockfileVersion: 3,
      requires: true,
      packages: { "": { name: pkg.name, version: pkg.version } },
    },
    null,
    2,
  ) + "\n",
);
put(
  "WORKFLOW.md",
  "# Synthetic qualification policy\n\nChange only src/onboard.ts. The maintainer froze the provider contract and native checks before execution. Do not alter tests, fixtures, commands, authority or dependency inputs. No network, credentials, commits, forge or release actions by the builder.\n",
);
put(
  "product/PRD.md",
  "# Integration adaptation fixture\n\nMigrate the synthetic owners API while preserving approved onboarding mappings, idempotency and failure behavior. This is engineering qualification only.\n",
);
const acceptance = [
  {
    id: "ACC-PRESERVE",
    statement: "Preserve idempotency and no writes on permission failure.",
    command: "preservation",
    coverage: "preservation",
    scenario: "SCN-PRESERVE",
    kind: "exception",
  },
  ...profiles.map((p) => ({
    id: `ACC-${p.id.toUpperCase()}`,
    statement: `The ${p.id} configuration works with the target provider contract.`,
    command: p.id,
    coverage: "new_behavior",
    scenario: `SCN-${p.id.toUpperCase()}`,
    kind: "normal",
  })),
];
const product = {
  schemaVersion: "1",
  id: "onboarding",
  title: "Onboarding adaptation",
  primaryUser: "Synthetic integration owner",
  jobToBeDone: "Preserve agreed onboarding while provider contracts change.",
  outcomes: [
    { id: "OUT-MIGRATE", statement: "Complete the bounded owners migration." },
  ],
  nonGoals: ["Live provider or customer acceptance"],
  assumptions: ["Synthetic fixture fidelity only"],
  unknowns: [],
  sourceRefs: ["SRC-PRD"],
  acceptance: acceptance.map((a) => ({
    id: a.id,
    kind: "functional",
    statement: a.statement,
    sourceRefs: ["SRC-PRD"],
  })),
  invariants: [
    {
      id: "INV-NO-DUPLICATE",
      statement: acceptance[0].statement,
      owner: "repository",
      criticality: "medium",
      surfaceRefs: ["src/onboard.ts"],
      verification: { mode: "command", ref: "preservation" },
      sourceRefs: ["SRC-PRD"],
      unknowns: [],
    },
  ],
  decisions: [],
};
put("product/contract.yaml", product);
const productDigest = canonicalDigest(product);
put("quality/scenarios.yaml", {
  schemaVersion: "1",
  productContractDigest: productDigest,
  scenarios: acceptance.map((a) => ({
    id: a.scenario,
    kind: a.kind,
    given: ["The frozen synthetic provider and configuration."],
    when: [`Run native command ${a.command}.`],
    then: [a.statement],
    oracleOwner: "repository",
    acceptanceRefs: [a.id],
    invariantRefs: a.command === "preservation" ? ["INV-NO-DUPLICATE"] : [],
    coverage: a.coverage,
    visibility: "builder_visible",
    executionRef: a.command,
    forbidden: ["Acceptance modification"],
  })),
});
const impact = {
  schemaVersion: "1",
  id: "owners-migration",
  productContractDigest: productDigest,
  outcomeId: "OUT-MIGRATE",
  riskClass: "medium",
  acceptanceIds: acceptance.map((a) => a.id),
  affectedInvariantIds: ["INV-NO-DUPLICATE"],
  uncertainInvariantIds: [],
  surfaces: [
    {
      id: "src/onboard.ts",
      kind: "system",
      change: "Migrate owner lookup route and response mapping.",
    },
  ],
  scenarioIds: acceptance.map((a) => a.scenario),
  commandIds: acceptance.map((a) => a.command),
  materialDecisions: [],
  unresolved: [],
  exceptions: [],
  approval: null,
};
put("product/impact.yaml", {
  ...impact,
  approval: {
    approvedBy: "attended-qualification-maintainer",
    approvedAt: now.toISOString(),
    proposalDigest: canonicalDigest(impact),
  },
});
const reference = (file) => ({ path: file, digest: digest(files[file]) });
const adaptation = {
  schemaVersion: "1",
  id: "synthetic-owners-v2",
  owner: "synthetic-fixture-owner",
  provider: {
    id: "synthetic-owners",
    from: "v1",
    to: "v2",
    notice: reference("quality/provider-notice.md"),
  },
  applicability: {
    statement: "src/onboard.ts uses the retired v1 lookup and response shape.",
    evidence: reference("quality/applicability.md"),
  },
  workflows: ["onboard"],
  configurations: profiles.map((p) => ({
    id: p.id,
    revision: "1",
    fixture: reference(`quality/${p.id}.json`),
  })),
  fixtures: {
    kind: "synthetic",
    capturedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 86400000).toISOString(),
  },
  matrix: profiles.map((p) => ({
    workflowId: "onboard",
    configurationId: p.id,
    disposition: "check",
    scenarioId: `SCN-${p.id.toUpperCase()}`,
    commandId: p.id,
  })),
};
put("product/adaptation.yaml", adaptation);
const controls = ["package.json", "package-lock.json", "test/**", "quality/**"];
const config = {
  schemaVersion: "1",
  repositoryId: randomUUID(),
  trustCeiling: "build",
  sensitivePaths: [".env", ".npmrc"],
  verifier: {
    image,
    network: "none",
    dependencies: {
      manager: "npm",
      registry: "https://registry.npmjs.org",
      targetPath: "node_modules",
      lockPaths: ["package.json", "package-lock.json"],
    },
  },
  commands: Object.fromEntries(
    acceptance.map((a) => [
      a.command,
      {
        argv: ["/usr/local/bin/npm", "run", `test:${a.command}`],
        cwd: ".",
        controlPaths: controls,
        capability: "test",
        execution: "oci",
        required: true,
        timeoutSeconds: 30,
      },
    ]),
  ),
};
put("adoption.yaml", config);
put("product/tasks/migrate.yaml", {
  schemaVersion: "2",
  id: "owners-migration",
  title: "Migrate the synthetic onboarding owner lookup",
  objective:
    "Implement the frozen provider notice in src/onboard.ts. Keep owner selection correct for all three profiles, preserve idempotency keys, propagate permission failures before writes, and change no acceptance inputs.",
  riskClass: "medium",
  baseRef: "HEAD",
  authority: {
    productContract: reference("product/contract.yaml"),
    scenarioSet: reference("quality/scenarios.yaml"),
    policy: reference("WORKFLOW.md"),
    impactManifest: reference("product/impact.yaml"),
    adaptation: reference("product/adaptation.yaml"),
  },
  contextPaths: [
    "quality/provider-notice.md",
    "quality/applicability.md",
    ...profiles.map((p) => `quality/${p.id}.json`),
    "test/preservation.mjs",
    "test/compatibility.mjs",
  ],
  allowedPaths: ["src/onboard.ts"],
  commandIds: acceptance.map((a) => a.command),
  baselineCommandIds: ["preservation"],
  acceptance: acceptance.map((a) => ({
    id: a.id,
    statement: a.statement,
    invariantIds: a.command === "preservation" ? ["INV-NO-DUPLICATE"] : [],
    scenarioIds: [a.scenario],
    coverage: a.coverage,
    evidence: { mode: "command", commandId: a.command },
  })),
  commit: {
    message: "fix: adapt onboarding owner lookup to v2",
    authorName: "Mill Qualification",
    authorEmail: "qualification@example.invalid",
  },
  budget: { deadlineSeconds: 1800, maxOutputBytes: 1048576, retryCount: 1 },
});
for (const [file, text] of Object.entries(files)) {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), text);
}
const git = (args) =>
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Mill Qualification",
      "-c",
      "user.email=qualification@example.invalid",
      ...args,
    ],
    { cwd: root, stdio: "pipe" },
  );
git(["init", "-b", "main"]);
git(["add", "."]);
git(["commit", "-m", "test: freeze synthetic adaptation acceptance"]);
const base = git(["rev-parse", "HEAD"]).toString().trim();
// Keep this readback separate from Mill's independently approved adopt-native apply.
process.stdout.write(
  JSON.stringify({
    root,
    base,
    image,
    taskPath: "product/tasks/migrate.yaml",
    adoptionConfig: "adoption.yaml",
    millVersion: MILL_VERSION,
    preparedFiles: Object.keys(files).length,
    sourceDigest: digest(await readFile(path.join(root, "src/onboard.ts"))),
  }) + "\n",
);
