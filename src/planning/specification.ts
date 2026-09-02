import path from "node:path";

import { parse as parseYaml } from "yaml";
import type { z } from "zod";

import {
  sourceManifestSchema,
  specificationProposalSchema,
} from "../contracts/schemas.js";
import {
  canonicalDigest,
  canonicalJson,
  type JsonValue,
} from "../contracts/canonical.js";
import { ExitCode, MillError } from "../errors.js";
import { safeReadText } from "../security/safe-path.js";
import { textDigest } from "../runtime/inputs.js";

export type SourceManifest = z.infer<typeof sourceManifestSchema>;
export type SpecificationProposal = z.infer<typeof specificationProposalSchema>;

function parseDocument<T>(
  source: string,
  extension: string,
  schema: z.ZodType<T>,
  label: string,
): T {
  let raw: unknown;
  try {
    raw = extension === ".json" ? JSON.parse(source) : parseYaml(source);
  } catch (error) {
    throw new MillError(
      "INVALID_PLANNING_INPUT",
      `${label} is not valid YAML or JSON.`,
      ExitCode.data,
      { cause: String(error) },
    );
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new MillError(
      "INVALID_PLANNING_INPUT",
      `${label} does not satisfy its schema.`,
      ExitCode.data,
      { issues: parsed.error.issues },
    );
  }
  return parsed.data;
}

export async function loadPlanningSources(input: {
  root: string;
  prdPath: string;
  sourceManifestPath: string;
}): Promise<{
  prdPath: string;
  prd: string;
  prdDigest: string;
  sourceManifest: SourceManifest;
  sourceManifestDigest: string;
}> {
  const [prd, source] = await Promise.all([
    safeReadText(input.root, input.prdPath, 2 * 1024 * 1024),
    safeReadText(input.root, input.sourceManifestPath, 2 * 1024 * 1024),
  ]);
  const sourceManifest = parseDocument(
    source,
    path.extname(input.sourceManifestPath).toLowerCase(),
    sourceManifestSchema,
    input.sourceManifestPath,
  );
  return {
    prdPath: input.prdPath,
    prd,
    prdDigest: textDigest(prd),
    sourceManifest,
    sourceManifestDigest: canonicalDigest(
      sourceManifest as unknown as JsonValue,
    ),
  };
}

export async function loadSpecificationProposal(
  root: string,
  proposalPath: string,
): Promise<SpecificationProposal> {
  const source = await safeReadText(root, proposalPath, 4 * 1024 * 1024);
  return parseDocument(
    source,
    path.extname(proposalPath).toLowerCase(),
    specificationProposalSchema,
    proposalPath,
  );
}

function duplicates(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicate.add(value);
    seen.add(value);
  }
  return [...duplicate].sort();
}

function normalizedStatement(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, " ")
    .trim();
}

export interface SpecificationAssessment {
  proposalDigest: string;
  promotable: boolean;
  blockers: readonly string[];
  warnings: readonly string[];
}

