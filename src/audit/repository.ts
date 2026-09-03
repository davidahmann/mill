import { parse as parseYaml } from "yaml";
import type { z } from "zod";

import {
  auditReportSchema,
  productContractSchema,
  recipeManifestSchema,
  scenarioSetSchema,
} from "../contracts/schemas.js";
import { canonicalDigest, type JsonValue } from "../contracts/canonical.js";
import { scanRepository } from "../repository/scan.js";
import {
  assertRepositoryWorktreeClean,
  readCandidateIdentity,
} from "../runtime/repository.js";
import { safeReadText } from "../security/safe-path.js";

export type AuditReport = z.infer<typeof auditReportSchema>;
type AuditCategory = AuditReport["checks"][number]["category"];

interface AuditCheckInput {
  id: string;
  category: AuditCategory;
  summary: string;
  evidence: string[];
  evaluate: () => Promise<void> | void;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("expected an object");
  }
  return value as Record<string, unknown>;
}

async function structuredFile(root: string, file: string): Promise<unknown> {
  const source = await safeReadText(root, file, 8 * 1024 * 1024);
  return file.endsWith(".json") ? JSON.parse(source) : parseYaml(source);
}

async function runCheck(input: AuditCheckInput) {
  try {
    await input.evaluate();
    return {
      id: input.id,
      category: input.category,
      status: "passed" as const,
      summary: input.summary,
      evidence: input.evidence,
    };
  } catch (error) {
    return {
      id: input.id,
      category: input.category,
      status: "blocked" as const,
      summary: `${input.summary}: ${error instanceof Error ? error.message : String(error)}`,
      evidence: input.evidence,
    };
  }
}

function requireText(source: string, values: readonly string[]): void {
  for (const value of values) {
    if (!source.includes(value)) throw new Error(`missing ${value}`);
  }
}

