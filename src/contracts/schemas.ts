import { z } from "zod";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const versionSchema = z.string().min(1);
const exactSemverSchema = z
  .string()
  .regex(
    /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u,
    "expected an exact semantic version",
  );

const stableInvariantIdSchema = z.string().regex(/^INV-[A-Z0-9][A-Z0-9-]*$/u);
const stableSourceIdSchema = z.string().regex(/^SRC-[A-Z0-9][A-Z0-9-]*$/u);
const stableDecisionIdSchema = z.string().regex(/^DEC-[A-Z0-9][A-Z0-9-]*$/u);

export const sourceManifestSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  trigger: z.enum([
    "bootstrap",
    "adoption_uncertainty",
    "approved_stack_change",
  ]),
  providers: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        name: z.string().min(1),
        queries: z.array(
          z.strictObject({
            id: z.string().min(1),
            text: z.string().min(1),
            purpose: z.string().min(1),
          }),
        ),
        networkDisclosure: z.string().min(1),
      }),
    )
    .min(1),
  sources: z
    .array(
      z.strictObject({
        id: stableSourceIdSchema,
        class: z.enum([
          "primary_documentation",
          "official_registry",
          "security_advisory",
          "license",
          "repository",
          "user_evidence",
          "operator_constraint",
        ]),
        uri: z.string().min(1),
        revision: z.string().min(1),
        observedAt: z.iso.datetime(),
        freshness: z.enum(["current", "stale", "unknown"]),
        authority: z.enum(["evidence", "constraint", "approved_decision"]),
        digest: digestSchema.optional(),
        claims: z.array(z.string().min(1)).min(1),
      }),
    )
    .min(1),
});

export const invariantSchema = z.strictObject({
  id: stableInvariantIdSchema,
  statement: z.string().min(1),
  owner: z.string().min(1),
  criticality: z.enum(["low", "medium", "high", "critical"]),
  surfaceRefs: z.array(z.string().min(1)).min(1),
  verification: z.strictObject({
    mode: z.enum(["command", "human", "unsupported"]),
    ref: z.string().min(1),
  }),
  sourceRefs: z.array(stableSourceIdSchema).min(1),
  unknowns: z.array(z.string().min(1)),
});

export const decisionCardSchema = z.strictObject({
  id: stableDecisionIdSchema,
  kind: z.enum([
    "product",
    "architecture",
    "design",
    "accessibility",
    "research",
  ]),
  question: z.string().min(1),
  decision: z.string().min(1),
  rationale: z.string().min(1),
  sourceRefs: z.array(stableSourceIdSchema).min(1),
  status: z.enum(["proposed", "approved", "rejected"]),
  costlyToReverse: z.boolean(),
});

export const managedRepositorySchema = z.strictObject({
  schemaVersion: z.literal("1"),
  id: z.uuid(),
  forgeHost: z.string().min(1),
  owner: z.string().min(1),
  repository: z.string().min(1),
  canonicalBranch: z.string().min(1),
  remoteName: z.string().min(1),
  remoteUrl: z.url(),
  trustCeiling: z.enum(["inspect", "build", "propose"]),
});

export const productContractSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  id: z.string().min(1),
  title: z.string().min(1),
  primaryUser: z.string().min(1),
  jobToBeDone: z.string().min(1),
  outcomes: z.array(z.string().min(1)).min(1),
  nonGoals: z.array(z.string().min(1)),
  assumptions: z.array(z.string().min(1)),
  unknowns: z.array(z.string().min(1)),
  sourceRefs: z.array(z.string().min(1)).min(1),
  acceptance: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        kind: z.enum(["functional", "quality", "operational"]),
        statement: z.string().min(1),
        sourceRefs: z.array(stableSourceIdSchema).min(1),
      }),
    )
    .default([]),
  invariants: z.array(invariantSchema).default([]),
  decisions: z.array(decisionCardSchema).default([]),
});

export const blueprintSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  id: z.string().min(1),
  productContractDigest: digestSchema,
  recipe: z.string().min(1),
  recipeVersion: versionSchema,
  runtime: z.string().min(1),
  architecture: z.array(z.string().min(1)).min(1),
  risks: z.array(z.string().min(1)),
});

export const scenarioSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.enum([
    "normal",
    "exception",
    "degradation",
    "recovery",
    "authority",
    "adversarial",
  ]),
  given: z.array(z.string().min(1)).min(1),
  when: z.array(z.string().min(1)).min(1),
  then: z.array(z.string().min(1)).min(1),
  oracleOwner: z.enum(["repository", "human", "external"]),
  acceptanceRefs: z.array(z.string().min(1)).default([]),
  invariantRefs: z.array(stableInvariantIdSchema).default([]),
  coverage: z.enum(["new_behavior", "preservation", "both"]).default("both"),
  visibility: z
    .enum(["builder_visible", "reviewer_owned", "human_acceptance"])
    .default("builder_visible"),
  executionRef: z.string().min(1).optional(),
  forbidden: z.array(z.string().min(1)).default([]),
});

