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
const stableOutcomeIdSchema = z.string().regex(/^OUT-[A-Z0-9][A-Z0-9-]*$/u);
const uniqueNonemptyStringArraySchema = z
  .array(z.string().min(1))
  .min(1)
  .refine((values) => new Set(values).size === values.length, {
    message: "expected unique values",
  })
  .meta({ uniqueItems: true });

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
  outcomes: z
    .array(
      z.strictObject({
        id: stableOutcomeIdSchema,
        statement: z.string().min(1),
        acceptanceIds: uniqueNonemptyStringArraySchema.optional(),
      }),
    )
    .min(1),
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
  recipeOracle: z.string().min(1).optional(),
  forbidden: z.array(z.string().min(1)).default([]),
});

export const scenarioSetSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  productContractDigest: digestSchema,
  scenarios: z.array(scenarioSchema).min(1),
});

const sourceLocationSchema = z.strictObject({
  path: z.string().min(1),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
});

export const repositoryIntelligenceSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  extractor: z.strictObject({
    id: z.literal("mill.repository-intelligence"),
    version: z.literal("1"),
    digest: digestSchema,
  }),
  source: z.strictObject({
    commit: z.string().regex(/^[a-f0-9]{40}$/u),
    tree: z.string().regex(/^[a-f0-9]{40}$/u),
    root: z.literal("."),
  }),
  scanDigest: digestSchema,
  sourceFiles: z.array(z.string().min(1)),
  modules: z.array(
    z.strictObject({
      path: z.string().min(1),
      digest: digestSchema,
      imports: z.array(
        z.strictObject({
          kind: z.enum(["dynamic", "require", "static", "type"]),
          specifier: z.string().min(1),
          location: sourceLocationSchema,
          resolution: z.enum(["external", "resolved_local", "unresolved"]),
          targetPath: z.string().min(1).optional(),
        }),
      ),
      parseDiagnostics: z.array(sourceLocationSchema),
    }),
  ),
  tests: z.strictObject({
    inventory: z.array(
      z.strictObject({
        path: z.string().min(1),
        source: z.literal("filename"),
      }),
    ),
    declaredSelection: z.array(
      z.strictObject({
        script: z.string().min(1),
        command: z.string().min(1),
        selector: z.string().min(1),
        matchedInventory: z.array(z.string().min(1)),
        status: z.enum(["observed", "unknown"]),
      }),
    ),
    executedCoverage: z.literal("unknown"),
  }),
  changeImpact: z.array(
    z.strictObject({
      changedPath: z.string().min(1),
      leads: z.array(
        z.strictObject({
          path: z.string().min(1),
          relationship: z.enum([
            "changed",
            "direct_importer",
            "transitive_importer",
          ]),
          via: z.string().min(1).optional(),
        }),
      ),
      unknowns: z.array(z.string().min(1)),
    }),
  ),
  unknowns: z.array(z.string().min(1)),
  digest: digestSchema,
  authority: z.literal("derived_read_only"),
});

export const outcomeSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1),
  acceptance: z.array(z.string().min(1)).min(1),
  acceptanceIds: uniqueNonemptyStringArraySchema.optional(),
  dependsOn: z.array(z.string().min(1)),
  status: z.enum(["proposed", "approved", "ready", "blocked", "closed"]),
  taskRef: z
    .string()
    .regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^*?[\]\\]+(?:\/\*\*)?$/u)
    .optional(),
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
  outcomeId: stableOutcomeIdSchema,
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
  blueprints: z.array(blueprintSchema).length(1),
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

const repositoryMountDirectorySchema = z
  .string()
  .regex(
    /^(?!\.\.?$)(?!.*[,/])[^*?[\]\\]+$/u,
    "expected a comma-free top-level repository directory",
  );

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