export async function auditRepository(input: {
  root: string;
  now?: Date;
}): Promise<AuditReport> {
  const candidate = await readCandidateIdentity(input.root);
  const [scan, productRaw, scenariosRaw, recipeRaw, packageRaw, lockRaw] =
    await Promise.all([
      scanRepository(input.root),
      structuredFile(input.root, "product/contract.yaml"),
      structuredFile(input.root, "quality/scenarios.yaml"),
      structuredFile(
        input.root,
        "recipes/node-typescript-next-web/recipe.yaml",
      ),
      structuredFile(input.root, "package.json"),
      structuredFile(input.root, "package-lock.json"),
    ]);
  const product = productContractSchema.parse(productRaw);
  const scenarios = scenarioSetSchema.parse(scenariosRaw);
  const recipe = recipeManifestSchema.parse(recipeRaw);
  const packageJson = record(packageRaw);
  const packageLock = record(lockRaw);
  const [
    readme,
    agents,
    architecture,
    workflow,
    development,
    security,
    support,
    releaseGuide,
    releaseWorkflow,
  ] = await Promise.all([
    safeReadText(input.root, "README.md"),
    safeReadText(input.root, "AGENTS.md"),
    safeReadText(input.root, "architecture/ARCHITECTURE.md"),
    safeReadText(input.root, "WORKFLOW.md"),
    safeReadText(input.root, "docs/development.md"),
    safeReadText(input.root, "SECURITY.md"),
    safeReadText(input.root, "SUPPORT.md"),
    safeReadText(input.root, "docs/release.md"),
    safeReadText(input.root, ".github/workflows/release.yml"),
  ]);

  const checks = await Promise.all([
    runCheck({
      id: "product.authority",
      category: "product",
      summary: "Product truth and continuity contracts are valid and linked",
      evidence: [
        "product/PRD.md",
        "product/contract.yaml",
        "quality/scenarios.yaml",
      ],
      evaluate: () => {
        if (product.outcomes.length === 0 || product.invariants.length === 0) {
          throw new Error("product outcomes or invariants are empty");
        }
        if (scenarios.scenarios.length === 0)
          throw new Error("scenario set is empty");
        if (
          scenarios.productContractDigest !==
          canonicalDigest(product as unknown as JsonValue)
        ) {
          throw new Error("scenario set is bound to another product contract");
        }
      },
    }),
    runCheck({
      id: "code.exact-candidate",
      category: "code",
      summary: "The audit is bound to a clean exact Git candidate",
      evidence: [candidate.commit, candidate.tree],
      evaluate: () => assertRepositoryWorktreeClean(input.root),
    }),
    runCheck({
      id: "ux.operator-path",
      category: "ux",
      summary:
        "The operator path is discoverable from the primary documentation",
      evidence: ["README.md", "AGENTS.md"],
      evaluate: () => {
        requireText(readme, ["## Why Mill", "## Quick start", "millctl start"]);
        requireText(agents, ["## Operating Mill", "## Authority hierarchy"]);
      },
    }),
    runCheck({
      id: "accessibility.delivered-surface",
      category: "accessibility",
      summary:
        "The recipe exposes browser and explicit accessibility validation hooks",
      evidence: [
        "recipes/node-typescript-next-web/recipe.yaml",
        "docs/development.md",
      ],
      evaluate: () => {
        if (!recipe.commands.native.includes("test:browser")) {
          throw new Error("recipe has no browser validation command");
        }
        requireText(development, ["Accessibility", "test:browser"]);
      },
    }),
    runCheck({
      id: "security.boundaries",
      category: "security",
      summary:
        "Security policy, static scan, and credential exclusions are intact",
      evidence: ["SECURITY.md", scan.digest],
      evaluate: () => {
        if (
          scan.gitConfigHazards.length > 0 ||
          scan.symlinksSkipped.length > 0 ||
          scan.secretReferences.length > 0 ||
          scan.truncatedDirectories.length > 0
        ) {
          throw new Error("repository scan has unresolved hazards");
        }
        requireText(security, [
          "private vulnerability reporting",
          "credentials",
        ]);
      },
    }),
    runCheck({
      id: "dependencies.exact-and-licensed",
      category: "dependencies",
      summary:
        "Runtime dependencies are exact and recipe licenses are reviewed",
      evidence: [
        "package.json",
        "package-lock.json",
        "recipes/node-typescript-next-web/recipe.yaml",
      ],
      evaluate: () => {
        const dependencies = record(packageJson.dependencies ?? {});
        for (const [name, version] of Object.entries(dependencies)) {
          if (
            typeof version !== "string" ||
            !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u.test(
              version,
            )
          ) {
            throw new Error(`dependency is not exactly pinned: ${name}`);
          }
        }
        if (record(packageLock.packages ?? {})[""] === undefined) {
          throw new Error("lockfile has no root package");
        }
        if (recipe.licensePolicy.reviewedPackages.length === 0) {
          throw new Error("recipe dependency licenses are not reviewed");
        }
      },
    }),
    runCheck({
      id: "architecture.bounded-monolith",
      category: "architecture",
      summary:
        "Architecture and workflow retain the bounded local-first design",
      evidence: ["architecture/ARCHITECTURE.md", "WORKFLOW.md", "package.json"],
      evaluate: () => {
        requireText(architecture, [
          "TypeScript modular monolith",
          "there is no daemon",
        ]);
        requireText(workflow, ["five vertical waves", "Factory skills"]);
        const dependencies = Object.keys(
          record(packageJson.dependencies ?? {}),
        );
        if (
          dependencies.some((name) =>
            /factoryd?|opencode|pi-agent/iu.test(name),
          )
        ) {
          throw new Error(
            "an excluded orchestrator or harness became a runtime dependency",
          );
        }
      },
    }),
    runCheck({
      id: "operations.recovery",
      category: "operations",
      summary:
        "Development, support, recovery, and agent operating paths are documented",
      evidence: ["docs/development.md", "SUPPORT.md", "AGENTS.md"],
      evaluate: () => {
        requireText(development, [
          "## Testing matrix",
          "## Review convergence",
        ]);
        requireText(support, ["GitHub Issues", "best-effort"]);
        requireText(agents, ["## Recovery", "## Stop conditions"]);
      },
    }),
    runCheck({
      id: "release.exact-artifact",
      category: "release",
      summary:
        "Release policy publishes one preserved qualified public artifact",
      evidence: [
        "package.json",
        ".github/workflows/release.yml",
        "docs/release.md",
      ],
      evaluate: () => {
        if (
          packageJson.name !== "@davidahmann/mill" ||
          packageJson.version === "0.0.0-development" ||
          record(packageJson.publishConfig ?? {}).access !== "public" ||
          record(packageJson.publishConfig ?? {}).provenance !== true
        ) {
          throw new Error("package release identity is not public-alpha ready");
        }
        requireText(releaseWorkflow, [
          "compare-release-artifacts.mjs",
          'npm publish "$artifact"',
        ]);
        requireText(releaseGuide, ["Genesis release", "Withdrawal"]);
      },
    }),
  ]);

  return auditReportSchema.parse({
    schemaVersion: "1",
    candidate,
    generatedAt: (input.now ?? new Date()).toISOString(),
    status: checks.every((check) => check.status === "passed")
      ? "passed"
      : "blocked",
    checks,
  });
}