export const scenarioSetSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  productContractDigest: digestSchema,
  scenarios: z.array(scenarioSchema).min(1),
});

export const outcomeSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1),
  acceptance: z.array(z.string().min(1)).min(1),
  dependsOn: z.array(z.string().min(1)),
  status: z.enum(["proposed", "approved", "ready", "blocked", "closed"]),
});

export const outcomePlanSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  productContractDigest: digestSchema,
  outcomes: z.array(outcomeSchema).min(1),
});

const impactExceptionSchema = z.strictObject({
  id: z.string().min(1),
  scopeRefs: z.array(z.string().min(1)).min(1),
  reason: z.string().min(1),
  approvedBy: z.string().min(1),
  approvedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});

export const impactManifestSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/u),
  productContractDigest: digestSchema,
  outcomeId: z.string().min(1),
  riskClass: z.enum(["low", "medium", "high"]),
  acceptanceIds: z.array(z.string().min(1)).min(1),
  affectedInvariantIds: z.array(stableInvariantIdSchema),
  uncertainInvariantIds: z.array(stableInvariantIdSchema),
  surfaces: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        kind: z.enum([
          "user",
          "system",
          "interface",
          "data",
          "operations",
          "design",
        ]),
        change: z.string().min(1),
      }),
    )
    .min(1),
  scenarioIds: z.array(z.string().min(1)).min(1),
  commandIds: z.array(z.string().min(1)).min(1),
  materialDecisions: z.array(stableDecisionIdSchema),
  unresolved: z.array(z.string().min(1)),
  exceptions: z.array(impactExceptionSchema),
  approval: z
    .strictObject({
      approvedBy: z.string().min(1),
      approvedAt: z.iso.datetime(),
      proposalDigest: digestSchema,
    })
    .nullable(),
});

export const specificationProposalSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  prd: z.strictObject({
    path: z.string().min(1),
    digest: digestSchema,
  }),
  sourceManifestDigest: digestSchema,
  productContract: productContractSchema,
  blueprints: z.array(blueprintSchema).min(2).max(3),
  scenarioSet: scenarioSetSchema,
  assumptions: z.array(
    z.strictObject({
      id: z.string().min(1),
      statement: z.string().min(1),
      sourceRefs: z.array(stableSourceIdSchema),
    }),
  ),
  contradictions: z.array(
    z.strictObject({
      id: z.string().min(1),
      statement: z.string().min(1),
      sourceRefs: z.array(stableSourceIdSchema).min(2),
      blocking: z.boolean(),
    }),
  ),
  questions: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        prompt: z.string().min(1),
        recommendedDefault: z.string().min(1),
        reversible: z.boolean(),
        blocking: z.boolean(),
      }),
    )
    .max(2),
  status: z.literal("proposed"),
});

const repositoryPathPatternSchema = z
  .string()
  .regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^*?[\]\\]+(?:\/\*\*)?$/u);

const githubReviewPolicySchema = z
  .strictObject({
    mode: z.enum(["local_only", "github_required"]),
    requiredReviewerLogins: z.array(z.string().min(1)),
  })
  .superRefine((policy, context) => {
    if (
      policy.mode === "github_required" &&
      policy.requiredReviewerLogins.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["requiredReviewerLogins"],
        message:
          "github_required review policy needs at least one reviewer login",
      });
    }
  })
  .meta({
    allOf: [
      {
        if: {
          properties: { mode: { const: "github_required" } },
          required: ["mode"],
        },
        then: {
          properties: {
            requiredReviewerLogins: { type: "array", minItems: 1 },
          },
        },
      },
    ],
  });

