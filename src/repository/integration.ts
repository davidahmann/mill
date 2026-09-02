import { createHash } from "node:crypto";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";

import { canonicalDigest, type JsonValue } from "../contracts/canonical.js";
import {
  millConfigSchema,
  millLockSchema,
  repositoryIntegrationPlanSchema,
  taskPacketV1Schema,
  taskPacketV2Schema,
} from "../contracts/schemas.js";
import { findTrustedExecutable } from "../doctor.js";
import { ExitCode, MillError } from "../errors.js";
import {
  assessSpecificationProposal,
  loadPlanningSources,
  loadSpecificationProposal,
  promoteSpecificationProposal,
  type SpecificationProposal,
} from "../planning/specification.js";
import {
  loadNodeWebRecipe,
  renderNodeWebRecipe,
  type FileOwnership,
  type RecipeFile,
} from "../recipes/node-typescript-next-web.js";
import { isWithin, safeReadText } from "../security/safe-path.js";
import { MILL_PACKAGE, MILL_VERSION } from "../version.js";
import { processCancellationScope, runProcess } from "../runtime/process.js";
import {
  assertVisibleIndexState,
  resolveCommit,
} from "../runtime/repository.js";
import { textDigest } from "../runtime/inputs.js";
import { prepareDependencySnapshot } from "../runtime/dependencies.js";
import { repositoryStateDirectory } from "../runtime/state.js";
import { verifyDeclaredCommands } from "../runtime/verifier.js";
import { scanRepository, type RepositoryScan } from "./scan.js";

export type RepositoryIntegrationPlan = z.infer<
  typeof repositoryIntegrationPlanSchema
>;

interface IntegrationOptions {
  sourceRoot: string;
  prdPath: string;
  sourceManifestPath: string;
  proposalPath: string;
  productApprovalDigest: string;
  repositoryId: string;
  approvedBy: string;
  approvedAt: string;
  authorName: string;
  authorEmail: string;
}

interface PlannedIntegration {
  plan: RepositoryIntegrationPlan;
  approvalDigest: string;
  files: RecipeFile[];
}

interface ExistingFile {
  content: string;
  digest: string;
}

const gitEnvironment: NodeJS.ProcessEnv = {
  HOME: "/var/empty",
  LANG: "C",
  LC_ALL: "C",
  PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_PAGER: "cat",
  PAGER: "cat",
};

function digest(content: string): string {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

function slug(value: string): string {
  const normalized = value
    .toLowerCase()
    .normalize("NFKD")
    .replaceAll(/[^a-z0-9._-]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "")
    .slice(0, 48);
  return normalized.length === 0 ? "first-outcome" : normalized;
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function assertRelativePath(value: string, label: string): void {
  if (
    value.length === 0 ||
    path.isAbsolute(value) ||
    value.split(/[\\/]/u).includes("..") ||
    hasControlCharacter(value)
  ) {
    throw new MillError(
      "INVALID_INTEGRATION_PATH",
      `${label} must be a safe relative path.`,
      ExitCode.configuration,
      { value },
    );
  }
}

async function greenfieldTarget(
  sourceRoot: string,
  targetDirectory: string,
): Promise<{ target: string; parent: string }> {
  assertRelativePath(targetDirectory, "Target directory");
  const canonicalRoot = await realpath(sourceRoot);
  const segments = targetDirectory.split(/[\\/]/u).filter(Boolean);
  let current = canonicalRoot;
  for (const [index, segment] of segments.slice(0, -1).entries()) {
    current = path.join(current, segment);
    try {
      const information = await lstat(current);
      if (information.isSymbolicLink() || !information.isDirectory()) {
        throw new MillError(
          "GREENFIELD_TARGET_ANCESTOR_UNSAFE",
          "Greenfield target ancestors must be real directories inside the approved source root.",
          ExitCode.configuration,
          { path: segments.slice(0, index + 1).join("/") },
        );
      }
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        throw new MillError(
          "GREENFIELD_TARGET_ANCESTOR_UNSAFE",
          "Greenfield target parents must already exist as real directories inside the approved source root.",
          ExitCode.configuration,
          { path: segments.slice(0, index + 1).join("/") },
        );
      }
      throw error;
    }
  }
  const requestedTarget = path.resolve(canonicalRoot, targetDirectory);
  if (!isWithin(canonicalRoot, requestedTarget)) {
    throw new MillError(
      "GREENFIELD_TARGET_OUTSIDE_ROOT",
      "The greenfield target must remain inside the approved source root.",
      ExitCode.configuration,
    );
  }
  const canonicalParent = await realpath(path.dirname(requestedTarget));
  if (!isWithin(canonicalRoot, canonicalParent)) {
    throw new MillError(
      "GREENFIELD_TARGET_ANCESTOR_UNSAFE",
      "The greenfield target parent resolved outside the approved source root.",
      ExitCode.configuration,
    );
  }
  return {
    target: path.join(canonicalParent, path.basename(requestedTarget)),
    parent: canonicalParent,
  };
}

function assertIdentity(input: IntegrationOptions): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      input.repositoryId,
    )
  ) {
    throw new MillError(
      "INVALID_REPOSITORY_ID",
      "Repository integration requires one explicit UUIDv4 identity.",
      ExitCode.configuration,
    );
  }
  if (!validAuthorEmail(input.authorEmail)) {
    throw new MillError(
      "INVALID_AUTHOR_IDENTITY",
      "Repository integration requires an explicit valid author email.",
      ExitCode.configuration,
    );
  }
  if (
    input.authorName.trim().length === 0 ||
    input.approvedBy.trim().length === 0
  ) {
    throw new MillError(
      "INVALID_AUTHOR_IDENTITY",
      "Repository integration requires explicit author and approval identities.",
      ExitCode.configuration,
    );
  }
  const approval = z.iso.datetime().safeParse(input.approvedAt);
  if (!approval.success || Date.parse(input.approvedAt) > Date.now()) {
    throw new MillError(
      "INVALID_APPROVAL_TIME",
      "Repository integration requires an exact active ISO approval time.",
      ExitCode.configuration,
    );
  }
}

function validAuthorEmail(value: string): boolean {
  if (value.length > 254) return false;
  const separator = value.indexOf("@");
  if (
    separator <= 0 ||
    separator !== value.lastIndexOf("@") ||
    separator > 64
  ) {
    return false;
  }
  const local = value.slice(0, separator);
  const domain = value.slice(separator + 1);
  if (
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..") ||
    domain.length === 0 ||
    domain.length > 253
  ) {
    return false;
  }
  const localPunctuation = "!#$%&'*+-/=?^_`{|}~.";
  for (const character of local) {
    const code = character.codePointAt(0) ?? 0;
    const alphanumeric =
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122);
    if (!alphanumeric && !localPunctuation.includes(character)) return false;
  }
  const labels = domain.split(".");
  if (labels.length < 2) return false;
  for (const label of labels) {
    if (label.length === 0 || label.length > 63) return false;
    for (let index = 0; index < label.length; index += 1) {
      const code = label.codePointAt(index) ?? 0;
      const alphanumeric =
        (code >= 48 && code <= 57) ||
        (code >= 65 && code <= 90) ||
        (code >= 97 && code <= 122);
      if (
        !alphanumeric &&
        (label[index] !== "-" || index === 0 || index === label.length - 1)
      ) {
        return false;
      }
    }
  }
  return true;
}

