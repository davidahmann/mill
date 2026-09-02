import { readFile } from "node:fs/promises";
import path from "node:path";

import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { canonicalDigest, type JsonValue } from "../src/contracts/canonical.js";
import { contractSchemas } from "../src/contracts/schemas.js";

const digest = `sha256:${"a".repeat(64)}`;
const samples = {
  sourceManifest: {
    schemaVersion: "1",
    trigger: "bootstrap",
    providers: [
      {
        id: "operator",
        name: "Operator research",
        queries: [{ id: "Q1", text: "Node support", purpose: "runtime pin" }],
        networkDisclosure: "Official documentation only",
      },
    ],
    sources: [
      {
        id: "SRC-PRD",
        class: "user_evidence",
        uri: "product/PRD.md",
        revision: digest,
        observedAt: "2026-09-02T12:00:00.000Z",
        freshness: "current",
        authority: "constraint",
        claims: ["A founder needs reviewed delivery."],
      },
    ],
  },
  managedRepository: {
    schemaVersion: "1",
    id: "123e4567-e89b-12d3-a456-426614174000",
    forgeHost: "github.com",
    owner: "example",
    repository: "app",
    canonicalBranch: "main",
    remoteName: "origin",
    remoteUrl: "https://github.com/example/app.git",
    trustCeiling: "inspect",
  },
  productContract: {
    schemaVersion: "1",
    id: "product",
    title: "Product",
    primaryUser: "Founder",
    jobToBeDone: "Ship an outcome",
    outcomes: [{ id: "OUT-REVIEWED-PR", statement: "Reviewed PR" }],
    nonGoals: [],
    assumptions: [],
    unknowns: [],
    sourceRefs: ["product/PRD.md"],
  },
  specificationProposal: {
    schemaVersion: "1",
    prd: { path: "product/PRD.md", digest },
    sourceManifestDigest: digest,
    productContract: {
      schemaVersion: "1",
      id: "product",
      title: "Product",
      primaryUser: "Founder",
      jobToBeDone: "Ship an outcome",
      outcomes: [{ id: "OUT-REVIEWED-PR", statement: "Reviewed PR" }],
      nonGoals: [],
      assumptions: [],
      unknowns: [],
      sourceRefs: ["SRC-PRD"],
    },
    blueprints: [
      {
        schemaVersion: "1",
        id: "node-service",
        productContractDigest: digest,
        recipe: "node-service",
        recipeVersion: "1",
        runtime: "node-24",
        architecture: ["modular monolith"],
        risks: [],
      },
    ],
    scenarioSet: {
      schemaVersion: "1",
      productContractDigest: digest,
      scenarios: [
        {
          id: "normal",
          kind: "normal",
          given: ["approved input"],
          when: ["run"],
          then: ["reviewed candidate"],
          oracleOwner: "repository",
        },
      ],
    },
    assumptions: [],
    contradictions: [],
    questions: [],
    status: "proposed",
  },
  blueprint: {
    schemaVersion: "1",
    id: "blueprint",
    productContractDigest: digest,
    recipe: "node-cli",
    recipeVersion: "1.0.0",
    runtime: "node-24",
    architecture: ["modular monolith"],
    risks: [],
  },
  scenarioSet: {
    schemaVersion: "1",
    productContractDigest: digest,
    scenarios: [
      {
        id: "normal",
        kind: "normal",
        given: ["approved input"],
        when: ["run"],
        then: ["reviewed candidate"],
        oracleOwner: "repository",
      },
    ],
  },
  outcomePlan: {
    schemaVersion: "1",
    productContractDigest: digest,
    outcomes: [
      {
        id: "o1",
        title: "Outcome",
        acceptance: ["works"],
        dependsOn: [],
        status: "approved",
      },
    ],
  },
  impactManifest: {
    schemaVersion: "1",
    id: "task-1",
    productContractDigest: digest,
    outcomeId: "OUT-REVIEWED-PR",
    riskClass: "low",
    acceptanceIds: ["A1"],
    affectedInvariantIds: [],
    uncertainInvariantIds: [],
    surfaces: [{ id: "cli", kind: "interface", change: "Add a command." }],
    scenarioIds: ["normal"],
    commandIds: ["test"],
    materialDecisions: [],
    unresolved: [],
    exceptions: [],
    approval: null,
  },
  millConfig: {
    schemaVersion: "1",
    repositoryId: "123e4567-e89b-12d3-a456-426614174000",
    trustCeiling: "inspect",
    commands: {
      test: {
        argv: ["npm", "test"],
        cwd: ".",
        controlPaths: ["package.json", "package-lock.json"],
        capability: "test",
      },
    },
  },
  deliveryRecord: {
    schemaVersion: "1",
    runId: "123e4567-e89b-42d3-a456-426614174000",
    deliveryKey: digest,
    proposalDigest: digest,
    approvalExpiresAt: "2026-09-01T12:15:00.000Z",
    state: "planned",
    target: {
      forge: "github",
      host: "github.com",
      owner: "example",
      repository: "app",
      repositoryNodeId: "R_example",
      cloneUrl: "https://github.com/example/app.git",
      remoteName: "origin",
      baseBranch: "main",
      actorLogin: "operator",
      actorId: 1,
    },
    branchName: "mill/task-123e4567",
    candidateCommit: "a".repeat(40),
    candidateTree: "b".repeat(40),
    requiredChecks: ["validate"],
    reviewPolicy: {
      mode: "local_only",
      requiredReviewerLogins: [],
    },
    allowedMergerLogins: ["operator"],
    allowedMergeMethods: ["linear_tree_preserving"],
    effects: [],
    remoteHeadCommit: null,
    pullRequest: null,
    observation: null,
    merge: null,
    lastErrorCode: null,
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-01T12:00:00.000Z",
  },
  millLock: {
    schemaVersion: "1",
    mill: { package: "@davidahmann/mill", version: "0.0.0-development" },
    schemaDigests: {},
  },
  taskPacket: {
    schemaVersion: "1",
    id: "task-1",
    title: "Implement one task",
    objective: "Produce one bounded candidate.",
    riskClass: "low",
    baseRef: "HEAD",
    authority: {
      productContract: { path: "product/contract.yaml", digest },
      scenarioSet: { path: "quality/scenarios.yaml", digest },
      policy: { path: "WORKFLOW.md", digest },
    },
    contextPaths: ["src/index.ts"],
    allowedPaths: ["src/**"],
    commandIds: ["test"],
    acceptance: [{ id: "A1", statement: "The test passes." }],
    commit: {
      message: "feat: implement task",
      authorName: "Mill",
      authorEmail: "mill@example.invalid",
    },
    budget: {
      deadlineSeconds: 600,
      maxOutputBytes: 1048576,
      retryCount: 1,
    },
  },
  contextManifest: {
    schemaVersion: "1",
    taskDigest: digest,
    baseCommit: "a".repeat(40),
    provider: "openai",
    adapter: "codex-cli",
    authOwner: "operator",
    isolation: "attended-trusted-host",
    modelIdentity: "provider-mutable",
    included: [{ path: "src/index.ts", digest }],
    excludedPatterns: [".env"],
    disclosure: ["approved context"],
  },
  workerProfile: {
    schemaVersion: "1",
    adapter: "codex-cli",
    role: "builder",
    contractVersion: "1",
    harnessVersion: "0.0.0-development",
    promptTemplateDigest: digest,
    modelIdentity: "provider-mutable",
    approvalPolicy: "never",
    sandbox: "workspace-write",
    session: "ephemeral",
    hostRules: "ignored",
    skillDiscovery: "disabled",
    toolDiscovery: "disabled",
    networkPosture: "provider-managed",
    capabilities: ["repository-write"],
    outputContract: "codex-jsonl-v1",
  },
  workerInvocation: {
    schemaVersion: "1",
    invocationId: "123e4567-e89b-42d3-a456-426614174001",
    runId: "123e4567-e89b-42d3-a456-426614174000",
    phase: "build",
    attempt: 1,
    taskDigest: digest,
    contextEpoch: digest,
    baseCommit: "a".repeat(40),
    profile: {
      schemaVersion: "1",
      adapter: "codex-cli",
      role: "builder",
      contractVersion: "1",
      harnessVersion: "0.0.0-development",
      promptTemplateDigest: digest,
      modelIdentity: "provider-mutable",
      approvalPolicy: "never",
      sandbox: "workspace-write",
      session: "ephemeral",
      hostRules: "ignored",
      skillDiscovery: "disabled",
      toolDiscovery: "disabled",
      networkPosture: "provider-managed",
      capabilities: ["repository-write"],
      outputContract: "codex-jsonl-v1",
    },
    profileDigest: digest,
    allowedPaths: ["src/**"],
    deadlineAt: "2026-09-02T12:15:00.000Z",
    maxOutputBytes: 1048576,
  },
  reviewResult: {
    schemaVersion: "1",
    candidateCommit: "a".repeat(40),
    summary: "clean",
    findings: [],
  },
  validationEvidence: {
    schemaVersion: "1",
    candidateCommit: "a".repeat(40),
    verifierImage: `node@${digest}`,
    network: "none",
    commands: [
      {
        commandId: "test",
        required: true,
        status: "passed",
        exitCode: 0,
        durationMs: 10,
        outputDigest: digest,
      },
    ],
    passed: true,
  },
  recipeManifest: {
    schemaVersion: "1",
    id: "node-typescript-next-web",
    version: "1.0.0",
    status: "supported",
    observedAt: "2026-09-02T14:15:00.000Z",
    runtime: { node: "24.18.1", npm: "11.16.0" },
    stack: {
      next: "16.3.4",
      react: "19.2.8",
      reactDom: "19.2.8",
      typescript: "6.0.3",
      eslint: "9.39.5",
      prettier: "3.9.6",
      vitest: "4.1.11",
      playwright: "1.62.1",
    },
    verifierImage: `playwright@${digest}`,
    registry: "https://registry.npmjs.org",
    licensePolicy: {
      allowed: ["MIT"],
      reviewedPackages: [{ name: "next", license: "MIT" }],
    },
    commands: { required: ["check"], native: ["check"] },
    oracles: [
      {
        id: "web-title-and-health",
        commandId: "check",
        evidencePaths: ["test/browser/home.spec.ts"],
        proves: ["the delivered web surface is healthy"],
      },
    ],
    writablePaths: [".mill-output", ".next"],
    sources: ["https://nextjs.org/docs"],
  },
  repositoryIntegrationPlan: {
    schemaVersion: "1",
    planDigest: digest,
    generator: { package: "@davidahmann/mill", version: "1.0.0" },
    mode: "greenfield",
    target: {
      directoryName: "product",
      canonicalPathDigest: digest,
      baseCommit: null,
      scanDigest: null,
    },
    productProposalDigest: digest,
    productContractDigest: digest,
    recipe: {
      id: "node-typescript-next-web",
      version: "1.0.0",
      digest,
      status: "supported",
      verifierImage: `playwright@${digest}`,
    },
    approval: {
      approvedBy: "David Ahmann",
      approvedAt: "2026-09-02T14:15:00.000Z",
    },
    files: [
      {
        path: "package.json",
        ownership: "generated_once",
        action: "create",
        contentDigest: digest,
        preexistingDigest: null,
      },
    ],
    commandIds: ["check"],
    networkDisclosure: ["HTTPS package installation"],
    baseline: "unverified",
  },
} as const;