export const millConfigSchema = z
  .strictObject({
    schemaVersion: z.literal("1"),
    repositoryId: z.uuid(),
    trustCeiling: z.enum(["inspect", "build", "propose"]),
    sensitivePaths: z.array(repositoryPathPatternSchema).default([]),
    verifier: z
      .strictObject({
        image: z.string().regex(/^[^@\s]+@sha256:[a-f0-9]{64}$/u),
        network: z.literal("none"),
      })
      .optional(),
    propose: z
      .strictObject({
        forge: z.literal("github"),
        host: z.literal("github.com"),
        owner: z.string().regex(/^[A-Za-z0-9_.-]+$/u),
        repository: z.string().regex(/^[A-Za-z0-9_.-]+$/u),
        repositoryNodeId: z.string().min(1),
        remoteName: z.string().regex(/^[A-Za-z0-9._-]+$/u),
        baseBranch: z.string().regex(/^(?!-)(?!.*\.\.)[^\s~^:?*[\\]+$/u),
        branchPrefix: z.literal("mill/"),
        allowedActors: z.array(z.string().min(1)).min(1),
        allowedMergerLogins: z.array(z.string().min(1)).min(1),
        requiredChecks: z.array(z.string().min(1)),
        reviewPolicy: githubReviewPolicySchema,
        allowedMergeMethods: z
          .array(z.enum(["merge", "linear_tree_preserving"]))
          .min(1),
        approvalTtlSeconds: z.number().int().min(60).max(3600).default(900),
        pollTimeoutSeconds: z.number().int().min(1).max(1800).default(600),
      })
      .optional(),
    commands: z.record(
      z.string().min(1),
      z.strictObject({
        argv: z.array(z.string().min(1)).min(1),
        cwd: z.string().min(1),
        controlPaths: z.array(repositoryPathPatternSchema).min(1),
        capability: z.enum(["read", "build", "test", "package"]),
        required: z.boolean().default(true),
        timeoutSeconds: z.number().int().min(1).max(3600).default(600),
        execution: z.enum(["oci", "host"]).default("oci"),
      }),
    ),
  })
  .superRefine((value, context) => {
    if (value.trustCeiling === "propose" && value.propose === undefined) {
      context.addIssue({
        code: "custom",
        path: ["propose"],
        message:
          "propose configuration is required at the propose trust ceiling",
      });
    }
  })
  .meta({
    allOf: [
      {
        if: {
          properties: { trustCeiling: { const: "propose" } },
          required: ["trustCeiling"],
        },
        then: { properties: { propose: true }, required: ["propose"] },
      },
    ],
  });

const authorityReferenceSchema = z.strictObject({
  path: z.string().min(1),
  digest: digestSchema,
});

const humanAttestationSchema = z.strictObject({
  id: z.string().regex(/^ATT-[A-Z0-9][A-Z0-9-]*$/u),
  approvedBy: z.string().min(1),
  approvedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  claims: z
    .array(
      z.strictObject({
        kind: z.enum(["acceptance", "invariant", "scenario"]),
        id: z.string().min(1),
        digest: digestSchema,
      }),
    )
    .min(1),
});

const evidenceDispositionSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("command"),
    commandId: z.string().min(1),
  }),
  z.strictObject({
    mode: z.literal("human"),
    attestationId: z.string().regex(/^ATT-[A-Z0-9][A-Z0-9-]*$/u),
  }),
  z.strictObject({
    mode: z.literal("unsupported"),
    reason: z.string().min(1),
  }),
]);

const taskPacketCommonShape = {
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/u),
  title: z.string().min(1),
  objective: z.string().min(1),
  riskClass: z.enum(["low", "medium", "high"]),
  baseRef: z.string().regex(/^(?!-)[^\s]+$/u),
  contextPaths: z.array(z.string().min(1)).min(1),
  allowedPaths: z.array(repositoryPathPatternSchema).min(1),
  commandIds: z.array(z.string().min(1)).min(1),
  commit: z.strictObject({
    message: z.string().min(1),
    authorName: z.string().min(1),
    authorEmail: z.email(),
  }),
  budget: z.strictObject({
    deadlineSeconds: z.number().int().min(1).max(7200),
    maxOutputBytes: z.number().int().min(1024).max(10_000_000),
    retryCount: z.number().int().min(0).max(1),
  }),
} as const;

export const taskPacketV1Schema = z.strictObject({
  schemaVersion: z.literal("1"),
  ...taskPacketCommonShape,
  authority: z.strictObject({
    productContract: authorityReferenceSchema,
    scenarioSet: authorityReferenceSchema,
    policy: authorityReferenceSchema,
  }),
  acceptance: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        statement: z.string().min(1),
      }),
    )
    .min(1),
});

export const taskPacketV2Schema = z.strictObject({
  schemaVersion: z.literal("2"),
  ...taskPacketCommonShape,
  authority: z.strictObject({
    productContract: authorityReferenceSchema,
    scenarioSet: authorityReferenceSchema,
    policy: authorityReferenceSchema,
    impactManifest: authorityReferenceSchema,
  }),
  attestations: z.array(humanAttestationSchema).default([]),
  acceptance: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        statement: z.string().min(1),
        invariantIds: z.array(stableInvariantIdSchema),
        scenarioIds: z.array(z.string().min(1)),
        coverage: z.enum(["new_behavior", "preservation", "both"]),
        evidence: evidenceDispositionSchema,
      }),
    )
    .min(1),
});