async function authority(input: IntegrationOptions): Promise<{
  prd: string;
  sourceManifest: Awaited<
    ReturnType<typeof loadPlanningSources>
  >["sourceManifest"];
  proposal: SpecificationProposal;
  proposalDigest: string;
}> {
  assertIdentity(input);
  const [planning, proposal] = await Promise.all([
    loadPlanningSources({
      root: input.sourceRoot,
      prdPath: input.prdPath,
      sourceManifestPath: input.sourceManifestPath,
    }),
    loadSpecificationProposal(input.sourceRoot, input.proposalPath),
  ]);
  const assessment = assessSpecificationProposal({
    proposal,
    prdPath: planning.prdPath,
    prdDigest: planning.prdDigest,
    sourceManifest: planning.sourceManifest,
    sourceManifestDigest: planning.sourceManifestDigest,
  });
  const promoted = promoteSpecificationProposal({
    proposal,
    approvalDigest: input.productApprovalDigest,
    assessment,
  });
  return {
    prd: planning.prd,
    sourceManifest: planning.sourceManifest,
    proposal,
    proposalDigest: promoted.proposalDigest,
  };
}

function assertApprovedRecipe(
  approved: Awaited<ReturnType<typeof authority>>,
  recipe: Awaited<ReturnType<typeof loadNodeWebRecipe>>,
): void {
  const blueprint = approved.proposal.blueprints[0];
  const runtime = `node-${recipe.manifest.runtime.node}-npm-${recipe.manifest.runtime.npm}`;
  if (
    blueprint?.recipe !== recipe.manifest.id ||
    blueprint.recipeVersion !== recipe.manifest.version ||
    blueprint.runtime !== runtime
  ) {
    throw new MillError(
      "APPROVED_RECIPE_UNSUPPORTED",
      "The approved blueprint does not select the exact supported recipe, version, and runtime.",
      ExitCode.configuration,
      {
        approvedRecipe: blueprint?.recipe ?? null,
        approvedVersion: blueprint?.recipeVersion ?? null,
        approvedRuntime: blueprint?.runtime ?? null,
        supportedRecipe: recipe.manifest.id,
        supportedVersion: recipe.manifest.version,
        supportedRuntime: runtime,
      },
    );
  }
}

function yaml(value: unknown): string {
  return stringifyYaml(value, { lineWidth: 88 });
}

function recipeCommands(
  nativeCommands: readonly string[],
  writablePaths: readonly string[],
): Record<string, unknown> {
  const controlPaths: Record<string, string[]> = {
    "format:check": ["package.json", "package-lock.json"],
    lint: ["package.json", "package-lock.json", "eslint.config.mjs"],
    typecheck: [
      "package.json",
      "package-lock.json",
      "tsconfig.json",
      "next-env.d.ts",
    ],
    "test:unit": ["package.json", "package-lock.json", "test/unit/**"],
    "test:integration": [
      "package.json",
      "package-lock.json",
      "test/integration/**",
    ],
    "test:browser": [
      "package.json",
      "package-lock.json",
      "playwright.config.ts",
      "test/browser/**",
    ],
    "test:package": [
      "package.json",
      "package-lock.json",
      "next.config.ts",
      "scripts/check-package.mjs",
    ],
    check: [
      "package.json",
      "package-lock.json",
      "eslint.config.mjs",
      "tsconfig.json",
      "next.config.ts",
      "playwright.config.ts",
      "scripts/check-package.mjs",
      "test/**",
    ],
  };
  return Object.fromEntries(
    nativeCommands.map((id) => [
      id,
      {
        argv: ["npm", "run", id],
        cwd: ".",
        controlPaths: controlPaths[id] ?? ["package.json", "package-lock.json"],
        capability: id === "test:package" ? "package" : "test",
        required: true,
        timeoutSeconds: id === "check" ? 900 : 300,
        execution: "oci",
        writablePaths,
      },
    ]),
  );
}

function selectedOutcome(proposal: SpecificationProposal) {
  const outcome = proposal.productContract.outcomes[0];
  if (outcome === undefined) {
    throw new MillError(
      "OUTCOME_REQUIRED",
      "Repository integration requires at least one approved product outcome.",
      ExitCode.configuration,
    );
  }
  const acceptanceIds =
    outcome.acceptanceIds ??
    proposal.productContract.acceptance.map((item) => item.id);
  const acceptanceSet = new Set(acceptanceIds);
  const scenarios = proposal.scenarioSet.scenarios.filter((scenario) =>
    scenario.acceptanceRefs.some((id) => acceptanceIds.includes(id)),
  );
  const crossingScenario = scenarios.find((scenario) =>
    scenario.acceptanceRefs.some((id) => !acceptanceSet.has(id)),
  );
  if (crossingScenario !== undefined) {
    throw new MillError(
      "OUTCOME_SCENARIO_SCOPE_INVALID",
      "A selected first-outcome scenario cannot reference acceptance outside that outcome.",
      ExitCode.configuration,
      { scenarioId: crossingScenario.id },
    );
  }
  if (acceptanceIds.length === 0 || scenarios.length === 0) {
    throw new MillError(
      "OUTCOME_ORACLE_REQUIRED",
      "The first outcome requires explicit acceptance IDs and approved scenarios before recipe apply.",
      ExitCode.configuration,
    );
  }
  return { outcome, acceptanceIds, scenarios };
}