export function assessSpecificationProposal(input: {
  proposal: SpecificationProposal;
  prdPath: string;
  prdDigest: string;
  sourceManifest: SourceManifest;
  sourceManifestDigest: string;
}): SpecificationAssessment {
  const { proposal, sourceManifest } = input;
  const blockers: string[] = [];
  const warnings: string[] = [];
  const sourceIds = new Set(sourceManifest.sources.map((source) => source.id));
  const invariantIds = new Set(
    proposal.productContract.invariants.map((invariant) => invariant.id),
  );
  const acceptanceIds = new Set(
    proposal.productContract.acceptance.map((item) => item.id),
  );
  if (
    proposal.prd.path !== input.prdPath ||
    proposal.prd.digest !== input.prdDigest
  ) {
    blockers.push("proposal PRD identity does not match the inspected input");
  }
  if (proposal.sourceManifestDigest !== input.sourceManifestDigest) {
    blockers.push("proposal source-manifest identity is stale");
  }
  const normalizedPrdPath = path
    .normalize(input.prdPath)
    .split(path.sep)
    .join("/");
  const prdSources = sourceManifest.sources.filter((source) => {
    const normalizedSourcePath = path
      .normalize(source.uri)
      .split(path.sep)
      .join("/");
    return (
      normalizedSourcePath === normalizedPrdPath &&
      (source.revision === input.prdDigest || source.digest === input.prdDigest)
    );
  });
  if (prdSources.length !== 1) {
    blockers.push("exactly one source must bind the inspected PRD identity");
  }
  const prdSource = prdSources[0];
  if (
    prdSources.length === 1 &&
    prdSource !== undefined &&
    !proposal.productContract.sourceRefs.includes(prdSource.id)
  ) {
    blockers.push(
      `product contract does not bind the inspected PRD source: ${prdSource.id}`,
    );
  }
  for (const duplicate of duplicates(
    sourceManifest.sources.map((source) => source.id),
  )) {
    blockers.push(`source identity is duplicated: ${duplicate}`);
  }
  if (proposal.productContract.acceptance.length === 0) {
    blockers.push("product contract has no stable acceptance items");
  }
  if (proposal.productContract.invariants.length === 0) {
    blockers.push("product contract has no stable behavioral invariants");
  }
  for (const outcome of proposal.productContract.outcomes) {
    for (const acceptanceRef of outcome.acceptanceIds ?? []) {
      if (!acceptanceIds.has(acceptanceRef)) {
        blockers.push(
          `outcome acceptance reference is unresolved: ${outcome.id}/${acceptanceRef}`,
        );
      }
    }
  }
  for (const duplicate of duplicates([
    ...proposal.productContract.outcomes.map((item) => item.id),
    ...proposal.productContract.acceptance.map((item) => item.id),
    ...proposal.productContract.invariants.map((item) => item.id),
    ...proposal.productContract.decisions.map((item) => item.id),
    ...proposal.scenarioSet.scenarios.map((item) => item.id),
  ])) {
    blockers.push(`stable ID is reused: ${duplicate}`);
  }
  for (const duplicate of duplicates(
    proposal.productContract.invariants.map((item) =>
      normalizedStatement(item.statement),
    ),
  )) {
    blockers.push(`invariant semantics are duplicated: ${duplicate}`);
  }
  const referencedSources = [
    ...proposal.productContract.sourceRefs,
    ...proposal.productContract.acceptance.flatMap((item) => item.sourceRefs),
    ...proposal.productContract.invariants.flatMap((item) => item.sourceRefs),
    ...proposal.productContract.decisions.flatMap((item) => item.sourceRefs),
    ...proposal.assumptions.flatMap((item) => item.sourceRefs),
    ...proposal.contradictions.flatMap((item) => item.sourceRefs),
  ];
  for (const sourceRef of new Set(referencedSources)) {
    if (!sourceIds.has(sourceRef)) {
      blockers.push(`source reference is unresolved: ${sourceRef}`);
    }
  }
  for (const decision of proposal.productContract.decisions) {
    if (decision.status !== "approved") {
      blockers.push(`decision is not approved: ${decision.id}`);
    }
  }
  for (const contradiction of proposal.contradictions) {
    if (contradiction.blocking) {
      blockers.push(`blocking contradiction remains: ${contradiction.id}`);
    }
  }
  for (const question of proposal.questions) {
    if (question.blocking)
      blockers.push(`blocking question remains: ${question.id}`);
  }
  const productDigest = canonicalDigest(
    proposal.productContract as unknown as JsonValue,
  );
  for (const blueprint of proposal.blueprints) {
    if (blueprint.productContractDigest !== productDigest) {
      blockers.push(
        `blueprint is bound to another product contract: ${blueprint.id}`,
      );
    }
  }
  if (proposal.scenarioSet.productContractDigest !== productDigest) {
    blockers.push("scenario set is bound to another product contract");
  }
  for (const scenario of proposal.scenarioSet.scenarios) {
    for (const acceptanceRef of scenario.acceptanceRefs) {
      if (!acceptanceIds.has(acceptanceRef)) {
        blockers.push(
          `scenario ${scenario.id} has unresolved acceptance ${acceptanceRef}`,
        );
      }
    }
    for (const invariantRef of scenario.invariantRefs) {
      if (!invariantIds.has(invariantRef)) {
        blockers.push(
          `scenario ${scenario.id} has unresolved invariant ${invariantRef}`,
        );
      }
    }
    if (scenario.acceptanceRefs.length === 0) {
      blockers.push(`scenario has no acceptance reference: ${scenario.id}`);
    }
    if (scenario.invariantRefs.length === 0) {
      blockers.push(`scenario has no invariant reference: ${scenario.id}`);
    }
  }
  for (const source of sourceManifest.sources) {
    if (source.freshness !== "current") {
      warnings.push(`source ${source.id} freshness is ${source.freshness}`);
    }
  }
  return {
    proposalDigest: canonicalDigest(proposal as unknown as JsonValue),
    promotable: blockers.length === 0,
    blockers: [...new Set(blockers)].sort(),
    warnings: [...new Set(warnings)].sort(),
  };
}

export function promoteSpecificationProposal(input: {
  proposal: SpecificationProposal;
  approvalDigest: string;
  assessment: SpecificationAssessment;
}): {
  proposalDigest: string;
  canonicalProposal: string;
  productContract: SpecificationProposal["productContract"];
  blueprints: SpecificationProposal["blueprints"];
  scenarioSet: SpecificationProposal["scenarioSet"];
} {
  const proposalDigest = canonicalDigest(
    input.proposal as unknown as JsonValue,
  );
  if (
    input.approvalDigest !== proposalDigest ||
    input.assessment.proposalDigest !== proposalDigest
  ) {
    throw new MillError(
      "PLANNING_APPROVAL_MISMATCH",
      "Planning approval does not match the exact canonical proposal.",
      ExitCode.configuration,
    );
  }
  if (!input.assessment.promotable) {
    throw new MillError(
      "PLANNING_PROMOTION_BLOCKED",
      "The proposal has unresolved promotion blockers.",
      ExitCode.configuration,
      { blockers: input.assessment.blockers },
    );
  }
  return {
    proposalDigest,
    canonicalProposal: canonicalJson(input.proposal as unknown as JsonValue),
    productContract: input.proposal.productContract,
    blueprints: input.proposal.blueprints,
    scenarioSet: input.proposal.scenarioSet,
  };
}

export function semanticProposalDiff(
  approved: SpecificationProposal,
  regenerated: SpecificationProposal,
): readonly string[] {
  const changed = new Set<string>();
  const walk = (left: unknown, right: unknown, pointer: string): void => {
    if (Object.is(left, right)) return;
    if (
      typeof left !== "object" ||
      left === null ||
      typeof right !== "object" ||
      right === null ||
      Array.isArray(left) !== Array.isArray(right)
    ) {
      changed.add(pointer || "/");
      return;
    }
    if (Array.isArray(left) && Array.isArray(right)) {
      const length = Math.max(left.length, right.length);
      for (let index = 0; index < length; index += 1) {
        walk(left[index], right[index], `${pointer}/${index}`);
      }
      return;
    }
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    for (const key of new Set([
      ...Object.keys(leftRecord),
      ...Object.keys(rightRecord),
    ])) {
      walk(leftRecord[key], rightRecord[key], `${pointer}/${key}`);
    }
  };
  walk(approved, regenerated, "");
  return [...changed].sort();
}
