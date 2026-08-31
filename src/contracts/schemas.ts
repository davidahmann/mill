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

export const millConfigSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  repositoryId: z.uuid(),
  trustCeiling: z.enum(["inspect", "build", "propose"]),
  commands: z.record(
    z.string().min(1),
    z.strictObject({
      argv: z.array(z.string()).min(1),
      cwd: z.string().min(1),
      capability: z.enum(["read", "build", "test", "package"]),
    }),
  ),
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
  managedRepository: managedRepositorySchema,
  millConfig: millConfigSchema,
  millLock: millLockSchema,
  outcomePlan: outcomePlanSchema,
  productContract: productContractSchema,
  scenarioSet: scenarioSetSchema,
} as const;

export type ContractKind = keyof typeof contractSchemas;