function dynamicFiles(input: {
  options: IntegrationOptions;
  authority: Awaited<ReturnType<typeof authority>>;
  mode: "greenfield" | "adoption";
  baseCommit: string | null;
  recipe: Awaited<ReturnType<typeof loadNodeWebRecipe>>;
  nativeCommands: readonly string[];
  existingByPath: ReadonlyMap<string, ExistingFile>;
}): RecipeFile[] {
  const { proposal } = input.authority;
  const selection = selectedOutcome(proposal);
  const supportedCommands = new Set(input.nativeCommands);
  const recipeOracles = new Map(
    input.recipe.manifest.oracles.map((oracle) => [oracle.id, oracle]),
  );
  const commandIds = new Set<string>();
  for (const scenario of selection.scenarios) {
    const recipeOracle =
      scenario.recipeOracle === undefined
        ? undefined
        : recipeOracles.get(scenario.recipeOracle);
    if (
      recipeOracle === undefined ||
      scenario.executionRef === undefined ||
      recipeOracle.commandId !== scenario.executionRef ||
      !supportedCommands.has(scenario.executionRef)
    ) {
      throw new MillError(
        "RECIPE_SCENARIO_UNSUPPORTED",
        "An approved first-outcome scenario requires an explicit matching recipe-specific oracle.",
        ExitCode.configuration,
        {
          scenarioId: scenario.id,
          recipeOracle: scenario.recipeOracle ?? null,
          executionRef: scenario.executionRef ?? null,
        },
      );
    }
    commandIds.add(scenario.executionRef);
  }
  for (const invariant of proposal.productContract.invariants) {
    if (
      selection.scenarios.some((scenario) =>
        scenario.invariantRefs.includes(invariant.id),
      )
    ) {
      if (invariant.verification.mode !== "command") {
        throw new MillError(
          "RECIPE_INVARIANT_UNSUPPORTED",
          "A recipe-generated task requires command-verifiable affected invariants.",
          ExitCode.configuration,
          {
            invariantId: invariant.id,
            verificationMode: invariant.verification.mode,
          },
        );
      }
      if (!supportedCommands.has(invariant.verification.ref)) {
        throw new MillError(
          "RECIPE_INVARIANT_UNSUPPORTED",
          "An affected invariant is not mapped to a supported native recipe command.",
          ExitCode.configuration,
          {
            invariantId: invariant.id,
            executionRef: invariant.verification.ref,
          },
        );
      }
      commandIds.add(invariant.verification.ref);
    }
  }
  if (!supportedCommands.has("check")) {
    throw new MillError(
      "RECIPE_FULL_GATE_UNAVAILABLE",
      "Repository integration requires one native check command for preservation evidence.",
      ExitCode.configuration,
    );
  }
  commandIds.add("check");
  const productContractDigest = canonicalDigest(
    proposal.productContract as unknown as JsonValue,
  );
  const outcomeSlug = slug(selection.outcome.id.replace(/^OUT-/u, ""));
  const impactPath = `product/impacts/${outcomeSlug}.yaml`;
  const taskPath = `product/tasks/${outcomeSlug}.yaml`;
  const acceptance = selection.acceptanceIds.map((id) => {
    const contract = proposal.productContract.acceptance.find(
      (item) => item.id === id,
    );
    if (contract === undefined) {
      throw new MillError(
        "OUTCOME_ACCEPTANCE_UNRESOLVED",
        "The first outcome references an unknown acceptance item.",
        ExitCode.configuration,
        { acceptanceId: id },
      );
    }
    const scenarios = selection.scenarios.filter((scenario) =>
      scenario.acceptanceRefs.includes(id),
    );
    const executionRef = scenarios[0]?.executionRef;
    if (executionRef === undefined) {
      throw new MillError(
        "OUTCOME_ORACLE_REQUIRED",
        "Each first-outcome acceptance item requires an executable approved scenario.",
        ExitCode.configuration,
        { acceptanceId: id },
      );
    }
    return {
      id,
      statement: contract.statement,
      invariantIds: [
        ...new Set(scenarios.flatMap((item) => item.invariantRefs)),
      ],
      scenarioIds: scenarios.map((item) => item.id),
      coverage: scenarios.every((item) => item.coverage === "new_behavior")
        ? "new_behavior"
        : scenarios.every((item) => item.coverage === "preservation")
          ? "preservation"
          : "both",
      evidence: { mode: "command", commandId: executionRef },
    } as const;
  });
  const affectedInvariantIds = [
    ...new Set(
      selection.scenarios.flatMap((scenario) => scenario.invariantRefs),
    ),
  ];
  let riskClass: "low" | "medium" | "high" = "low";
  for (const invariant of proposal.productContract.invariants) {
    if (!affectedInvariantIds.includes(invariant.id)) continue;
    if (
      invariant.criticality === "high" ||
      invariant.criticality === "critical"
    ) {
      riskClass = "high";
      break;
    }
    if (invariant.criticality === "medium") riskClass = "medium";
  }
  if (
    riskClass !== "low" &&
    !selection.scenarios.some((scenario) => scenario.kind !== "normal")
  ) {
    throw new MillError(
      "OUTCOME_RISK_EVIDENCE_REQUIRED",
      "A medium- or high-risk outcome requires an approved non-normal executable scenario.",
      ExitCode.configuration,
      { riskClass, affectedInvariantIds },
    );
  }
  const impactProposal = {
    schemaVersion: "1" as const,
    id: outcomeSlug,
    productContractDigest,
    outcomeId: selection.outcome.id,
    riskClass,
    acceptanceIds: selection.acceptanceIds,
    affectedInvariantIds,
    uncertainInvariantIds: [],
    surfaces: [
      {
        id: "web-product",
        kind: "user" as const,
        change: selection.outcome.statement,
      },
    ],
    scenarioIds: selection.scenarios.map((scenario) => scenario.id),
    commandIds: [...commandIds].sort(),
    materialDecisions: proposal.productContract.decisions
      .filter((decision) => decision.status === "approved")
      .map((decision) => decision.id),
    unresolved: [],
    exceptions: [],
    approval: null,
  };
  const impact = {
    ...impactProposal,
    approval: {
      approvedBy: input.options.approvedBy,
      approvedAt: input.options.approvedAt,
      proposalDigest: canonicalDigest(impactProposal),
    },
  };
  const product = yaml(proposal.productContract);
  const scenarios = yaml(proposal.scenarioSet);
  const policy =
    input.existingByPath.get("WORKFLOW.md")?.content ??
    "# Delivery workflow\n\nEvery product change binds approved product, scenario, architecture, impact,\ntask, and exact-base identities. A candidate is committed before the complete\nnative gate and independent review. Only the attended shipper may open a draft\npull request, and a configured human remains the merge authority.\n";
  const blueprint = yaml(proposal.blueprints[0]);
  const plan = yaml({
    schemaVersion: "1",
    productContractDigest,
    outcomes: proposal.productContract.outcomes.map((outcome, index) => ({
      id: outcome.id,
      title: outcome.statement,
      acceptance: (
        outcome.acceptanceIds ??
        proposal.productContract.acceptance.map((item) => item.id)
      )
        .map(
          (id) =>
            proposal.productContract.acceptance.find((item) => item.id === id)
              ?.statement,
        )
        .filter((value): value is string => value !== undefined),
      acceptanceIds:
        outcome.acceptanceIds ??
        proposal.productContract.acceptance.map((item) => item.id),
      dependsOn:
        index === 0
          ? []
          : [proposal.productContract.outcomes[index - 1]?.id].filter(
              (value): value is string => value !== undefined,
            ),
      status: index === 0 ? "ready" : "approved",
      ...(index === 0 ? { taskRef: taskPath } : {}),
    })),
  });
  const impactSource = yaml(impact);
  const prdTarget =
    input.mode === "greenfield" ? "product/PRD.md" : input.options.prdPath;
  assertRelativePath(prdTarget, "PRD integration path");
  const builderAllowedPaths = ["app/**", "public/**", "src/**"];
  if (
    builderAllowedPaths.some((pattern) => {
      const prefix = pattern.slice(0, -3);
      return prdTarget === prefix || prdTarget.startsWith(`${prefix}/`);
    })
  ) {
    throw new MillError(
      "PRD_BUILDER_SCOPE_OVERLAP",
      "The approved PRD cannot be placed inside the generated builder-writable scope.",
      ExitCode.configuration,
      { path: prdTarget },
    );
  }
  const task = taskPacketV2Schema.parse({
    schemaVersion: "2",
    id: outcomeSlug,
    title: selection.outcome.statement,
    objective: selection.outcome.statement,
    riskClass,
    baseRef: "HEAD",
    authority: {
      productContract: {
        path: "product/contract.yaml",
        digest: textDigest(product),
      },
      scenarioSet: {
        path: "quality/scenarios.yaml",
        digest: textDigest(scenarios),
      },
      policy: { path: "WORKFLOW.md", digest: textDigest(policy) },
      impactManifest: { path: impactPath, digest: textDigest(impactSource) },
    },
    contextPaths: [
      "WORKFLOW.md",
      "architecture/blueprint.yaml",
      "product/contract.yaml",
      "quality/scenarios.yaml",
      prdTarget,
    ],
    allowedPaths: builderAllowedPaths,
    commandIds: [...commandIds].sort(),
    attestations: [],
    acceptance,
    commit: {
      message: `feat: deliver ${outcomeSlug}\n\nSigned-off-by: ${input.options.authorName} <${input.options.authorEmail}>`,
      authorName: input.options.authorName,
      authorEmail: input.options.authorEmail,
    },
    budget: {
      deadlineSeconds: 3600,
      maxOutputBytes: 2_000_000,
      retryCount: 1,
    },
  });
  const config = millConfigSchema.parse({
    schemaVersion: "1",
    repositoryId: input.options.repositoryId,
    trustCeiling: "build",
    sensitivePaths: [
      ".env",
      ".env.local",
      ".env.production",
      ".env.development",
      ".env.test",
      ".npmrc",
      "config/credentials.json",
    ],
    verifier: {
      image: input.recipe.manifest.verifierImage,
      network: "none",
      dependencies: {
        manager: "npm",
        registry: input.recipe.manifest.registry,
        targetPath: "node_modules",
        lockPaths: ["package.json", "package-lock.json"],
      },
    },
    commands: recipeCommands(
      input.mode === "greenfield"
        ? input.nativeCommands
        : [...commandIds].sort(),
      input.recipe.manifest.writablePaths,
    ),
  });
  const sourcePrdPath = path
    .normalize(input.options.prdPath)
    .split(path.sep)
    .join("/");
  const prdDigest = textDigest(input.authority.prd);
  let prdSourceCount = 0;
  let prdSourceId: string | undefined;
  const sourceManifest = {
    ...input.authority.sourceManifest,
    sources: input.authority.sourceManifest.sources.map((source) => {
      const sourceUri = path.normalize(source.uri).split(path.sep).join("/");
      if (sourceUri !== sourcePrdPath) return source;
      prdSourceCount += 1;
      prdSourceId = source.id;
      if (source.revision !== prdDigest && source.digest !== prdDigest) {
        throw new MillError(
          "PRD_SOURCE_IDENTITY_MISMATCH",
          "The PRD source entry must bind the exact approved PRD digest.",
          ExitCode.configuration,
          { sourceId: source.id },
        );
      }
      return {
        ...source,
        uri: prdTarget,
        revision: prdDigest,
        digest: prdDigest,
      };
    }),
  };
  if (prdSourceCount !== 1) {
    throw new MillError(
      "PRD_SOURCE_IDENTITY_REQUIRED",
      "Repository integration requires exactly one source entry for the approved PRD.",
      ExitCode.configuration,
      { prdPath: input.options.prdPath, matches: prdSourceCount },
    );
  }
  if (
    prdSourceId === undefined ||
    !proposal.productContract.sourceRefs.includes(prdSourceId)
  ) {
    throw new MillError(
      "PRD_SOURCE_PRODUCT_BINDING_REQUIRED",
      "The approved product contract must bind the exact PRD source used for repository integration.",
      ExitCode.configuration,
      { sourceId: prdSourceId ?? null },
    );
  }
  const values: [string, string, FileOwnership][] = [
    [prdTarget, input.authority.prd, "generated_once"],
    ["product/sources.yaml", yaml(sourceManifest), "generated_once"],
    ["product/contract.yaml", product, "generated_once"],
    ["quality/scenarios.yaml", scenarios, "generated_once"],
    ["architecture/blueprint.yaml", blueprint, "generated_once"],
    ["product/plan.yaml", plan, "generated_once"],
    [impactPath, impactSource, "generated_once"],
    [taskPath, yaml(task), "generated_once"],
    ["mill.yaml", yaml(config), "mill_only"],
    ...(input.mode === "adoption"
      ? ([["WORKFLOW.md", policy, "generated_once"]] as [
          string,
          string,
          FileOwnership,
        ][])
      : []),
  ];
  return values.map(([file, content, ownership]) => ({
    path: file,
    content,
    contentDigest: digest(content),
    ownership,
  }));
}