export const taskPacketSchema = z.discriminatedUnion("schemaVersion", [
  taskPacketV1Schema,
  taskPacketV2Schema,
]);

export const workerProfileSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  adapter: z.literal("codex-cli"),
  role: z.enum(["planner", "builder", "reviewer"]),
  contractVersion: z.literal("1"),
  harnessVersion: z.string().min(1),
  promptTemplateDigest: digestSchema,
  modelIdentity: z.literal("provider-mutable"),
  approvalPolicy: z.literal("never"),
  sandbox: z.enum(["read-only", "workspace-write"]),
  session: z.literal("ephemeral"),
  hostRules: z.literal("ignored"),
  skillDiscovery: z.literal("disabled"),
  toolDiscovery: z.literal("disabled"),
  networkPosture: z.enum(["unknown", "provider-managed"]),
  capabilities: z.array(z.string().min(1)).min(1),
  outputContract: z.string().min(1),
});

export const workerInvocationSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  invocationId: z.uuid(),
  runId: z.uuid(),
  phase: z.enum(["build", "repair", "review"]),
  attempt: z.number().int().positive().max(2),
  taskDigest: digestSchema,
  contextEpoch: digestSchema,
  baseCommit: z.string().regex(/^[a-f0-9]{40}$/u),
  candidateCommit: z
    .string()
    .regex(/^[a-f0-9]{40}$/u)
    .optional(),
  impactManifestDigest: digestSchema.optional(),
  profile: workerProfileSchema,
  profileDigest: digestSchema,
  allowedPaths: z.array(repositoryPathPatternSchema),
  deadlineAt: z.iso.datetime(),
  maxOutputBytes: z.number().int().min(1024).max(10_000_000),
});

export const contextManifestSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  taskDigest: digestSchema,
  baseCommit: z.string().regex(/^[a-f0-9]{40}$/u),
  provider: z.literal("openai"),
  adapter: z.literal("codex-cli"),
  authOwner: z.literal("operator"),
  isolation: z.literal("attended-trusted-host"),
  modelIdentity: z.literal("provider-mutable"),
  included: z.array(
    z.strictObject({ path: z.string().min(1), digest: digestSchema }),
  ),
  excludedPatterns: z.array(z.string().min(1)),
  disclosure: z.array(z.string().min(1)),
  contextEpoch: digestSchema.optional(),
  effectiveInstructions: z
    .array(z.strictObject({ path: z.string().min(1), digest: digestSchema }))
    .optional(),
  providerVisibleScope: z
    .strictObject({
      repositoryScope: z.literal("worktree"),
      suppliedPaths: z.array(z.string().min(1)),
      writablePatterns: z.array(repositoryPathPatternSchema),
      observedReads: z.literal("unavailable"),
    })
    .optional(),
});

export const reviewResultSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  candidateCommit: z.string().regex(/^[a-f0-9]{40}$/u),
  summary: z.string(),
  findings: z.array(
    z.strictObject({
      id: z.string().min(1),
      severity: z.enum(["P0", "P1", "P2", "P3"]),
      class: z.enum([
        "correctness",
        "security",
        "data-loss",
        "provenance",
        "compatibility",
        "authority",
        "maintainability",
        "style",
      ]),
      title: z.string().min(1),
      body: z.string().min(1),
      file: z.string().min(1).nullable(),
      line: z.number().int().min(1).nullable(),
    }),
  ),
});

export const validationEvidenceSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  candidateCommit: z.string().regex(/^[a-f0-9]{40}$/u),
  verifierImage: z.string().regex(/^[^@\s]+@sha256:[a-f0-9]{64}$/u),
  network: z.literal("none"),
  commands: z.array(
    z.strictObject({
      commandId: z.string().min(1),
      required: z.boolean(),
      status: z.enum(["passed", "failed", "blocked"]),
      exitCode: z.number().int().nullable(),
      durationMs: z.number().int().min(0),
      outputDigest: digestSchema,
      reason: z
        .enum([
          "HOST_EXECUTION_NOT_QUALIFIED",
          "CANCELLED",
          "DEADLINE_EXCEEDED",
          "OUTPUT_BUDGET_EXCEEDED",
          "NONZERO_EXIT",
        ])
        .optional(),
    }),
  ),
  semantic: z
    .strictObject({
      impactManifestDigest: digestSchema,
      items: z.array(
        z.strictObject({
          kind: z.enum(["acceptance", "invariant", "scenario"]),
          id: z.string().min(1),
          coverage: z.enum(["new_behavior", "preservation", "both"]),
          status: z.enum(["passed", "attested", "blocked"]),
          evidenceRefs: z.array(z.string().min(1)),
          reason: z.string().min(1).optional(),
        }),
      ),
      newBehaviorPassed: z.boolean(),
      preservationPassed: z.boolean(),
      passed: z.boolean(),
    })
    .optional(),
  passed: z.boolean(),
});