export const checkProducerSchema = z.strictObject({
  appId: z.number().int().positive(),
  workflowPath: z
    .string()
    .regex(/^\.github\/workflows\/[A-Za-z0-9._-]+\.ya?ml$/u),
  pullRequestEvent: z.literal("pull_request"),
  postMergeEvent: z.literal("push"),
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
        dependencies: z
          .strictObject({
            manager: z.literal("npm"),
            registry: z.literal("https://registry.npmjs.org"),
            targetPath: z.literal("node_modules"),
            lockPaths: z.array(repositoryPathPatternSchema).min(1),
          })
          .optional(),
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
        checkProducers: z
          .record(z.string().min(1), checkProducerSchema)
          .optional(),
        attendedMerge: z.literal(true).optional(),
        postMergeRequiredChecks: z.array(z.string().min(1)).min(1).optional(),
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
      z
        .strictObject({
          argv: z.array(z.string().min(1)).min(1),
          cwd: z.string().min(1),
          controlPaths: z.array(repositoryPathPatternSchema).min(1),
          capability: z.enum(["read", "build", "test", "package"]),
          required: z.boolean().default(true),
          timeoutSeconds: z.number().int().min(1).max(3600).default(600),
          execution: z.enum(["oci", "host"]).default("oci"),
          writablePaths: z.array(repositoryMountDirectorySchema).optional(),
          executableFixtureScratch: z.literal(true).optional(),
        })
        .meta({
          allOf: [
            {
              if: {
                properties: { executableFixtureScratch: { const: true } },
                required: ["executableFixtureScratch"],
              },
              then: {
                properties: {
                  execution: { const: "oci" },
                  capability: { enum: ["test", "package"] },
                },
              },
            },
          ],
        }),
    ),
  })
  .superRefine((value, context) => {
    for (const [commandId, command] of Object.entries(value.commands)) {
      if (
        command.executableFixtureScratch === true &&
        (command.execution !== "oci" ||
          !["test", "package"].includes(command.capability))
      ) {
        context.addIssue({
          code: "custom",
          path: ["commands", commandId, "executableFixtureScratch"],
          message:
            "Executable fixture scratch requires an OCI test/package command",
        });
      }
    }
    if (value.trustCeiling === "propose" && value.propose === undefined) {
      context.addIssue({
        code: "custom",
        path: ["propose"],
        message:
          "propose configuration is required at the propose trust ceiling",
      });
    }
    const propose = value.propose;
    const postMergeChecks = propose?.postMergeRequiredChecks;
    if (
      postMergeChecks !== undefined &&
      propose !== undefined &&
      !postMergeChecks.every((check) => propose.requiredChecks.includes(check))
    ) {
      context.addIssue({
        code: "custom",
        path: ["propose", "postMergeRequiredChecks"],
        message:
          "post-merge required checks must be a subset of pull-request required checks",
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
  repositoryIntelligence: z.literal(true).optional(),
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
    maxContextBytes: z.number().int().min(1024).max(16_777_216).optional(),
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

export const changeRequestSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  repositoryIntelligence: z.literal(true).optional(),
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/u),
  kind: z.enum(["prd", "plan", "bug", "review", "maintenance"]),
  source: authorityReferenceSchema,
  productPath: repositoryPathPatternSchema,
  scenariosPath: repositoryPathPatternSchema,
  policyPath: repositoryPathPatternSchema,
  commit: taskPacketCommonShape.commit,
  budget: taskPacketCommonShape.budget,
  readyOutcomeId: z.string().min(1),
  tasks: z
    .array(
      z.strictObject({
        id: taskPacketCommonShape.id,
        outcomeId: stableOutcomeIdSchema,
        supersedesTaskDigest: digestSchema.optional(),
        title: z.string().min(1),
        objective: z.string().min(1),
        dependsOn: z.array(stableOutcomeIdSchema),
        impactPath: repositoryPathPatternSchema,
        allowedPaths: taskPacketCommonShape.allowedPaths,
        contextPaths: taskPacketCommonShape.contextPaths,
        attestations: z.array(humanAttestationSchema).default([]),
      }),
    )
    .min(1)
    .max(100),
});

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
  repositoryContext: z
    .strictObject({
      authority: z.literal("derived_read_only"),
      sourceCommit: z.string().regex(/^[a-f0-9]{40}$/u),
      mapDigest: digestSchema,
      extractorVersion: z.string().min(1),
      modules: z
        .array(
          z.strictObject({
            path: z.string().min(1),
            digest: digestSchema,
            localImports: z.array(z.string()),
            unresolvedImports: z.number().int().min(0),
          }),
        )
        .max(24),
      omittedModules: z.number().int().min(0),
      unknowns: z.array(z.string()),
    })
    .optional(),
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

export const reviewScopeSchema = z.strictObject({
  baseCommit: z.string().regex(/^[a-f0-9]{40}$/u),
  candidateCommit: z.string().regex(/^[a-f0-9]{40}$/u),
  candidateTree: z.string().regex(/^[a-f0-9]{40}$/u),
  changedPaths: z.array(z.string().min(1)),
  digest: digestSchema,
});

export const reviewResultSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  candidateCommit: z.string().regex(/^[a-f0-9]{40}$/u),
  scope: reviewScopeSchema.optional(),
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

export const mergeApprovalPlanSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  repositoryNodeId: z.string().min(1),
  pullRequestNumber: z.number().int().positive(),
  pullRequestNodeId: z.string().min(1),
  headCommit: z.string().regex(/^[a-f0-9]{40}$/u),
  baseCommit: z.string().regex(/^[a-f0-9]{40}$/u),
  candidateTree: z.string().regex(/^[a-f0-9]{40}$/u),
  actorLogin: z.string().min(1),
  actorId: z.number().int().positive(),
  policyDigest: digestSchema,
  method: z.enum(["merge", "squash"]),
  markReady: z.boolean(),
  expiresAt: z.iso.datetime(),
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
  checkProducers: z.record(z.string().min(1), checkProducerSchema).optional(),
  postMergeRequiredChecks: z.array(z.string().min(1)).min(1).optional(),
  postMergePolicySource: z
    .enum(["configured", "implicit_default", "legacy_migrated"])
    .optional(),
  legacyPostMergePolicyConfigDigest: digestSchema.optional(),
  reviewPolicy: githubReviewPolicySchema,
  allowedMergerLogins: z.array(z.string().min(1)).min(1),
  allowedMergeMethods: z
    .array(z.enum(["merge", "linear_tree_preserving"]))
    .min(1),
  effects: z.array(remoteEffectSchema),
  mergeApproval: z
    .strictObject({
      plan: mergeApprovalPlanSchema,
      digest: digestSchema,
      state: z.enum([
        "planned",
        "ready_started",
        "ready_verified",
        "merge_started",
        "effect_unknown",
        "merged",
      ]),
      approvalSource: z.literal("attended_operator").optional(),
    })
    .optional(),
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
  integration: z
    .strictObject({
      mode: z.enum(["greenfield", "adoption"]),
      planDigest: digestSchema,
      baseCommit: z
        .string()
        .regex(/^[a-f0-9]{40}$/u)
        .nullable(),
      files: z.array(
        z.strictObject({
          path: repositoryPathPatternSchema,
          ownership: z.enum(["mill_only", "generated_once", "managed"]),
          templateDigest: digestSchema,
          installedDigest: digestSchema,
          preexistingDigest: digestSchema.nullable(),
        }),
      ),
    })
    .optional(),
});