async function existingFile(
  root: string,
  relative: string,
): Promise<ExistingFile | undefined> {
  try {
    const information = await lstat(path.join(root, relative));
    if (
      !information.isFile() ||
      information.isSymbolicLink() ||
      information.size > 8 * 1024 * 1024
    ) {
      throw new MillError(
        "INTEGRATION_FILE_UNSAFE",
        "An integration target is not a bounded regular file.",
        ExitCode.configuration,
        { path: relative },
      );
    }
    const content = await readFile(path.join(root, relative), "utf8");
    return { content, digest: digest(content) };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return undefined;
    throw error;
  }
}

async function existingMap(
  root: string,
  paths: readonly string[],
): Promise<Map<string, ExistingFile>> {
  const entries = await Promise.all(
    [...new Set(paths)].map(
      async (relative) =>
        [relative, await existingFile(root, relative)] as const,
    ),
  );
  return new Map(
    entries.filter(
      (entry): entry is readonly [string, ExistingFile] =>
        entry[1] !== undefined,
    ),
  );
}

async function commitFile(
  root: string,
  commit: string,
  relative: string,
  maxOutputBytes = 8 * 1024 * 1024,
): Promise<ExistingFile | undefined> {
  assertRelativePath(relative, "Committed integration file");
  const listing = await git(
    root,
    [
      "ls-tree",
      "-z",
      "--full-tree",
      "--format=%(objectmode)%x09%(objecttype)%x09%(path)",
      commit,
      "--",
      relative,
    ],
    undefined,
    256 * 1024,
  );
  if (listing.length === 0) return undefined;
  const records = listing.split("\0").filter(Boolean);
  if (records.length !== 1) {
    throw new MillError(
      "INTEGRATION_BASE_FILE_UNSAFE",
      "An exact-base integration path did not resolve to one regular Git blob.",
      ExitCode.configuration,
      { path: relative },
    );
  }
  const [mode, type, listedPath] = records[0]?.split("\t") ?? [];
  if (
    (mode !== "100644" && mode !== "100755") ||
    type !== "blob" ||
    listedPath !== relative
  ) {
    throw new MillError(
      "INTEGRATION_BASE_FILE_UNSAFE",
      "An exact-base integration path is not a bounded regular Git file.",
      ExitCode.configuration,
      { path: relative, mode, type },
    );
  }
  const content = await git(
    root,
    ["cat-file", "blob", `${commit}:${relative}`],
    undefined,
    maxOutputBytes,
  );
  return { content, digest: digest(content) };
}

async function existingMapAtCommit(
  root: string,
  commit: string,
  paths: readonly string[],
): Promise<Map<string, ExistingFile>> {
  const entries = await Promise.all(
    [...new Set(paths)].map(
      async (relative) =>
        [relative, await commitFile(root, commit, relative)] as const,
    ),
  );
  return new Map(
    entries.filter(
      (entry): entry is readonly [string, ExistingFile] =>
        entry[1] !== undefined,
    ),
  );
}

function lockFile(input: {
  mode: "greenfield" | "adoption";
  planDigest: string;
  baseCommit: string | null;
  recipe: Awaited<ReturnType<typeof loadNodeWebRecipe>>;
  files: readonly RecipeFile[];
  existingByPath: ReadonlyMap<string, ExistingFile>;
}): RecipeFile {
  const lock = millLockSchema.parse({
    schemaVersion: "1",
    mill: { package: MILL_PACKAGE, version: MILL_VERSION },
    schemaDigests: {},
    recipe: {
      id: input.recipe.manifest.id,
      version: input.recipe.manifest.version,
      digest: input.recipe.digest,
    },
    integration: {
      mode: input.mode,
      planDigest: input.planDigest,
      baseCommit: input.baseCommit,
      files: input.files.map((file) => ({
        path: file.path,
        ownership: file.ownership,
        templateDigest: file.contentDigest,
        installedDigest: file.contentDigest,
        preexistingDigest: input.existingByPath.get(file.path)?.digest ?? null,
      })),
    },
  });
  const content = yaml(lock);
  return {
    path: "mill.lock",
    content,
    contentDigest: digest(content),
    ownership: "mill_only",
  };
}