const remoteEffectSchema = z.strictObject({
  id: digestSchema,
  kind: z.enum(["push", "pull_request"]),
  candidateCommit: z.string().regex(/^[a-f0-9]{40}$/u),
  status: z.enum([
    "intent",
    "call_started",
    "effect_unknown",
    "retryable_absent",
    "verified",
    "blocked",
  ]),
  attemptCount: z.number().int().min(0).max(2),
  expectedOldCommit: z
    .string()
    .regex(/^[a-f0-9]{40}$/u)
    .nullable(),
  errorCode: z.string().min(1).nullable(),
  updatedAt: z.iso.datetime(),
});

export const deliveryRecordSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  runId: z.uuid(),
  deliveryKey: digestSchema,
  proposalDigest: digestSchema,
  approvalExpiresAt: z.iso.datetime(),
  state: z.enum([
    "planned",
    "proposing",
    "effect_unknown",
    "awaiting_ci",
    "awaiting_human",
    "merged",
    "post_merge_verified",
    "closed",
    "cancelled",
    "blocked",
  ]),
  target: z.strictObject({
    forge: z.literal("github"),
    host: z.literal("github.com"),
    owner: z.string().min(1),
    repository: z.string().min(1),
    repositoryNodeId: z.string().min(1),
    cloneUrl: z.url(),
    remoteName: z.string().min(1),
    baseBranch: z.string().min(1),
    actorLogin: z.string().min(1),
    actorId: z.number().int().positive(),
  }),
  branchName: z.string().min(1),
  candidateCommit: z.string().regex(/^[a-f0-9]{40}$/u),
  candidateTree: z.string().regex(/^[a-f0-9]{40}$/u),
  requiredChecks: z.array(z.string().min(1)),
  reviewPolicy: githubReviewPolicySchema,
  allowedMergerLogins: z.array(z.string().min(1)).min(1),
  allowedMergeMethods: z
    .array(z.enum(["merge", "linear_tree_preserving"]))
    .min(1),
  effects: z.array(remoteEffectSchema),
  remoteHeadCommit: z
    .string()
    .regex(/^[a-f0-9]{40}$/u)
    .nullable(),
  pullRequest: z
    .strictObject({
      number: z.number().int().positive(),
      nodeId: z.string().min(1),
      url: z.url(),
    })
    .nullable(),
  observation: z.record(z.string(), z.unknown()).nullable(),
  merge: z
    .strictObject({
      commit: z.string().regex(/^[a-f0-9]{40}$/u),
      tree: z.string().regex(/^[a-f0-9]{40}$/u),
      method: z.enum(["merge", "linear_tree_preserving"]),
      mergedByLogin: z.string().min(1),
      mergedAt: z.iso.datetime(),
      defaultBranchHead: z.string().regex(/^[a-f0-9]{40}$/u),
    })
    .nullable(),
  lastErrorCode: z.string().min(1).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const millLockSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  mill: z.strictObject({
    package: z.literal("@davidahmann/mill"),
    version: exactSemverSchema,
    integrity: digestSchema.optional(),
  }),
  schemaDigests: z.record(z.string().min(1), digestSchema).default({}),
  recipe: z
    .strictObject({
      id: z.string().min(1),
      version: versionSchema,
      digest: digestSchema,
    })
    .optional(),
});

export const contractSchemas = {
  blueprint: blueprintSchema,
  contextManifest: contextManifestSchema,
  impactManifest: impactManifestSchema,
  managedRepository: managedRepositorySchema,
  millConfig: millConfigSchema,
  millLock: millLockSchema,
  outcomePlan: outcomePlanSchema,
  productContract: productContractSchema,
  reviewResult: reviewResultSchema,
  scenarioSet: scenarioSetSchema,
  sourceManifest: sourceManifestSchema,
  specificationProposal: specificationProposalSchema,
  taskPacket: taskPacketSchema,
  validationEvidence: validationEvidenceSchema,
  workerInvocation: workerInvocationSchema,
  workerProfile: workerProfileSchema,
  deliveryRecord: deliveryRecordSchema,
} as const;

export type ContractKind = keyof typeof contractSchemas;