export const recipeManifestSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  id: z.literal("node-typescript-next-web"),
  version: exactSemverSchema,
  status: z.enum(["supported", "experimental", "unsupported"]),
  observedAt: z.iso.datetime(),
  runtime: z.strictObject({
    node: exactSemverSchema,
    npm: exactSemverSchema,
  }),
  stack: z.strictObject({
    next: exactSemverSchema,
    react: exactSemverSchema,
    reactDom: exactSemverSchema,
    typescript: exactSemverSchema,
    eslint: exactSemverSchema,
    prettier: exactSemverSchema,
    vitest: exactSemverSchema,
    playwright: exactSemverSchema,
  }),
  verifierImage: z.string().regex(/^[^@\s]+@sha256:[a-f0-9]{64}$/u),
  registry: z.url(),
  licensePolicy: z.strictObject({
    allowed: z.array(z.string().min(1)).min(1),
    reviewedPackages: z.array(
      z.strictObject({ name: z.string().min(1), license: z.string().min(1) }),
    ),
  }),
  commands: z.strictObject({
    required: z.array(z.string().min(1)).min(1),
    native: z.array(z.string().min(1)).min(1),
  }),
  oracles: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        commandId: z.string().min(1),
        evidencePaths: z.array(repositoryPathPatternSchema).min(1),
        proves: z.array(z.string().min(1)).min(1),
      }),
    )
    .min(1),
  writablePaths: z.array(repositoryMountDirectorySchema),
  sources: z.array(z.url()).min(1),
});

const integrationFileSchema = z.strictObject({
  path: repositoryPathPatternSchema,
  ownership: z.enum(["mill_only", "generated_once", "managed"]),
  action: z.enum(["create", "retain_identical"]),
  contentDigest: digestSchema,
  preexistingDigest: digestSchema.nullable(),
});

export const repositoryIntegrationPlanSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  planDigest: digestSchema,
  generator: z.strictObject({
    package: z.literal("@davidahmann/mill"),
    version: exactSemverSchema,
  }),
  mode: z.enum(["greenfield", "adoption"]),
  target: z.strictObject({
    directoryName: z.string().min(1),
    canonicalPathDigest: digestSchema,
    baseCommit: z
      .string()
      .regex(/^[a-f0-9]{40}$/u)
      .nullable(),
    scanDigest: digestSchema.nullable(),
  }),
  productProposalDigest: digestSchema,
  productContractDigest: digestSchema,
  recipe: z.strictObject({
    id: z.literal("node-typescript-next-web"),
    version: exactSemverSchema,
    digest: digestSchema,
    status: z.literal("supported"),
    verifierImage: z.string().regex(/^[^@\s]+@sha256:[a-f0-9]{64}$/u),
  }),
  approval: z.strictObject({
    approvedBy: z.string().min(1),
    approvedAt: z.iso.datetime(),
  }),
  files: z.array(integrationFileSchema).min(1),
  commandIds: z.array(z.string().min(1)).min(1),
  networkDisclosure: z.array(z.string().min(1)),
  baseline: z.literal("unverified"),
});

export const auditCategorySchema = z.enum([
  "product",
  "code",
  "ux",
  "accessibility",
  "security",
  "dependencies",
  "architecture",
  "operations",
  "release",
]);

export const auditReportSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  candidate: z.strictObject({
    commit: z.string().regex(/^[a-f0-9]{40}$/u),
    tree: z.string().regex(/^[a-f0-9]{40}$/u),
  }),
  generatedAt: z.iso.datetime(),
  status: z.enum(["passed", "blocked"]),
  checks: z
    .array(
      z.strictObject({
        id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/u),
        category: auditCategorySchema,
        assurance: z.enum(["structural", "executed"]).optional(),
        status: z.enum(["passed", "blocked"]),
        summary: z.string().min(1),
        evidence: z.array(z.string().min(1)).min(1),
      }),
    )
    .min(9),
});

const qualificationItemSetSchema = z.strictObject({
  requiredIds: uniqueNonemptyStringArraySchema,
  passedIds: z.array(z.string().min(1)),
});

const qualificationStatusSchema = z.enum([
  "passed",
  "failed",
  "blocked",
  "skipped",
]);

export const supportTupleSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/u),
  status: z.enum(["experimental", "qualified", "expired"]),
  testedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  host: z.strictObject({
    os: z.string().min(1),
    architecture: z.string().min(1),
  }),
  runtime: z.strictObject({
    node: exactSemverSchema,
    npm: exactSemverSchema,
  }),
  container: z.strictObject({
    engine: z.string().min(1),
    version: z.string().min(1),
    verifierImage: z.string().regex(/^[^@\s]+@sha256:[a-f0-9]{64}$/u),
  }),
  worker: z.strictObject({
    adapter: z.literal("codex-cli"),
    harnessVersion: z.string().min(1),
    modelIdentity: z.literal("provider-mutable"),
    authMode: z.literal("operator-session"),
  }),
  forge: z.strictObject({
    gitVersion: z.string().min(1),
    ghVersion: z.string().min(1),
    host: z.literal("github.com"),
  }),
  recipe: z.strictObject({
    id: z.literal("node-typescript-next-web"),
    version: exactSemverSchema,
    digest: digestSchema,
  }),
});