function integrationPlanBody(input: {
  mode: "greenfield" | "adoption";
  directoryName: string;
  canonicalTargetPath: string;
  baseCommit: string | null;
  scan: RepositoryScan | null;
  authority: Awaited<ReturnType<typeof authority>>;
  recipe: Awaited<ReturnType<typeof loadNodeWebRecipe>>;
  files: readonly RecipeFile[];
  existingByPath: ReadonlyMap<string, ExistingFile>;
  options: IntegrationOptions;
}) {
  return {
    generator: { package: MILL_PACKAGE, version: MILL_VERSION },
    mode: input.mode,
    target: {
      directoryName: input.directoryName,
      canonicalPathDigest: canonicalDigest({
        canonicalPath: input.canonicalTargetPath,
      }),
      baseCommit: input.baseCommit,
      scanDigest: input.scan?.digest ?? null,
    },
    productProposalDigest: input.authority.proposalDigest,
    productContractDigest: canonicalDigest(
      input.authority.proposal.productContract as unknown as JsonValue,
    ),
    recipe: {
      id: input.recipe.manifest.id,
      version: input.recipe.manifest.version,
      digest: input.recipe.digest,
      status: "supported" as const,
      verifierImage: input.recipe.manifest.verifierImage,
    },
    approval: {
      approvedBy: input.options.approvedBy,
      approvedAt: input.options.approvedAt,
    },
    files: input.files.map((file) => ({
      path: file.path,
      ownership: file.ownership,
      action: input.existingByPath.has(file.path)
        ? ("retain_identical" as const)
        : ("create" as const),
      contentDigest: file.contentDigest,
      preexistingDigest: input.existingByPath.get(file.path)?.digest ?? null,
    })),
    commandIds: input.recipe.manifest.commands.required,
    networkDisclosure:
      input.mode === "greenfield"
        ? [`HTTPS package installation from ${input.recipe.manifest.registry}`]
        : [],
    baseline: "unverified" as const,
  };
}

function integrationPlanIdentity(
  input: Parameters<typeof integrationPlanBody>[0],
): string {
  return canonicalDigest({
    schemaVersion: "1",
    ...integrationPlanBody(input),
    derivedFiles: [
      {
        path: "mill.lock",
        ownership: "mill_only",
        derivation: "mill-lock-v1-from-plan-digest-and-generator",
      },
    ],
  });
}

function integrationPlan(input: {
  mode: "greenfield" | "adoption";
  directoryName: string;
  canonicalTargetPath: string;
  baseCommit: string | null;
  scan: RepositoryScan | null;
  authority: Awaited<ReturnType<typeof authority>>;
  recipe: Awaited<ReturnType<typeof loadNodeWebRecipe>>;
  files: readonly RecipeFile[];
  existingByPath: ReadonlyMap<string, ExistingFile>;
  options: IntegrationOptions;
  planDigest: string;
}): { plan: RepositoryIntegrationPlan; approvalDigest: string } {
  const plan = repositoryIntegrationPlanSchema.parse({
    schemaVersion: "1",
    planDigest: input.planDigest,
    ...integrationPlanBody(input),
  });
  return {
    plan,
    approvalDigest: input.planDigest,
  };
}

async function assertCompatibleAdoption(
  root: string,
  baseCommit: string,
  productTitle: string,
): Promise<{ nativeCommands: string[] }> {
  const [packageSource, lockSource, currentPackage, currentLock] =
    await Promise.all([
      commitFile(root, baseCommit, "package.json", 2 * 1024 * 1024),
      commitFile(root, baseCommit, "package-lock.json", 8 * 1024 * 1024),
      existingFile(root, "package.json"),
      existingFile(root, "package-lock.json"),
    ]);
  if (packageSource === undefined || lockSource === undefined) {
    throw new MillError(
      "ADOPTION_MANIFEST_INVALID",
      "Compatible adoption requires package.json and package-lock.json in the exact base commit.",
      ExitCode.configuration,
    );
  }
  let packageJson: Record<string, unknown>;
  let packageLock: JsonValue;
  try {
    packageJson = JSON.parse(packageSource.content) as Record<string, unknown>;
    packageLock = JSON.parse(lockSource.content) as JsonValue;
    JSON.parse(currentPackage?.content ?? "");
    JSON.parse(currentLock?.content ?? "");
  } catch (error) {
    throw new MillError(
      "ADOPTION_MANIFEST_INVALID",
      "Compatible adoption requires valid package.json and package-lock.json files.",
      ExitCode.data,
      { cause: String(error) },
    );
  }
  if (
    currentPackage?.digest !== packageSource.digest ||
    currentLock?.digest !== lockSource.digest
  ) {
    throw new MillError(
      "ADOPTION_ORACLE_INCOMPATIBLE",
      "Compatible adoption requires the working dependency manifests to match the exact base bytes.",
      ExitCode.configuration,
    );
  }
  const projectName = packageJson.name;
  if (typeof projectName !== "string" || projectName.length === 0) {
    throw new MillError(
      "ADOPTION_MANIFEST_INVALID",
      "Compatible adoption requires one explicit package name.",
      ExitCode.configuration,
    );
  }
  const rendered = await renderNodeWebRecipe({ projectName, productTitle });
  const renderedByPath = new Map(rendered.map((file) => [file.path, file]));
  const expectedPackage = JSON.parse(
    renderedByPath.get("package.json")?.content ?? "{}",
  ) as Record<string, unknown>;
  const expectedLock = JSON.parse(
    renderedByPath.get("package-lock.json")?.content ?? "{}",
  ) as JsonValue;
  if (canonicalDigest(packageLock) !== canonicalDigest(expectedLock)) {
    throw new MillError(
      "ADOPTION_ORACLE_INCOMPATIBLE",
      "Compatible adoption requires the exact qualified dependency lock graph.",
      ExitCode.configuration,
      { path: "package-lock.json" },
    );
  }
  for (const field of [
    "type",
    "engines",
    "packageManager",
    "scripts",
    "dependencies",
    "devDependencies",
  ]) {
    const actualValue = packageJson[field];
    const expectedValue = expectedPackage[field];
    if (
      actualValue === undefined ||
      expectedValue === undefined ||
      canonicalDigest(actualValue as JsonValue) !==
        canonicalDigest(expectedValue as JsonValue)
    ) {
      throw new MillError(
        "ADOPTION_ORACLE_INCOMPATIBLE",
        "Compatible adoption requires exact qualified runtime, dependency, and native-oracle pins.",
        ExitCode.configuration,
        { field },
      );
    }
  }
  const dependencies = packageJson.dependencies as
    Record<string, unknown> | undefined;
  const devDependencies = packageJson.devDependencies as
    Record<string, unknown> | undefined;
  const nextVersion = dependencies?.next;
  const reactVersion = dependencies?.react;
  const reactDomVersion = dependencies?.["react-dom"];
  if (
    nextVersion !== "16.3.4" ||
    reactVersion !== "19.2.8" ||
    reactDomVersion !== "19.2.8" ||
    devDependencies?.typescript !== "6.0.3"
  ) {
    throw new MillError(
      "ADOPTION_RECIPE_INCOMPATIBLE",
      "The first adoption mapping supports only the exact qualified Next.js 16.3.4, React 19.2.8, and TypeScript 6.0.3 tuple.",
      ExitCode.configuration,
    );
  }
  const scripts = packageJson.scripts as Record<string, unknown> | undefined;
  const nativeCommands = Object.entries(scripts ?? {})
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([id]) => id);
  if (!nativeCommands.includes("check")) {
    throw new MillError(
      "ADOPTION_COMMANDS_INCOMPATIBLE",
      "Compatible adoption requires one existing native check script; Mill will not invent or replace it.",
      ExitCode.configuration,
    );
  }
  const requiredScripts = {
    "format:check": "prettier --check .",
    lint: "eslint . --max-warnings 0",
    typecheck: "tsc --noEmit",
    "test:unit": "vitest run test/unit",
    "test:integration": "vitest run test/integration",
    "test:browser": "playwright test",
    "test:package": "npm run build && node scripts/check-package.mjs",
    check:
      "npm run format:check && npm run lint && npm run typecheck && npm run test:unit && npm run test:integration && npm run test:browser && npm run test:package",
  } as const;
  for (const [id, expected] of Object.entries(requiredScripts)) {
    if (scripts?.[id] !== expected) {
      throw new MillError(
        "ADOPTION_ORACLE_INCOMPATIBLE",
        "Compatible adoption requires the exact qualified native check closure; Mill will not infer an existing repository's oracle graph.",
        ExitCode.configuration,
        { commandId: id },
      );
    }
  }
  try {
    await Promise.all(
      [
        ".node-version",
        ".tool-versions",
        "eslint.config.mjs",
        "tsconfig.json",
        "next-env.d.ts",
        "next.config.ts",
        "playwright.config.ts",
        "scripts/check-package.mjs",
        "test/unit/health.test.ts",
        "test/integration/health-route.test.ts",
        "test/browser/home.spec.ts",
      ].map(async (relative) => {
        const [actual, current] = await Promise.all([
          commitFile(root, baseCommit, relative, 2 * 1024 * 1024),
          existingFile(root, relative),
        ]);
        const expected = renderedByPath.get(relative);
        if (
          actual?.digest !== expected?.contentDigest ||
          current?.digest !== actual?.digest
        ) {
          throw new MillError(
            "ADOPTION_ORACLE_INCOMPATIBLE",
            "Compatible adoption requires exact qualified native oracle bytes.",
            ExitCode.configuration,
            { path: relative },
          );
        }
      }),
    );
  } catch (error) {
    throw new MillError(
      "ADOPTION_ORACLE_INCOMPATIBLE",
      "Compatible adoption requires the exact qualified native oracle files.",
      ExitCode.configuration,
      { cause: String(error) },
    );
  }
  return { nativeCommands };
}

