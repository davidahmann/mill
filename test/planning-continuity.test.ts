import { mkdir, readFile, writeFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import { canonicalDigest, type JsonValue } from "../src/contracts/canonical.js";
import {
  impactManifestSchema,
  blueprintSchema,
  productContractSchema,
  scenarioSetSchema,
  sourceManifestSchema,
  specificationProposalSchema,
  taskPacketSchema,
} from "../src/contracts/schemas.js";
import {
  assessImpactManifest,
  buildSemanticEvidence,
  loadImpactPlanningInputs,
  semanticClaimDigest,
} from "../src/planning/impact.js";
import {
  assertNewRunTaskContract,
  loadRuntimeInputs,
  textDigest,
} from "../src/runtime/inputs.js";
import {
  assessSpecificationProposal,
  promoteSpecificationProposal,
  semanticProposalDiff,
} from "../src/planning/specification.js";
import { MillError } from "../src/errors.js";
import { temporaryDirectory } from "./helpers.js";

const digest = (value: unknown) => canonicalDigest(value as JsonValue);

function continuityFixture() {
  const sources = sourceManifestSchema.parse({
    schemaVersion: "1",
    trigger: "bootstrap",
    providers: [
      {
        id: "operator-browser",
        name: "Operator supplied primary-source research",
        queries: [
          { id: "Q1", text: "supported Node release", purpose: "runtime pin" },
        ],
        networkDisclosure: "HTTPS reads of disclosed official sources only",
      },
    ],
    sources: [
      {
        id: "SRC-PRD",
        class: "user_evidence",
        uri: "product/PRD.md",
        revision: "sha256:prd",
        observedAt: "2026-09-02T00:00:00.000Z",
        freshness: "current",
        authority: "constraint",
        claims: ["The founder approves consequential decisions."],
      },
      {
        id: "SRC-NODE",
        class: "primary_documentation",
        uri: "https://nodejs.org/en/about/previous-releases",
        revision: "2026-09-02",
        observedAt: "2026-09-02T00:00:00.000Z",
        freshness: "current",
        authority: "evidence",
        claims: ["Node 24 is supported."],
      },
    ],
  });
  const product = productContractSchema.parse({
    schemaVersion: "1",
    id: "mill",
    title: "Mill",
    primaryUser: "Founder",
    jobToBeDone: "Deliver a reviewed outcome without losing prior behavior.",
    outcomes: ["Reviewed draft PR"],
    nonGoals: [],
    assumptions: [],
    unknowns: [],
    sourceRefs: ["SRC-PRD", "SRC-NODE"],
    acceptance: [
      {
        id: "ACC-DELIVERY",
        kind: "functional",
        statement: "One reviewed candidate preserves prior behavior.",
        sourceRefs: ["SRC-PRD"],
      },
    ],
    invariants: [
      {
        id: "INV-HUMAN-MERGE",
        statement: "Only the configured human authority merges a candidate.",
        owner: "maintainer",
        criticality: "critical",
        surfaceRefs: ["github-delivery"],
        verification: { mode: "command", ref: "test" },
        sourceRefs: ["SRC-PRD"],
        unknowns: [],
      },
    ],
    decisions: [
      {
        id: "DEC-NODE-24",
        kind: "architecture",
        question: "Which runtime is supported?",
        decision: "Use Node 24 LTS.",
        rationale: "It is the selected supported release.",
        sourceRefs: ["SRC-NODE"],
        status: "approved",
        costlyToReverse: true,
      },
    ],
  });
  const productDigest = digest(product);
  const scenarios = scenarioSetSchema.parse({
    schemaVersion: "1",
    productContractDigest: productDigest,
    scenarios: [
      {
        id: "SCN-NORMAL",
        kind: "normal",
        given: ["approved task"],
        when: ["the candidate is verified"],
        then: ["the delivered surface passes"],
        oracleOwner: "repository",
        acceptanceRefs: ["ACC-DELIVERY"],
        invariantRefs: ["INV-HUMAN-MERGE"],
        coverage: "both",
        visibility: "builder_visible",
        executionRef: "test",
      },
      {
        id: "SCN-RECOVERY",
        kind: "recovery",
        given: ["an interrupted operation"],
        when: ["the operator resumes"],
        then: ["no work is duplicated"],
        oracleOwner: "repository",
        acceptanceRefs: ["ACC-DELIVERY"],
        invariantRefs: ["INV-HUMAN-MERGE"],
        coverage: "preservation",
        visibility: "reviewer_owned",
        executionRef: "test",
      },
    ],
  });
  const prdDigest = `sha256:${"a".repeat(64)}`;
  const sourceManifestDigest = digest(sources);
  const proposal = specificationProposalSchema.parse({
    schemaVersion: "1",
    prd: { path: "product/PRD.md", digest: prdDigest },
    sourceManifestDigest,
    productContract: product,
    blueprints: [
      {
        schemaVersion: "1",
        id: "node-service",
        productContractDigest: productDigest,
        recipe: "node-typescript-service",
        recipeVersion: "1.0.0",
        runtime: "node-24",
        architecture: ["modular service"],
        risks: [],
      },
      {
        schemaVersion: "1",
        id: "node-package",
        productContractDigest: productDigest,
        recipe: "node-typescript-package",
        recipeVersion: "1.0.0",
        runtime: "node-24",
        architecture: ["modular package"],
        risks: [],
      },
    ],
    scenarioSet: scenarios,
    assumptions: [],
    contradictions: [],
    questions: [],
    status: "proposed",
  });
  const impactProposal = impactManifestSchema.parse({
    schemaVersion: "1",
    id: "wave-4a",
    productContractDigest: productDigest,
    outcomeId: "product-continuity",
    riskClass: "high",
    acceptanceIds: ["ACC-DELIVERY"],
    affectedInvariantIds: ["INV-HUMAN-MERGE"],
    uncertainInvariantIds: [],
    surfaces: [
      { id: "runtime", kind: "system", change: "Add semantic evidence." },
    ],
    scenarioIds: ["SCN-NORMAL", "SCN-RECOVERY"],
    commandIds: ["test"],
    materialDecisions: ["DEC-NODE-24"],
    unresolved: [],
    exceptions: [],
    approval: null,
  });
  const impact = impactManifestSchema.parse({
    ...impactProposal,
    approval: {
      approvedBy: "davidahmann",
      approvedAt: "2026-09-02T00:00:00.000Z",
      proposalDigest: digest(impactProposal),
    },
  });
  return {
    sources,
    product,
    scenarios,
    proposal,
    prdDigest,
    sourceManifestDigest,
    impact,
  };
}

describe("product continuity planning", () => {
  it("dogfoods the approved Mill continuity and selected web recipe contracts", async () => {
    const root = process.cwd();
    const inputs = await loadImpactPlanningInputs({
      root,
      productPath: "product/contract.yaml",
      scenarioPath: "quality/scenarios.yaml",
      impactPath: "product/impacts/WAVE_4A.yaml",
    });
    expect(assessImpactManifest(inputs)).toMatchObject({
      approved: true,
      blockers: [],
    });
    const sources = sourceManifestSchema.parse(
      parseYaml(await readFile("product/sources.yaml", "utf8")),
    );
    const prd = await readFile("product/PRD.md", "utf8");
    expect(
      sources.sources.find((source) => source.id === "SRC-PRD")?.revision,
    ).toBe(textDigest(prd));
    const blueprint = blueprintSchema.parse(
      parseYaml(
        await readFile("product/blueprints/node-typescript-web.yaml", "utf8"),
      ),
    );
    expect(blueprint).toMatchObject({
      productContractDigest: digest(inputs.product),
      recipe: "node-typescript-next-web",
      runtime: "node-24-active-lts",
    });
  });

  it("binds promotion to exact source-backed canonical bytes", () => {
    const fixture = continuityFixture();
    const assessment = assessSpecificationProposal({
      proposal: fixture.proposal,
      prdPath: "product/PRD.md",
      prdDigest: fixture.prdDigest,
      sourceManifest: fixture.sources,
      sourceManifestDigest: fixture.sourceManifestDigest,
    });
    expect(assessment).toMatchObject({ promotable: true, blockers: [] });
    expect(
      promoteSpecificationProposal({
        proposal: fixture.proposal,
        approvalDigest: assessment.proposalDigest,
        assessment,
      }).proposalDigest,
    ).toBe(assessment.proposalDigest);
    expect(() =>
      promoteSpecificationProposal({
        proposal: fixture.proposal,
        approvalDigest: `sha256:${"f".repeat(64)}`,
        assessment,
      }),
    ).toThrow(expect.objectContaining({ code: "PLANNING_APPROVAL_MISMATCH" }));
    const mutated = specificationProposalSchema.parse({
      ...fixture.proposal,
      productContract: {
        ...fixture.product,
        jobToBeDone: "An unapproved replacement job",
      },
    });
    expect(() =>
      promoteSpecificationProposal({
        proposal: mutated,
        approvalDigest: assessment.proposalDigest,
        assessment,
      }),
    ).toThrow(expect.objectContaining({ code: "PLANNING_APPROVAL_MISMATCH" }));
  });

  it("reports semantic regeneration drift without replacing approval", () => {
    const fixture = continuityFixture();
    const regenerated = specificationProposalSchema.parse({
      ...fixture.proposal,
      productContract: {
        ...fixture.product,
        jobToBeDone: "A changed job",
      },
    });
    expect(semanticProposalDiff(fixture.proposal, regenerated)).toEqual([
      "/productContract/jobToBeDone",
    ]);
  });

  it("blocks duplicate invariants and unresolved source references", () => {
    const fixture = continuityFixture();
    const proposal = specificationProposalSchema.parse({
      ...fixture.proposal,
      productContract: {
        ...fixture.product,
        invariants: [
          ...fixture.product.invariants,
          {
            ...fixture.product.invariants[0],
            id: "INV-DUPLICATE",
            sourceRefs: ["SRC-MISSING"],
          },
        ],
      },
    });
    const assessment = assessSpecificationProposal({
      proposal,
      prdPath: "product/PRD.md",
      prdDigest: fixture.prdDigest,
      sourceManifest: fixture.sources,
      sourceManifestDigest: fixture.sourceManifestDigest,
    });
    expect(assessment.promotable).toBe(false);
    expect(assessment.blockers.join("\n")).toContain("duplicated");
    expect(assessment.blockers.join("\n")).toContain("SRC-MISSING");
  });

  it("reports stale identity, unresolved graph, and approval blockers together", () => {
    const fixture = continuityFixture();
    const sources = sourceManifestSchema.parse({
      ...fixture.sources,
      sources: fixture.sources.sources.map((source) => ({
        ...source,
        freshness: "stale",
      })),
    });
    const proposal = specificationProposalSchema.parse({
      ...fixture.proposal,
      prd: { path: "other.md", digest: `sha256:${"b".repeat(64)}` },
      sourceManifestDigest: `sha256:${"c".repeat(64)}`,
      productContract: {
        ...fixture.product,
        sourceRefs: ["SRC-MISSING"],
        acceptance: [],
        invariants: [],
        decisions: fixture.product.decisions.map((decision) => ({
          ...decision,
          status: "proposed",
        })),
      },
      blueprints: fixture.proposal.blueprints.map((blueprint) => ({
        ...blueprint,
        productContractDigest: `sha256:${"d".repeat(64)}`,
      })),
      scenarioSet: {
        ...fixture.scenarios,
        productContractDigest: `sha256:${"e".repeat(64)}`,
        scenarios: [
          {
            ...fixture.scenarios.scenarios[0],
            id: "DEC-NODE-24",
            acceptanceRefs: ["ACC-MISSING"],
            invariantRefs: ["INV-MISSING"],
          },
          {
            ...fixture.scenarios.scenarios[1],
            acceptanceRefs: [],
            invariantRefs: [],
          },
        ],
      },
      assumptions: [
        {
          id: "ASM-1",
          statement: "Missing source",
          sourceRefs: ["SRC-MISSING"],
        },
      ],
      contradictions: [
        {
          id: "CON-1",
          statement: "Conflict",
          sourceRefs: ["SRC-PRD", "SRC-MISSING"],
          blocking: true,
        },
      ],
      questions: [
        {
          id: "QUE-1",
          prompt: "Choose",
          recommendedDefault: "Do not guess",
          reversible: false,
          blocking: true,
        },
      ],
    });
    const assessment = assessSpecificationProposal({
      proposal,
      prdPath: "product/PRD.md",
      prdDigest: fixture.prdDigest,
      sourceManifest: sources,
      sourceManifestDigest: digest(sources),
    });
    expect(assessment.promotable).toBe(false);
    expect(assessment.blockers).toEqual(
      expect.arrayContaining([
        "proposal PRD identity does not match the inspected input",
        "proposal source-manifest identity is stale",
        "product contract has no stable acceptance items",
        "product contract has no stable behavioral invariants",
        "stable ID is reused: DEC-NODE-24",
        "source reference is unresolved: SRC-MISSING",
        "decision is not approved: DEC-NODE-24",
        "blocking contradiction remains: CON-1",
        "blocking question remains: QUE-1",
        "scenario set is bound to another product contract",
      ]),
    );
    expect(assessment.warnings).toEqual(
      expect.arrayContaining([
        "source SRC-PRD freshness is stale",
        "source SRC-NODE freshness is stale",
      ]),
    );
    expect(() =>
      promoteSpecificationProposal({
        proposal,
        approvalDigest: assessment.proposalDigest,
        assessment,
      }),
    ).toThrow(expect.objectContaining({ code: "PLANNING_PROMOTION_BLOCKED" }));
  });
});

describe("impact and semantic evidence", () => {
  it("requires version 2 for new material work and exact approved task semantics", async () => {
    const fixture = continuityFixture();
    const legacy = taskPacketSchema.parse({
      schemaVersion: "1",
      id: "legacy-high-risk",
      title: "Legacy task",
      objective: "Resume only.",
      riskClass: "high",
      baseRef: "HEAD",
      authority: {
        productContract: { path: "product.json", digest: fixture.prdDigest },
        scenarioSet: { path: "scenarios.json", digest: fixture.prdDigest },
        policy: { path: "WORKFLOW.md", digest: fixture.prdDigest },
      },
      contextPaths: ["WORKFLOW.md"],
      allowedPaths: ["src/**"],
      commandIds: ["test"],
      acceptance: [{ id: "ACC-DELIVERY", statement: "Legacy evidence" }],
      commit: {
        message: "test: legacy",
        authorName: "Mill",
        authorEmail: "mill@example.invalid",
      },
      budget: { deadlineSeconds: 600, maxOutputBytes: 1048576, retryCount: 1 },
    });
    expect(() => assertNewRunTaskContract(legacy)).toThrow(
      expect.objectContaining({ code: "CONTINUITY_TASK_VERSION_REQUIRED" }),
    );

    const temporary = await temporaryDirectory("mill-continuity-task-");
    try {
      await mkdir(`${temporary.path}/product/tasks`, { recursive: true });
      await mkdir(`${temporary.path}/quality`, { recursive: true });
      await mkdir(`${temporary.path}/test`, { recursive: true });
      const productSource = JSON.stringify(fixture.product);
      const scenarioSource = JSON.stringify(fixture.scenarios);
      const impactSource = JSON.stringify(fixture.impact);
      const policy = "# Approved workflow\n";
      const task = {
        schemaVersion: "2",
        id: "continuity-binding",
        title: "Continuity binding",
        objective: "Reject weakened task semantics.",
        riskClass: "high",
        baseRef: "HEAD",
        authority: {
          productContract: {
            path: "product/contract.json",
            digest: textDigest(productSource),
          },
          scenarioSet: {
            path: "quality/scenarios.json",
            digest: textDigest(scenarioSource),
          },
          policy: { path: "WORKFLOW.md", digest: textDigest(policy) },
          impactManifest: {
            path: "product/impact.json",
            digest: textDigest(impactSource),
          },
        },
        contextPaths: ["WORKFLOW.md"],
        allowedPaths: ["src/**"],
        commandIds: ["test"],
        acceptance: [
          {
            id: "ACC-DELIVERY",
            statement: "Only require a zero exit.",
            invariantIds: ["INV-HUMAN-MERGE"],
            scenarioIds: [],
            coverage: "both",
            evidence: { mode: "command", commandId: "test" },
          },
        ],
        commit: {
          message: "test: reject weakened semantics",
          authorName: "Mill",
          authorEmail: "mill@example.invalid",
        },
        budget: {
          deadlineSeconds: 600,
          maxOutputBytes: 1048576,
          retryCount: 1,
        },
      };
      await Promise.all([
        writeFile(`${temporary.path}/product/contract.json`, productSource),
        writeFile(`${temporary.path}/quality/scenarios.json`, scenarioSource),
        writeFile(`${temporary.path}/product/impact.json`, impactSource),
        writeFile(`${temporary.path}/WORKFLOW.md`, policy),
        writeFile(`${temporary.path}/test/control.js`, "export {};\n"),
        writeFile(
          `${temporary.path}/mill.yaml`,
          JSON.stringify({
            schemaVersion: "1",
            repositoryId: "11111111-1111-4111-8111-111111111111",
            trustCeiling: "build",
            sensitivePaths: [],
            verifier: {
              image: `node@sha256:${"a".repeat(64)}`,
              network: "none",
            },
            commands: {
              test: {
                argv: ["node", "--test"],
                cwd: ".",
                controlPaths: ["test/control.js"],
                capability: "test",
                required: true,
                timeoutSeconds: 30,
                execution: "oci",
              },
            },
          }),
        ),
        writeFile(
          `${temporary.path}/product/tasks/continuity.json`,
          JSON.stringify(task),
        ),
      ]);
      let failure: unknown;
      try {
        await loadRuntimeInputs(
          temporary.path,
          "product/tasks/continuity.json",
        );
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(MillError);
      const continuityError = failure as MillError;
      expect(continuityError.code).toBe("CONTINUITY_AUTHORITY_BLOCKED");
      expect(continuityError.details.blockers).toEqual(
        expect.arrayContaining([
          "task acceptance statement differs from product contract: ACC-DELIVERY",
          "task scenario graph differs from approved impact: ACC-DELIVERY",
        ]),
      );
    } finally {
      await temporary.cleanup();
    }
  });

  it("approves exact impact and separates new behavior from preservation", () => {
    const fixture = continuityFixture();
    expect(
      assessImpactManifest({
        manifest: fixture.impact,
        product: fixture.product,
        scenarios: fixture.scenarios,
        now: new Date("2026-09-02T00:00:01.000Z"),
      }),
    ).toMatchObject({ approved: true, blockers: [] });
    const task = taskPacketSchema.parse({
      schemaVersion: "2",
      id: "continuity",
      title: "Continuity",
      objective: "Preserve delivery authority.",
      riskClass: "high",
      baseRef: "HEAD",
      authority: {
        productContract: {
          path: "product/contract.yaml",
          digest: fixture.prdDigest,
        },
        scenarioSet: {
          path: "quality/scenarios.yaml",
          digest: fixture.prdDigest,
        },
        policy: { path: "WORKFLOW.md", digest: fixture.prdDigest },
        impactManifest: {
          path: "product/impact.yaml",
          digest: fixture.prdDigest,
        },
      },
      contextPaths: ["WORKFLOW.md"],
      allowedPaths: ["src/**"],
      commandIds: ["test"],
      acceptance: [
        {
          id: "ACC-DELIVERY",
          statement: "One reviewed candidate preserves prior behavior.",
          invariantIds: ["INV-HUMAN-MERGE"],
          scenarioIds: ["SCN-NORMAL", "SCN-RECOVERY"],
          coverage: "both",
          evidence: { mode: "command", commandId: "test" },
        },
      ],
      commit: {
        message: "feat: preserve continuity",
        authorName: "Mill",
        authorEmail: "mill@example.invalid",
      },
      budget: { deadlineSeconds: 600, maxOutputBytes: 1048576, retryCount: 1 },
    });
    const passing = buildSemanticEvidence({
      task,
      manifest: fixture.impact,
      product: fixture.product,
      scenarios: fixture.scenarios,
      commandResults: [{ commandId: "test", status: "passed" }],
    });
    expect(passing).toMatchObject({
      newBehaviorPassed: true,
      preservationPassed: true,
      passed: true,
    });
    const negativeControl = buildSemanticEvidence({
      task,
      manifest: fixture.impact,
      product: fixture.product,
      scenarios: fixture.scenarios,
      commandResults: [{ commandId: "test", status: "failed" }],
    });
    expect(negativeControl).toMatchObject({
      newBehaviorPassed: false,
      preservationPassed: false,
      passed: false,
    });
  });

  it("does not let a generic passing command certify another scenario oracle", () => {
    const fixture = continuityFixture();
    const scenarios = scenarioSetSchema.parse({
      ...fixture.scenarios,
      scenarios: fixture.scenarios.scenarios.map((scenario) => ({
        ...scenario,
        executionRef: "scenario-specific-check",
      })),
    });
    const task = taskPacketSchema.parse({
      schemaVersion: "2",
      id: "continuity-negative-control",
      title: "Continuity negative control",
      objective: "Reject unrelated command evidence.",
      riskClass: "high",
      baseRef: "HEAD",
      authority: {
        productContract: {
          path: "product/contract.yaml",
          digest: fixture.prdDigest,
        },
        scenarioSet: {
          path: "quality/scenarios.yaml",
          digest: fixture.prdDigest,
        },
        policy: { path: "WORKFLOW.md", digest: fixture.prdDigest },
        impactManifest: {
          path: "product/impact.yaml",
          digest: fixture.prdDigest,
        },
      },
      contextPaths: ["WORKFLOW.md"],
      allowedPaths: ["src/**"],
      commandIds: ["test"],
      acceptance: [
        {
          id: "ACC-DELIVERY",
          statement: "One reviewed candidate preserves prior behavior.",
          invariantIds: ["INV-HUMAN-MERGE"],
          scenarioIds: ["SCN-NORMAL", "SCN-RECOVERY"],
          coverage: "both",
          evidence: { mode: "command", commandId: "test" },
        },
      ],
      commit: {
        message: "test: reject unrelated evidence",
        authorName: "Mill",
        authorEmail: "mill@example.invalid",
      },
      budget: { deadlineSeconds: 600, maxOutputBytes: 1048576, retryCount: 1 },
    });
    expect(
      buildSemanticEvidence({
        task,
        manifest: fixture.impact,
        product: fixture.product,
        scenarios,
        commandResults: [{ commandId: "test", status: "passed" }],
      }),
    ).toMatchObject({ passed: false });
  });

  it("keeps human, unsupported, missing, and out-of-scope evidence distinct", () => {
    const fixture = continuityFixture();
    const product = productContractSchema.parse({
      ...fixture.product,
      acceptance: [
        ...fixture.product.acceptance,
        ...["HUMAN", "UNSUPPORTED", "OUTSIDE", "FUTURE"].map((id) => ({
          id: `ACC-${id}`,
          kind: "operational",
          statement: `${id} evidence statement`,
          sourceRefs: ["SRC-PRD"],
        })),
      ],
      invariants: [
        ...fixture.product.invariants,
        {
          id: "INV-HUMAN",
          statement: "A human verifies this invariant.",
          owner: "operator",
          criticality: "high",
          surfaceRefs: ["approval"],
          verification: { mode: "human", ref: "operator-attestation" },
          sourceRefs: ["SRC-PRD"],
          unknowns: [],
        },
        {
          id: "INV-UNSUPPORTED",
          statement: "This invariant has no qualified verifier.",
          owner: "operator",
          criticality: "high",
          surfaceRefs: ["unknown"],
          verification: { mode: "unsupported", ref: "not-qualified" },
          sourceRefs: ["SRC-PRD"],
          unknowns: ["verifier"],
        },
      ],
    });
    const scenarios = scenarioSetSchema.parse({
      schemaVersion: "1",
      productContractDigest: digest(product),
      scenarios: [
        {
          id: "SCN-HUMAN",
          kind: "authority",
          given: ["human approval"],
          when: ["the approval is checked"],
          then: ["the decision is attested"],
          oracleOwner: "human",
          acceptanceRefs: ["ACC-HUMAN"],
          invariantRefs: ["INV-HUMAN"],
          coverage: "new_behavior",
          visibility: "human_acceptance",
        },
        {
          id: "SCN-REPOSITORY-NO-ORACLE",
          kind: "degradation",
          given: ["no executable oracle"],
          when: ["semantic validation runs"],
          then: ["the scenario blocks"],
          oracleOwner: "repository",
          acceptanceRefs: ["ACC-OUTSIDE"],
          invariantRefs: ["INV-UNSUPPORTED"],
          coverage: "preservation",
          visibility: "reviewer_owned",
        },
      ],
    });
    const manifest = impactManifestSchema.parse({
      schemaVersion: "1",
      id: "evidence-dispositions",
      productContractDigest: digest(product),
      outcomeId: "evidence",
      riskClass: "high",
      acceptanceIds: [
        "ACC-DELIVERY",
        "ACC-HUMAN",
        "ACC-UNSUPPORTED",
        "ACC-OUTSIDE",
        "ACC-FUTURE",
      ],
      affectedInvariantIds: ["INV-HUMAN", "INV-UNSUPPORTED"],
      uncertainInvariantIds: ["INV-HUMAN-MERGE"],
      surfaces: [
        { id: "evidence", kind: "system", change: "Classify evidence" },
      ],
      scenarioIds: ["SCN-HUMAN", "SCN-REPOSITORY-NO-ORACLE"],
      commandIds: ["test"],
      materialDecisions: [],
      unresolved: [],
      exceptions: [
        {
          id: "EX-ACTIVE",
          scopeRefs: ["INV-HUMAN-MERGE"],
          reason: "Attended exception",
          approvedBy: "operator",
          approvedAt: "2026-09-01T00:00:00.000Z",
          expiresAt: "2026-09-03T00:00:00.000Z",
        },
      ],
      approval: null,
    });
    const task = taskPacketSchema.parse({
      schemaVersion: "2",
      id: "evidence-dispositions",
      title: "Evidence dispositions",
      objective: "Keep evidence states distinct.",
      riskClass: "high",
      baseRef: "HEAD",
      authority: {
        productContract: {
          path: "product/contract.yaml",
          digest: fixture.prdDigest,
        },
        scenarioSet: {
          path: "quality/scenarios.yaml",
          digest: fixture.prdDigest,
        },
        policy: { path: "WORKFLOW.md", digest: fixture.prdDigest },
        impactManifest: {
          path: "product/impact.yaml",
          digest: fixture.prdDigest,
        },
      },
      contextPaths: ["WORKFLOW.md"],
      allowedPaths: ["src/**"],
      commandIds: ["test"],
      attestations: [
        {
          id: "ATT-HUMAN",
          approvedBy: "operator",
          approvedAt: "2026-09-01T00:00:00.000Z",
          expiresAt: "2026-09-03T00:00:00.000Z",
          claims: [
            {
              kind: "acceptance",
              id: "ACC-HUMAN",
              digest: semanticClaimDigest("acceptance", "ACC-HUMAN", {
                statement: "HUMAN evidence statement",
              }),
            },
            {
              kind: "invariant",
              id: "INV-HUMAN",
              digest: semanticClaimDigest("invariant", "INV-HUMAN", {
                statement: "A human verifies this invariant.",
                verificationRef: "operator-attestation",
              }),
            },
            {
              kind: "scenario",
              id: "SCN-HUMAN",
              digest: semanticClaimDigest(
                "scenario",
                "SCN-HUMAN",
                scenarios.scenarios[0] as unknown as JsonValue,
              ),
            },
          ],
        },
        {
          id: "ATT-FUTURE",
          approvedBy: "operator",
          approvedAt: "2026-09-03T00:00:00.000Z",
          expiresAt: "2026-09-04T00:00:00.000Z",
          claims: [
            {
              kind: "acceptance",
              id: "ACC-FUTURE",
              digest: semanticClaimDigest("acceptance", "ACC-FUTURE", {
                statement: "FUTURE evidence statement",
              }),
            },
          ],
        },
      ],
      acceptance: [
        {
          id: "ACC-HUMAN",
          statement: "HUMAN evidence statement",
          invariantIds: ["INV-HUMAN"],
          scenarioIds: ["SCN-HUMAN"],
          coverage: "new_behavior",
          evidence: {
            mode: "human",
            attestationId: "ATT-HUMAN",
          },
        },
        {
          id: "ACC-UNSUPPORTED",
          statement: "UNSUPPORTED evidence statement",
          invariantIds: ["INV-UNSUPPORTED"],
          scenarioIds: [],
          coverage: "preservation",
          evidence: { mode: "unsupported", reason: "not qualified" },
        },
        {
          id: "ACC-OUTSIDE",
          statement: "OUTSIDE evidence statement",
          invariantIds: [],
          scenarioIds: ["SCN-REPOSITORY-NO-ORACLE"],
          coverage: "preservation",
          evidence: { mode: "command", commandId: "outside" },
        },
        {
          id: "ACC-FUTURE",
          statement: "FUTURE evidence statement",
          invariantIds: [],
          scenarioIds: [],
          coverage: "new_behavior",
          evidence: {
            mode: "human",
            attestationId: "ATT-FUTURE",
          },
        },
      ],
      commit: {
        message: "test: classify evidence",
        authorName: "Mill",
        authorEmail: "mill@example.invalid",
      },
      budget: { deadlineSeconds: 600, maxOutputBytes: 1048576, retryCount: 1 },
    });
    const evidence = buildSemanticEvidence({
      task,
      manifest,
      product,
      scenarios,
      commandResults: [{ commandId: "test", status: "passed" }],
      now: new Date("2026-09-02T00:00:00.000Z"),
    });
    expect(evidence.passed).toBe(false);
    expect(evidence.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "ACC-DELIVERY", status: "blocked" }),
        expect.objectContaining({ id: "ACC-HUMAN", status: "attested" }),
        expect.objectContaining({ id: "ACC-UNSUPPORTED", status: "blocked" }),
        expect.objectContaining({
          id: "ACC-OUTSIDE",
          status: "blocked",
          reason: "declared command is outside approved impact",
        }),
        expect.objectContaining({ id: "ACC-FUTURE", status: "blocked" }),
        expect.objectContaining({ id: "INV-HUMAN", status: "attested" }),
        expect.objectContaining({ id: "INV-UNSUPPORTED", status: "blocked" }),
        expect.objectContaining({
          id: "INV-HUMAN-MERGE",
          status: "attested",
        }),
        expect.objectContaining({ id: "SCN-HUMAN", status: "attested" }),
        expect.objectContaining({
          id: "SCN-REPOSITORY-NO-ORACLE",
          status: "blocked",
        }),
      ]),
    );
    if (task.schemaVersion !== "2") throw new Error("expected version 2 task");
    const acceptanceOnly = taskPacketSchema.parse({
      ...task,
      attestations: task.attestations.map((attestation) =>
        attestation.id === "ATT-HUMAN"
          ? { ...attestation, claims: [attestation.claims[0]] }
          : attestation,
      ),
    });
    const unscoped = buildSemanticEvidence({
      task: acceptanceOnly,
      manifest,
      product,
      scenarios,
      commandResults: [{ commandId: "test", status: "passed" }],
      now: new Date("2026-09-02T00:00:00.000Z"),
    });
    expect(unscoped.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "ACC-HUMAN", status: "attested" }),
        expect.objectContaining({ id: "INV-HUMAN", status: "blocked" }),
        expect.objectContaining({ id: "SCN-HUMAN", status: "blocked" }),
      ]),
    );
  });

  it("blocks uncertain impact without a scoped active exception", () => {
    const fixture = continuityFixture();
    const manifest = impactManifestSchema.parse({
      ...fixture.impact,
      affectedInvariantIds: [],
      uncertainInvariantIds: ["INV-HUMAN-MERGE"],
      approval: null,
    });
    const approved = impactManifestSchema.parse({
      ...manifest,
      approval: {
        approvedBy: "davidahmann",
        approvedAt: "2026-09-02T00:00:00.000Z",
        proposalDigest: digest(manifest),
      },
    });
    const assessment = assessImpactManifest({
      manifest: approved,
      product: fixture.product,
      scenarios: fixture.scenarios,
      now: new Date("2026-09-02T00:00:01.000Z"),
    });
    expect(assessment.approved).toBe(false);
    expect(assessment.blockers).toContain(
      "uncertain invariant lacks an approved exception: INV-HUMAN-MERGE",
    );
  });

  it("rejects unrelated negative scenarios and future-dated exceptions", () => {
    const fixture = continuityFixture();
    const product = productContractSchema.parse({
      ...fixture.product,
      acceptance: [
        ...fixture.product.acceptance,
        {
          id: "ACC-UNRELATED",
          kind: "quality",
          statement: "An unrelated behavior remains available.",
          sourceRefs: ["SRC-PRD"],
        },
      ],
      invariants: [
        ...fixture.product.invariants,
        {
          ...fixture.product.invariants[0],
          id: "INV-UNRELATED",
          statement: "An unrelated invariant remains true.",
        },
      ],
    });
    const scenarios = scenarioSetSchema.parse({
      ...fixture.scenarios,
      productContractDigest: digest(product),
      scenarios: fixture.scenarios.scenarios.map((scenario) =>
        scenario.id === "SCN-RECOVERY"
          ? {
              ...scenario,
              acceptanceRefs: ["ACC-UNRELATED"],
              invariantRefs: ["INV-UNRELATED"],
            }
          : scenario,
      ),
    });
    const proposal = impactManifestSchema.parse({
      ...fixture.impact,
      productContractDigest: digest(product),
      affectedInvariantIds: [],
      uncertainInvariantIds: ["INV-HUMAN-MERGE"],
      exceptions: [
        {
          id: "EX-FUTURE",
          scopeRefs: ["INV-HUMAN-MERGE"],
          reason: "Not active yet",
          approvedBy: "operator",
          approvedAt: "2026-09-03T00:00:00.000Z",
          expiresAt: "2026-09-04T00:00:00.000Z",
        },
      ],
      approval: null,
    });
    const manifest = impactManifestSchema.parse({
      ...proposal,
      approval: {
        approvedBy: "operator",
        approvedAt: "2026-09-02T00:00:00.000Z",
        proposalDigest: digest(proposal),
      },
    });
    expect(
      assessImpactManifest({
        manifest,
        product,
        scenarios,
        now: new Date("2026-09-02T12:00:00.000Z"),
      }).blockers,
    ).toEqual(
      expect.arrayContaining([
        "selected scenario is outside impact closure: SCN-RECOVERY",
        "impact exception is not active yet: EX-FUTURE",
        "uncertain invariant lacks an approved exception: INV-HUMAN-MERGE",
      ]),
    );
  });

  it("fails closed on stale, duplicate, unresolved, and under-tested impact", () => {
    const fixture = continuityFixture();
    const product = productContractSchema.parse({
      ...fixture.product,
      decisions: fixture.product.decisions.map((decision) => ({
        ...decision,
        status: "proposed",
      })),
    });
    const scenarios = scenarioSetSchema.parse({
      ...fixture.scenarios,
      productContractDigest: `sha256:${"a".repeat(64)}`,
      scenarios: fixture.scenarios.scenarios.map((scenario) => ({
        ...scenario,
        kind: "normal",
        executionRef: undefined,
      })),
    });
    const manifest = impactManifestSchema.parse({
      schemaVersion: "1",
      id: "invalid-impact",
      productContractDigest: `sha256:${"b".repeat(64)}`,
      outcomeId: "invalid",
      riskClass: "high",
      acceptanceIds: ["ACC-MISSING", "ACC-MISSING"],
      affectedInvariantIds: ["INV-MISSING", "INV-HUMAN-MERGE"],
      uncertainInvariantIds: ["INV-HUMAN-MERGE"],
      surfaces: [{ id: "runtime", kind: "system", change: "Unknown change" }],
      scenarioIds: ["SCN-MISSING", "SCN-MISSING"],
      commandIds: ["missing", "missing"],
      materialDecisions: ["DEC-MISSING", "DEC-NODE-24"],
      unresolved: ["migration ownership"],
      exceptions: [
        {
          id: "EX-OLD",
          scopeRefs: ["INV-HUMAN-MERGE"],
          reason: "Expired",
          approvedBy: "operator",
          approvedAt: "2026-08-01T00:00:00.000Z",
          expiresAt: "2026-08-02T00:00:00.000Z",
        },
      ],
      approval: null,
    });
    const assessment = assessImpactManifest({
      manifest,
      product,
      scenarios,
      now: new Date("2026-09-02T00:00:00.000Z"),
    });
    expect(assessment.approved).toBe(false);
    expect(assessment.blockers).toEqual(
      expect.arrayContaining([
        "impact manifest is bound to another product contract",
        "scenario set is bound to another product contract",
        "acceptance references are duplicated",
        "scenario references are duplicated",
        "command references are duplicated",
        "acceptance is unresolved: ACC-MISSING",
        "invariant is unresolved: INV-MISSING",
        "invariant cannot be both affected and uncertain: INV-HUMAN-MERGE",
        "scenario is unresolved: SCN-MISSING",
        "decision is unresolved: DEC-MISSING",
        "decision is not approved: DEC-NODE-24",
        "impact exception is expired: EX-OLD",
        "unresolved impact lacks an approved exception: migration ownership",
        "medium/high risk impact lacks a delivered-surface scenario",
        "medium/high risk impact lacks a non-normal scenario",
        "impact manifest is not human approved",
      ]),
    );

    const mismatchedApproval = impactManifestSchema.parse({
      ...manifest,
      approval: {
        approvedBy: "operator",
        approvedAt: "2026-09-02T00:00:00.000Z",
        proposalDigest: `sha256:${"f".repeat(64)}`,
      },
    });
    expect(
      assessImpactManifest({
        manifest: mismatchedApproval,
        product,
        scenarios,
      }).blockers,
    ).toContain("impact approval is not bound to the exact proposal");

    const duplicateProduct = productContractSchema.parse({
      ...fixture.product,
      acceptance: [
        ...fixture.product.acceptance,
        fixture.product.acceptance[0],
      ],
    });
    expect(
      assessImpactManifest({
        manifest: fixture.impact,
        product: duplicateProduct,
        scenarios: fixture.scenarios,
      }).blockers,
    ).toContain(`stable ID is reused: ${fixture.product.acceptance[0]?.id}`);

    const unboundCommands = impactManifestSchema.parse({
      ...fixture.impact,
      commandIds: ["outside"],
      approval: null,
    });
    expect(
      assessImpactManifest({
        manifest: unboundCommands,
        product: fixture.product,
        scenarios: fixture.scenarios,
      }).blockers,
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("scenario command is outside approved impact"),
        expect.stringContaining("invariant command is outside approved impact"),
      ]),
    );
  });
});