export const publicAlphaQualificationSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  package: z.strictObject({
    name: z.literal("@davidahmann/mill"),
    version: exactSemverSchema,
    artifactDigest: digestSchema,
    npmIntegrity: z.string().regex(/^sha512-[A-Za-z0-9+/]+={0,2}$/u),
  }),
  supportTuple: supportTupleSchema,
  sequence: z.strictObject({
    steps: z
      .array(
        z.strictObject({
          id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/u),
          dependsOn: z.array(z.string().min(1)).max(1),
          baseCommit: z.string().regex(/^[a-f0-9]{40}$/u),
          candidateCommit: z.string().regex(/^[a-f0-9]{40}$/u),
          status: z.enum(["accepted", "rejected", "blocked"]),
          newBehavior: qualificationItemSetSchema,
          preservation: qualificationItemSetSchema,
          scenarioIds: uniqueNonemptyStringArraySchema,
          usage: z.strictObject({
            inputTokens: z.number().int().min(0).nullable(),
            outputTokens: z.number().int().min(0).nullable(),
            currencyCost: z.number().min(0).nullable(),
            source: z.enum([
              "provider-measured",
              "operator-declared",
              "unavailable",
            ]),
          }),
        }),
      )
      .min(5)
      .max(20),
    seededFault: z.strictObject({
      baseCommit: z.string().regex(/^[a-f0-9]{40}$/u),
      candidateCommit: z.string().regex(/^[a-f0-9]{40}$/u),
      status: qualificationStatusSchema,
      rejected: z.boolean(),
      recovered: z.boolean(),
      enteredAcceptedSequence: z.boolean(),
      reason: z.string().min(1),
    }),
  }),
  canaries: z.strictObject({
    packedInstall: qualificationStatusSchema,
    greenfield: qualificationStatusSchema,
    adoption: qualificationStatusSchema,
    downstreamWithoutMill: qualificationStatusSchema,
    recovery: qualificationStatusSchema,
    security: qualificationStatusSchema,
  }),
  auditCandidate: z.strictObject({
    commit: z.string().regex(/^[a-f0-9]{40}$/u),
    tree: z.string().regex(/^[a-f0-9]{40}$/u),
  }),
  audits: z.array(
    z.strictObject({
      category: auditCategorySchema,
      status: qualificationStatusSchema,
      reportDigest: digestSchema,
    }),
  ),
  generatedAt: z.iso.datetime(),
});

const releaseArtifactSchema = z.strictObject({
  builder: z.string().min(1),
  filename: z.string().regex(/^[A-Za-z0-9@._+-]+\.tgz$/u),
  sha256: digestSchema,
  npmIntegrity: z.string().regex(/^sha512-[A-Za-z0-9+/]+={0,2}$/u),
  contentsDigest: digestSchema,
});

export const releaseEvidenceSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  state: z.enum(["qualified", "published", "verified"]),
  package: z.strictObject({
    name: z.literal("@davidahmann/mill"),
    version: exactSemverSchema,
    tag: z.string().regex(/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u),
  }),
  source: z.strictObject({
    reviewedCandidateTree: z.string().regex(/^[a-f0-9]{40}$/u),
    resultingMainCommit: z.string().regex(/^[a-f0-9]{40}$/u),
    resultingMainTree: z.string().regex(/^[a-f0-9]{40}$/u),
    tagCommit: z.string().regex(/^[a-f0-9]{40}$/u),
  }),
  builders: z.array(releaseArtifactSchema).length(2),
  selectedArtifact: releaseArtifactSchema,
  qualificationDigest: digestSchema,
  sbomDigest: digestSchema,
  registry: z
    .strictObject({
      tarball: z.url(),
      integrity: z.string().regex(/^sha512-[A-Za-z0-9+/]+={0,2}$/u),
      provenanceVerified: z.boolean(),
    })
    .nullable(),
  githubRelease: z
    .strictObject({
      url: z.url(),
      tag: z.string().min(1),
      artifactDigest: digestSchema,
    })
    .nullable(),
  generatedAt: z.iso.datetime(),
});

export const contractSchemas = {
  changeRequest: changeRequestSchema,
  auditReport: auditReportSchema,
  blueprint: blueprintSchema,
  contextManifest: contextManifestSchema,
  impactManifest: impactManifestSchema,
  managedRepository: managedRepositorySchema,
  millConfig: millConfigSchema,
  millLock: millLockSchema,
  outcomePlan: outcomePlanSchema,
  productContract: productContractSchema,
  recipeManifest: recipeManifestSchema,
  releaseEvidence: releaseEvidenceSchema,
  repositoryIntelligence: repositoryIntelligenceSchema,
  repositoryIntegrationPlan: repositoryIntegrationPlanSchema,
  reviewResult: reviewResultSchema,
  scenarioSet: scenarioSetSchema,
  sourceManifest: sourceManifestSchema,
  supportTuple: supportTupleSchema,
  specificationProposal: specificationProposalSchema,
  taskPacket: taskPacketSchema,
  validationEvidence: validationEvidenceSchema,
  publicAlphaQualification: publicAlphaQualificationSchema,
  workerInvocation: workerInvocationSchema,
  workerProfile: workerProfileSchema,
  deliveryRecord: deliveryRecordSchema,
} as const;

export type ContractKind = keyof typeof contractSchemas;