function assertNoConflicts(
  files: readonly RecipeFile[],
  existing: ReadonlyMap<string, ExistingFile>,
): void {
  for (const file of files) {
    const current = existing.get(file.path);
    if (current !== undefined && current.digest !== file.contentDigest) {
      throw new MillError(
        "ADOPTION_AUTHORITY_CONFLICT",
        "Adoption would overwrite an existing authority or generated path.",
        ExitCode.configuration,
        { path: file.path },
      );
    }
  }
}

export async function planGreenfieldIntegration(
  input: IntegrationOptions & {
    targetDirectory: string;
  },
): Promise<PlannedIntegration> {
  const { target } = await greenfieldTarget(
    input.sourceRoot,
    input.targetDirectory,
  );
  try {
    await lstat(target);
    throw new MillError(
      "GREENFIELD_TARGET_EXISTS",
      "Greenfield apply requires a target path that does not yet exist.",
      ExitCode.configuration,
    );
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  const [approved, recipe] = await Promise.all([
    authority(input),
    loadNodeWebRecipe(),
  ]);
  assertApprovedRecipe(approved, recipe);
  const template = await renderNodeWebRecipe({
    projectName: path.basename(target),
    productTitle: approved.proposal.productContract.title,
  });
  const existingByPath = new Map<string, ExistingFile>();
  const dynamic = dynamicFiles({
    options: input,
    authority: approved,
    mode: "greenfield",
    baseCommit: null,
    recipe,
    nativeCommands: recipe.manifest.commands.native,
    existingByPath,
  });
  const withoutLock = [...template, ...dynamic].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  const planInput = {
    mode: "greenfield" as const,
    directoryName: input.targetDirectory,
    canonicalTargetPath: target,
    baseCommit: null,
    scan: null,
    authority: approved,
    recipe,
    files: withoutLock,
    existingByPath,
    options: input,
  };
  const planDigest = integrationPlanIdentity(planInput);
  const files = [
    ...withoutLock,
    lockFile({
      mode: "greenfield",
      planDigest,
      baseCommit: null,
      recipe,
      files: withoutLock,
      existingByPath,
    }),
  ].sort((left, right) => left.path.localeCompare(right.path));
  const planned = integrationPlan({
    ...planInput,
    files,
    planDigest,
  });
  return { ...planned, files };
}

export async function planAdoptionIntegration(
  input: IntegrationOptions & {
    repositoryRoot: string;
  },
): Promise<PlannedIntegration> {
  const root = await realpath(input.repositoryRoot);
  await assertVisibleIndexState(root);
  const baseCommit = await resolveCommit(root, "HEAD");
  const [approved, recipe, scan] = await Promise.all([
    authority(input),
    loadNodeWebRecipe(),
    scanRepository(root),
  ]);
  assertApprovedRecipe(approved, recipe);
  const compatibility = await assertCompatibleAdoption(
    root,
    baseCommit,
    approved.proposal.productContract.title,
  );
  if (
    scan.gitConfigHazards.length > 0 ||
    scan.truncatedDirectories.length > 0 ||
    scan.symlinksSkipped.length > 0 ||
    scan.secretReferences.length > 0
  ) {
    throw new MillError(
      "ADOPTION_SCAN_BLOCKED",
      "Adoption requires a complete static scan with no Git hazards, symbolic links, or credential-like files.",
      ExitCode.configuration,
      {
        gitConfigHazards: scan.gitConfigHazards,
        truncatedDirectories: scan.truncatedDirectories,
        symlinksSkipped: scan.symlinksSkipped,
        secretReferences: scan.secretReferences,
      },
    );
  }
  const candidatePaths = [
    "WORKFLOW.md",
    "README.md",
    input.prdPath,
    "product/sources.yaml",
    "product/contract.yaml",
    "quality/scenarios.yaml",
    "architecture/blueprint.yaml",
    "product/plan.yaml",
    "mill.yaml",
    "mill.lock",
  ];
  const [initialExisting, workingExisting] = await Promise.all([
    existingMapAtCommit(root, baseCommit, candidatePaths),
    existingMap(root, candidatePaths),
  ]);
  if (
    initialExisting.has("mill.yaml") ||
    initialExisting.has("mill.lock") ||
    workingExisting.has("mill.yaml") ||
    workingExisting.has("mill.lock")
  ) {
    throw new MillError(
      "REPOSITORY_ALREADY_MANAGED",
      "Adoption apply is only for a repository without an existing Mill integration.",
      ExitCode.configuration,
    );
  }
  const dynamic = dynamicFiles({
    options: input,
    authority: approved,
    mode: "adoption",
    baseCommit,
    recipe,
    nativeCommands: compatibility.nativeCommands,
    existingByPath: initialExisting,
  });
  const [existingByPath, workingDynamic] = await Promise.all([
    existingMapAtCommit(
      root,
      baseCommit,
      dynamic.map((file) => file.path),
    ),
    existingMap(
      root,
      dynamic.map((file) => file.path),
    ),
  ]);
  assertNoConflicts(dynamic, existingByPath);
  assertNoConflicts(dynamic, workingDynamic);
  const withoutLock = dynamic.sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  const planInput = {
    mode: "adoption" as const,
    directoryName: path.basename(root),
    canonicalTargetPath: root,
    baseCommit,
    scan,
    authority: approved,
    recipe,
    files: withoutLock,
    existingByPath,
    options: input,
  };
  const planDigest = integrationPlanIdentity(planInput);
  const files = [
    ...withoutLock,
    lockFile({
      mode: "adoption",
      planDigest,
      baseCommit,
      recipe,
      files: withoutLock,
      existingByPath,
    }),
  ].sort((left, right) => left.path.localeCompare(right.path));
  const planned = integrationPlan({
    ...planInput,
    files,
    planDigest,
  });
  return { ...planned, files };
}

async function writeFiles(
  root: string,
  files: readonly RecipeFile[],
): Promise<void> {
  const canonicalRoot = await realpath(root);
  for (const file of files) {
    assertRelativePath(file.path, "Integration file");
    const parentSegments = path
      .dirname(file.path)
      .split(/[\\/]/u)
      .filter((segment) => segment !== "." && segment !== "");
    let parent = canonicalRoot;
    for (const segment of parentSegments) {
      parent = path.join(parent, segment);
      try {
        await mkdir(parent, { mode: 0o700 });
      } catch (error) {
        if (!(
          error instanceof Error &&
          "code" in error &&
          error.code === "EEXIST"
        )) {
          throw error;
        }
      }
      const information = await lstat(parent);
      if (information.isSymbolicLink() || !information.isDirectory()) {
        throw new MillError(
          "INTEGRATION_FILE_ANCESTOR_UNSAFE",
          "Integration file ancestors must be real directories inside the repository.",
          ExitCode.configuration,
          { path: file.path },
        );
      }
    }
    const canonicalParent = await realpath(parent);
    if (!isWithin(canonicalRoot, canonicalParent)) {
      throw new MillError(
        "INTEGRATION_FILE_ANCESTOR_UNSAFE",
        "An integration file ancestor resolved outside the repository.",
        ExitCode.configuration,
        { path: file.path },
      );
    }
    const destination = path.join(canonicalParent, path.basename(file.path));
    const current = await existingFile(canonicalRoot, file.path);
    if (current !== undefined) {
      if (current.digest !== file.contentDigest) {
        throw new MillError(
          "INTEGRATION_PLAN_DRIFT",
          "An integration target changed after approval.",
          ExitCode.configuration,
          { path: file.path },
        );
      }
      continue;
    }
    await writeFile(destination, file.content, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  }
}

async function publishGreenfieldStaging(
  staging: string,
  target: string,
): Promise<void> {
  try {
    await mkdir(target, { mode: 0o700 });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new MillError(
        "GREENFIELD_TARGET_EXISTS",
        "The approved greenfield target appeared before publication and was preserved.",
        ExitCode.configuration,
      );
    }
    throw error;
  }
  try {
    const entries = await readdir(staging);
    if (!entries.includes(".git")) {
      throw new MillError(
        "GREENFIELD_AUTHORITY_MISSING",
        "The qualified staging repository has no Git authority marker.",
        ExitCode.data,
      );
    }
    for (const entry of entries.filter((entry) => entry !== ".git")) {
      await cp(path.join(staging, entry), path.join(target, entry), {
        recursive: true,
        force: false,
        errorOnExist: true,
        preserveTimestamps: true,
        verbatimSymlinks: true,
      });
    }
    // Portable Node has no atomic no-replace directory rename. The absent
    // target is therefore reserved exclusively, non-authoritative files are
    // materialized, and the complete Git authority marker is published last
    // with one same-filesystem rename. Before that boundary this is not a repo.
    await rename(path.join(staging, ".git"), path.join(target, ".git"));
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    throw error;
  }
}

async function git(
  root: string,
  args: readonly string[],
  signal?: AbortSignal,
  maxOutputBytes = 2 * 1024 * 1024,
): Promise<string> {
  const executable = await findTrustedExecutable("git", root);
  if (executable === undefined) {
    throw new MillError(
      "GIT_UNAVAILABLE",
      "A trusted Git executable is required.",
      ExitCode.unavailable,
    );
  }
  const result = await runProcess({
    executable,
    args: [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "core.fsmonitor=false",
      ...args,
    ],
    cwd: root,
    env: gitEnvironment,
    deadlineMs: Date.now() + 60_000,
    maxOutputBytes,
    ...(signal === undefined ? {} : { signal }),
  });
  if (
    result.exitCode !== 0 ||
    result.timedOut ||
    result.outputExceeded ||
    result.cancelled
  ) {
    throw new MillError(
      "GIT_COMMAND_FAILED",
      `Git command failed: git ${args[0] ?? ""}`,
      ExitCode.io,
      { exitCode: result.exitCode, stderr: result.stderr.slice(0, 2_000) },
    );
  }
  return result.stdout;
}

async function commitIntegration(
  root: string,
  input: IntegrationOptions,
  message: string,
  files: readonly RecipeFile[],
  signal?: AbortSignal,
): Promise<string> {
  await git(
    root,
    ["add", "--force", "--", ...files.map((file) => file.path)],
    signal,
  );
  await git(
    root,
    [
      "-c",
      `user.name=${input.authorName}`,
      "-c",
      `user.email=${input.authorEmail}`,
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--no-verify",
      "--no-gpg-sign",
      "-m",
      `${message}\n\nSigned-off-by: ${input.authorName} <${input.authorEmail}>`,
    ],
    signal,
  );
  const commit = (await git(root, ["rev-parse", "HEAD"], signal)).trim();
  for (const file of files) {
    const committed = await commitFile(root, commit, file.path);
    if (committed?.digest !== file.contentDigest) {
      throw new MillError(
        "INTEGRATION_COMMIT_MISMATCH",
        "The resulting commit does not contain every exact approved integration file.",
        ExitCode.data,
        { path: file.path },
      );
    }
  }
  return commit;
}

function assertPlanApproval(
  planned: PlannedIntegration,
  approvalDigest: string,
): void {
  if (approvalDigest !== planned.approvalDigest) {
    throw new MillError(
      "INTEGRATION_APPROVAL_MISMATCH",
      "Integration apply requires the exact current file-plan approval digest.",
      ExitCode.configuration,
      { expected: planned.approvalDigest },
    );
  }
}

async function applyGreenfieldIntegrationWithSignal(
  input: IntegrationOptions & {
    targetDirectory: string;
    planApprovalDigest: string;
    attended: boolean;
    signal: AbortSignal;
  },
): Promise<{
  repository: string;
  commit: string;
  planDigest: string;
  baseline: "unverified";
}> {
  if (!input.attended) {
    throw new MillError(
      "ATTENDANCE_REQUIRED",
      "Greenfield apply requires attended registry and local Git authority.",
      ExitCode.configuration,
    );
  }
  const planned = await planGreenfieldIntegration(input);
  assertPlanApproval(planned, input.planApprovalDigest);
  const { target, parent } = await greenfieldTarget(
    input.sourceRoot,
    input.targetDirectory,
  );
  const lockDirectory = path.join(
    parent,
    `.mill-new-${createHash("sha256").update(target).digest("hex").slice(0, 16)}.lock`,
  );
  try {
    await mkdir(lockDirectory, { mode: 0o700 });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new MillError(
        "GREENFIELD_APPLY_ACTIVE",
        "Another apply owns this exact target; remove the lock only after proving no apply is active.",
        ExitCode.temporary,
        { target: input.targetDirectory, lockDirectory },
      );
    }
    throw error;
  }
  let staging: string | undefined;
  const stateDirectory = repositoryStateDirectory(
    input.repositoryId,
    path.join(target, ".git"),
  );
  let statePreviouslyExisted = true;
  let preparedDirectory: string | undefined;
  let preparedReused = false;
  let targetPublished = false;
  try {
    statePreviouslyExisted = await lstat(stateDirectory)
      .then(() => true)
      .catch((error: unknown) => {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )
          return false;
        throw error;
      });
    staging = await mkdtemp(path.join(parent, ".mill-new-"));
    await chmod(staging, 0o700);
    await writeFiles(staging, planned.files);
    const configSource = await readFile(
      path.join(staging, "mill.yaml"),
      "utf8",
    );
    const config = millConfigSchema.parse(parseYaml(configSource));
    const prepared = await prepareDependencySnapshot({
      root: staging,
      stateDirectory,
      config,
      attended: input.attended,
      signal: input.signal,
    });
    preparedDirectory = prepared.directory;
    preparedReused = prepared.reused;
    const task = taskPacketV1Schema.parse({
      schemaVersion: "1",
      id: "recipe-bootstrap",
      title: "Qualify the exact generated repository",
      objective:
        "Prove every required native recipe gate before Git authority exists.",
      riskClass: "low",
      baseRef: "HEAD",
      authority: {
        productContract: {
          path: "product/contract.yaml",
          digest: digest("bootstrap"),
        },
        scenarioSet: {
          path: "quality/scenarios.yaml",
          digest: digest("bootstrap"),
        },
        policy: { path: "WORKFLOW.md", digest: digest("bootstrap") },
      },
      contextPaths: ["README.md"],
      allowedPaths: ["app/**"],
      commandIds: planned.plan.commandIds,
      acceptance: [
        {
          id: "RECIPE-BOOTSTRAP",
          statement: "All required recipe gates pass.",
        },
      ],
      commit: {
        message: "chore: qualify generated repository",
        authorName: input.authorName,
        authorEmail: input.authorEmail,
      },
      budget: {
        deadlineSeconds: 1200,
        maxOutputBytes: 2_000_000,
        retryCount: 0,
      },
    });
    const evidence = await verifyDeclaredCommands({
      root: staging,
      dependencyRoot: prepared.directory,
      candidateCommit: "0".repeat(40),
      config,
      task,
      deadlineMs: Date.now() + 20 * 60_000,
      maxOutputBytes: 2_000_000,
      signal: input.signal,
    });
    if (!evidence.passed) {
      throw new MillError(
        "RECIPE_QUALIFICATION_FAILED",
        "A required generated-repository gate failed before Git authority was created.",
        ExitCode.configuration,
        { evidence },
      );
    }
    await git(staging, ["init", "--initial-branch=main"], input.signal);
    const commit = await commitIntegration(
      staging,
      input,
      "chore: bootstrap approved product repository",
      planned.files,
      input.signal,
    );
    await publishGreenfieldStaging(staging, target);
    targetPublished = true;
    await rm(staging, { recursive: true, force: true });
    staging = undefined;
    return {
      repository: input.targetDirectory,
      commit,
      planDigest: planned.approvalDigest,
      baseline: "unverified",
    };
  } catch (error) {
    if (staging !== undefined)
      await rm(staging, { recursive: true, force: true });
    if (targetPublished) {
      await rm(target, { recursive: true, force: true });
    }
    if (!statePreviouslyExisted) {
      await rm(stateDirectory, { recursive: true, force: true });
    } else if (preparedDirectory !== undefined && !preparedReused) {
      await rm(preparedDirectory, { recursive: true, force: true });
    }
    throw error;
  } finally {
    await rm(lockDirectory, { recursive: true, force: true });
  }
}