const schemaFiles = {
  sourceManifest: "source-manifest.schema.json",
  managedRepository: "managed-repository.schema.json",
  productContract: "product-contract.schema.json",
  recipeManifest: "recipe-manifest.schema.json",
  repositoryIntegrationPlan: "repository-integration-plan.schema.json",
  specificationProposal: "specification-proposal.schema.json",
  blueprint: "blueprint.schema.json",
  scenarioSet: "scenario-set.schema.json",
  outcomePlan: "outcome-plan.schema.json",
  impactManifest: "impact-manifest.schema.json",
  millConfig: "mill-config.schema.json",
  deliveryRecord: "delivery-record.schema.json",
  millLock: "mill-lock.schema.json",
  taskPacket: "task-packet.schema.json",
  contextManifest: "context-manifest.schema.json",
  workerProfile: "worker-profile.schema.json",
  workerInvocation: "worker-invocation.schema.json",
  reviewResult: "review-result.schema.json",
  validationEvidence: "validation-evidence.schema.json",
} as const;

describe("compact schemas", () => {
  it("preserves legacy task bytes and requires explicit version 2 continuity", () => {
    const legacy = samples.taskPacket as unknown as JsonValue;
    const parsed = contractSchemas.taskPacket.parse(samples.taskPacket);
    expect(parsed).toEqual(samples.taskPacket);
    expect(canonicalDigest(parsed as unknown as JsonValue)).toBe(
      canonicalDigest(legacy),
    );
    expect(
      contractSchemas.taskPacket.safeParse({
        ...samples.taskPacket,
        schemaVersion: "2",
      }).success,
    ).toBe(false);
    const legacyContext = samples.contextManifest as unknown as JsonValue;
    const parsedContext = contractSchemas.contextManifest.parse(
      samples.contextManifest,
    );
    expect(parsedContext).toEqual(samples.contextManifest);
    expect(canonicalDigest(parsedContext as unknown as JsonValue)).toBe(
      canonicalDigest(legacyContext),
    );
  });

  it("keeps executable JSON Schemas aligned with runtime validators", async () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    ajv.addFormat(
      "uuid",
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
    );
    ajv.addFormat("uri", (value) => {
      try {
        void new URL(value);
        return true;
      } catch {
        return false;
      }
    });
    ajv.addFormat("date-time", (value) => Number.isFinite(Date.parse(value)));
    ajv.addFormat("email", /^[^\s@]+@[^\s@]+$/u);
    expect(Object.keys(schemaFiles).sort()).toEqual(
      Object.keys(contractSchemas).sort(),
    );
    for (const kind of Object.keys(
      schemaFiles,
    ) as (keyof typeof schemaFiles)[]) {
      const source = await readFile(
        path.join("schemas", schemaFiles[kind]),
        "utf8",
      );
      const validate = ajv.compile(JSON.parse(source));
      expect(validate(samples[kind]), JSON.stringify(validate.errors)).toBe(
        true,
      );
      expect(contractSchemas[kind].safeParse(samples[kind]).success).toBe(true);
      const withUnknown = { ...samples[kind], unexpected: true };
      expect(validate(withUnknown)).toBe(false);
      expect(contractSchemas[kind].safeParse(withUnknown).success).toBe(false);
    }
  });

  it("rejects duplicate outcome acceptance references in both validators", async () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const validate = ajv.compile(
      JSON.parse(
        await readFile(
          path.join("schemas", "product-contract.schema.json"),
          "utf8",
        ),
      ),
    );
    const duplicate = {
      ...samples.productContract,
      outcomes: [
        {
          id: "OUT-REVIEWED-PR",
          statement: "Reviewed PR",
          acceptanceIds: ["ACC-ONE", "ACC-ONE"],
        },
      ],
    };
    expect(validate(duplicate)).toBe(false);
    expect(contractSchemas.productContract.safeParse(duplicate).success).toBe(
      false,
    );
  });

  it("rejects mutable or local Mill lock selectors in both validators", async () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const validate = ajv.compile(
      JSON.parse(
        await readFile(path.join("schemas", "mill-lock.schema.json"), "utf8"),
      ),
    );
    for (const version of ["latest", "^1.2.3", "file:../mill.tgz", "01.2.3"]) {
      const candidate = {
        schemaVersion: "1",
        mill: { package: "@davidahmann/mill", version },
      };
      expect(validate(candidate), version).toBe(false);
      expect(
        contractSchemas.millLock.safeParse(candidate).success,
        version,
      ).toBe(false);
    }
  });

  it("keeps map-key constraints aligned between JSON and runtime schemas", async () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    ajv.addFormat(
      "uuid",
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
    );
    const millConfig = ajv.compile(
      JSON.parse(
        await readFile(path.join("schemas", "mill-config.schema.json"), "utf8"),
      ),
    );
    const legacyConfig = contractSchemas.millConfig.parse(samples.millConfig);
    expect(
      Object.hasOwn(legacyConfig.commands.test ?? {}, "writablePaths"),
    ).toBe(false);
    const configWithEmptyKey = {
      ...samples.millConfig,
      commands: {
        "": {
          argv: ["npm"],
          cwd: ".",
          controlPaths: ["package.json"],
          capability: "read",
        },
      },
    };
    expect(millConfig(configWithEmptyKey)).toBe(false);
    expect(
      contractSchemas.millConfig.safeParse(configWithEmptyKey).success,
    ).toBe(false);

    const configWithArgumentGlob = {
      ...samples.millConfig,
      commands: {
        test: {
          ...samples.millConfig.commands.test,
          argv: ["node", "--test", "test/**/*.test.ts"],
          controlPaths: ["test/**"],
        },
      },
    };
    expect(millConfig(configWithArgumentGlob)).toBe(true);
    expect(
      contractSchemas.millConfig.safeParse(configWithArgumentGlob).success,
    ).toBe(true);

    const configWithUnsafeControlPath = {
      ...samples.millConfig,
      commands: {
        test: {
          ...samples.millConfig.commands.test,
          controlPaths: ["../test"],
        },
      },
    };
    expect(millConfig(configWithUnsafeControlPath)).toBe(false);
    expect(
      contractSchemas.millConfig.safeParse(configWithUnsafeControlPath).success,
    ).toBe(false);

    for (const writablePath of ["nested/output", "scratch,output", "."]) {
      const configWithUnsupportedWritablePath = {
        ...samples.millConfig,
        commands: {
          test: {
            ...samples.millConfig.commands.test,
            writablePaths: [writablePath],
          },
        },
      };
      expect(millConfig(configWithUnsupportedWritablePath)).toBe(false);
      expect(
        contractSchemas.millConfig.safeParse(configWithUnsupportedWritablePath)
          .success,
      ).toBe(false);
    }

    const configWithUnsupportedDependencyTarget = {
      ...samples.millConfig,
      verifier: {
        image: `node@${digest}`,
        network: "none",
        dependencies: {
          manager: "npm",
          registry: "https://registry.npmjs.org",
          targetPath: "deps",
          lockPaths: ["package-lock.json"],
        },
      },
    };
    expect(millConfig(configWithUnsupportedDependencyTarget)).toBe(false);
    expect(
      contractSchemas.millConfig.safeParse(
        configWithUnsupportedDependencyTarget,
      ).success,
    ).toBe(false);

    const millLock = ajv.compile(
      JSON.parse(
        await readFile(path.join("schemas", "mill-lock.schema.json"), "utf8"),
      ),
    );
    const lockWithEmptyKey = {
      ...samples.millLock,
      schemaDigests: { "": `sha256:${"a".repeat(64)}` },
    };
    expect(millLock(lockWithEmptyKey)).toBe(false);
    expect(contractSchemas.millLock.safeParse(lockWithEmptyKey).success).toBe(
      false,
    );
  });

  it("requires an exact GitHub proposal boundary at the propose trust ceiling", async () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    ajv.addFormat(
      "uuid",
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
    );
    ajv.addFormat("uri", (value) => {
      try {
        void new URL(value);
        return true;
      } catch {
        return false;
      }
    });
    ajv.addFormat("date-time", (value) => Number.isFinite(Date.parse(value)));
    const validate = ajv.compile(
      JSON.parse(
        await readFile(path.join("schemas", "mill-config.schema.json"), "utf8"),
      ),
    );
    const base = {
      ...samples.millConfig,
      trustCeiling: "propose" as const,
    };
    expect(validate(base)).toBe(false);
    expect(contractSchemas.millConfig.safeParse(base).success).toBe(false);
    const localReview = {
      ...base,
      propose: {
        forge: "github",
        host: "github.com",
        owner: "example",
        repository: "app",
        repositoryNodeId: "R_example",
        remoteName: "origin",
        baseBranch: "main",
        branchPrefix: "mill/",
        allowedActors: ["operator"],
        allowedMergerLogins: ["operator"],
        requiredChecks: ["validate"],
        reviewPolicy: {
          mode: "local_only",
          requiredReviewerLogins: [],
        },
        allowedMergeMethods: ["linear_tree_preserving"],
      },
    } as const;
    expect(validate(localReview)).toBe(true);
    expect(contractSchemas.millConfig.safeParse(localReview).success).toBe(
      true,
    );
    const emptyRequiredReview = {
      ...localReview,
      propose: {
        ...localReview.propose,
        reviewPolicy: {
          mode: "github_required",
          requiredReviewerLogins: [],
        },
      },
    } as const;
    expect(validate(emptyRequiredReview)).toBe(false);
    expect(
      contractSchemas.millConfig.safeParse(emptyRequiredReview).success,
    ).toBe(false);
    const deliveryValidate = ajv.compile(
      JSON.parse(
        await readFile(
          path.join("schemas", "delivery-record.schema.json"),
          "utf8",
        ),
      ),
    );
    const invalidDeliveryReview = {
      ...samples.deliveryRecord,
      reviewPolicy: {
        mode: "github_required",
        requiredReviewerLogins: [],
      },
    } as const;
    expect(deliveryValidate(invalidDeliveryReview)).toBe(false);
    expect(
      contractSchemas.deliveryRecord.safeParse(invalidDeliveryReview).success,
    ).toBe(false);
  });

  it("rejects option-like and whitespace-bearing Git base references", async () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    ajv.addFormat("date-time", (value) => Number.isFinite(Date.parse(value)));
    ajv.addFormat("email", /^[^\s@]+@[^\s@]+$/u);
    const validate = ajv.compile(
      JSON.parse(
        await readFile(path.join("schemas", "task-packet.schema.json"), "utf8"),
      ),
    );
    for (const baseRef of ["--help", "HEAD main", "\tHEAD"]) {
      const candidate = { ...samples.taskPacket, baseRef };
      expect(validate(candidate), baseRef).toBe(false);
      expect(
        contractSchemas.taskPacket.safeParse(candidate).success,
        baseRef,
      ).toBe(false);
    }
  });
});
