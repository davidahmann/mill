import { z } from "zod";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const versionSchema = z.string().min(1);
const exactSemverSchema = z
  .string()
  .regex(
    /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u,
    "expected an exact semantic version",
  );

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

const repositoryPathPatternSchema = z
  .string()
  .regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^*?[\]\\]+(?:\/\*\*)?$/u);

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
        requiredChecks: z.array(z.string().min(1)),
        reviewPolicy: z
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
          }),
        allowedMergeMethods: z
          .array(z.enum(["merge", "squash", "rebase"]))
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
  });

const authorityReferenceSchema = z.strictObject({
  path: z.string().min(1),
  digest: digestSchema,
});

export const taskPacketSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/u),
  title: z.string().min(1),
  objective: z.string().min(1),
  riskClass: z.enum(["low", "medium", "high"]),
  baseRef: z.string().regex(/^(?!-)[^\s]+$/u),
  authority: z.strictObject({
    productContract: authorityReferenceSchema,
    scenarioSet: authorityReferenceSchema,
    policy: authorityReferenceSchema,
  }),
  contextPaths: z.array(z.string().min(1)).min(1),
  allowedPaths: z.array(repositoryPathPatternSchema).min(1),
  commandIds: z.array(z.string().min(1)).min(1),
  acceptance: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        statement: z.string().min(1),
      }),
    )
    .min(1),
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
    "verified",
    "blocked",
  ]),
  attemptCount: z.number().int().min(0).max(1),
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
  reviewPolicy: z.strictObject({
    mode: z.enum(["local_only", "github_required"]),
    requiredReviewerLogins: z.array(z.string().min(1)),
  }),
  allowedMergeMethods: z.array(z.enum(["merge", "squash", "rebase"])).min(1),
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
      method: z.enum(["merge", "squash", "rebase", "linear_tree_preserving"]),
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
  managedRepository: managedRepositorySchema,
  millConfig: millConfigSchema,
  millLock: millLockSchema,
  outcomePlan: outcomePlanSchema,
  productContract: productContractSchema,
  reviewResult: reviewResultSchema,
  scenarioSet: scenarioSetSchema,
  taskPacket: taskPacketSchema,
  validationEvidence: validationEvidenceSchema,
  deliveryRecord: deliveryRecordSchema,
} as const;

export type ContractKind = keyof typeof contractSchemas;