export async function applyGreenfieldIntegration(
  input: IntegrationOptions & {
    targetDirectory: string;
    planApprovalDigest: string;
    attended: boolean;
    signal?: AbortSignal;
  },
): Promise<{
  repository: string;
  commit: string;
  planDigest: string;
  baseline: "unverified";
}> {
  const signals = processCancellationScope(input.signal);
  try {
    return await applyGreenfieldIntegrationWithSignal({
      ...input,
      signal: signals.signal,
    });
  } finally {
    signals.dispose();
  }
}

async function applyAdoptionIntegrationWithSignal(
  input: IntegrationOptions & {
    repositoryRoot: string;
    planApprovalDigest: string;
    attended: boolean;
    signal: AbortSignal;
  },
): Promise<{
  branch: string;
  commit: string;
  planDigest: string;
  baseline: "unverified";
}> {
  if (!input.attended) {
    throw new MillError(
      "ATTENDANCE_REQUIRED",
      "Adoption apply requires attended isolated-branch authority.",
      ExitCode.configuration,
    );
  }
  const planned = await planAdoptionIntegration(input);
  assertPlanApproval(planned, input.planApprovalDigest);
  if (input.signal.aborted) {
    throw new MillError(
      "ADOPTION_CANCELLED",
      "Adoption apply was cancelled before creating Git authority.",
      ExitCode.temporary,
    );
  }
  const root = await realpath(input.repositoryRoot);
  const checkoutStatus = await git(
    root,
    ["status", "--porcelain=v1", "--untracked-files=all"],
    input.signal,
  );
  if (checkoutStatus.length > 0) {
    throw new MillError(
      "ADOPTION_CHECKOUT_DIRTY",
      "Adoption apply requires a clean checkout at the approved exact base.",
      ExitCode.configuration,
    );
  }
  const baseCommit = planned.plan.target.baseCommit;
  if (
    baseCommit === null ||
    (await resolveCommit(root, "HEAD")) !== baseCommit
  ) {
    throw new MillError(
      "INTEGRATION_BASE_DRIFT",
      "The adoption base changed after file-plan approval.",
      ExitCode.configuration,
    );
  }
  const branch = `mill/adopt-${planned.approvalDigest.slice(7, 19)}`;
  const temporary = await mkdtemp(
    path.join(path.dirname(root), ".mill-adopt-"),
  );
  await chmod(temporary, 0o700);
  try {
    await rm(temporary, { recursive: true });
    await git(
      root,
      ["worktree", "add", "-b", branch, temporary, baseCommit],
      input.signal,
    );
    await writeFiles(temporary, planned.files);
    const commit = await commitIntegration(
      temporary,
      input,
      "chore: adopt Mill delivery contracts",
      planned.files,
      input.signal,
    );
    await git(root, ["worktree", "remove", "--force", temporary], input.signal);
    return {
      branch,
      commit,
      planDigest: planned.approvalDigest,
      baseline: "unverified",
    };
  } catch (error) {
    try {
      await git(root, ["worktree", "remove", "--force", temporary]);
    } catch {
      await rm(temporary, { recursive: true, force: true });
      await git(root, ["worktree", "prune", "--expire", "now"]);
    }
    try {
      await git(root, ["update-ref", "-d", `refs/heads/${branch}`, baseCommit]);
    } catch {
      // Preserve the branch when it contains a committed result or no longer
      // equals the exact disposable base.
    }
    throw error;
  }
}

export async function applyAdoptionIntegration(
  input: IntegrationOptions & {
    repositoryRoot: string;
    planApprovalDigest: string;
    attended: boolean;
    signal?: AbortSignal;
  },
): Promise<{
  branch: string;
  commit: string;
  planDigest: string;
  baseline: "unverified";
}> {
  const signals = processCancellationScope(input.signal);
  try {
    return await applyAdoptionIntegrationWithSignal({
      ...input,
      signal: signals.signal,
    });
  } finally {
    signals.dispose();
  }
}

export async function planDetach(root: string): Promise<{
  mode: "manual";
  remove: string[];
  retain: string[];
  changed: string[];
  stateAction: string;
}> {
  const source = await safeReadText(root, "mill.lock", 2 * 1024 * 1024);
  let raw: unknown;
  try {
    raw = parseYaml(source);
  } catch (error) {
    throw new MillError(
      "INVALID_MILL_LOCK",
      "mill.lock is invalid YAML.",
      ExitCode.data,
      {
        cause: String(error),
      },
    );
  }
  const lock = millLockSchema.parse(raw);
  if (lock.integration === undefined) {
    throw new MillError(
      "DETACH_METADATA_UNAVAILABLE",
      "This integration predates ownership metadata; use documented manual disposition.",
      ExitCode.configuration,
    );
  }
  const remove: string[] = ["mill.lock"];
  const retain: string[] = [];
  const changed: string[] = [];
  for (const file of lock.integration.files) {
    const current = await existingFile(root, file.path);
    if (current?.digest !== file.installedDigest) {
      changed.push(file.path);
    }
    if (file.ownership === "mill_only") remove.push(file.path);
    else retain.push(file.path);
  }
  return {
    mode: "manual",
    remove: [...new Set(remove)].sort(),
    retain: [...new Set(retain)].sort(),
    changed: [...new Set(changed)].sort(),
    stateAction:
      "Run millctl state purge only after every local run is reviewed or terminal.",
  };
}
