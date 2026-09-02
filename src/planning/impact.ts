import type { z } from "zod";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import type { taskPacketSchema } from "../contracts/schemas.js";
import {
  impactManifestSchema,
  productContractSchema,
  scenarioSetSchema,
} from "../contracts/schemas.js";
import { canonicalDigest, type JsonValue } from "../contracts/canonical.js";
import { ExitCode, MillError } from "../errors.js";
import { safeReadText } from "../security/safe-path.js";

export type ImpactManifest = z.infer<typeof impactManifestSchema>;
export type ContinuityProductContract = z.infer<typeof productContractSchema>;
export type ContinuityScenarioSet = z.infer<typeof scenarioSetSchema>;
export type ContinuityTask = z.infer<typeof taskPacketSchema>;

export interface ImpactAssessment {
  proposalDigest: string;
  manifestDigest: string;
  approved: boolean;
  blockers: readonly string[];
}

function parseContinuityDocument<T>(
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
      "INVALID_CONTINUITY_INPUT",
      `${label} is not valid YAML or JSON.`,
      ExitCode.data,
      { cause: String(error) },
    );
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new MillError(
      "INVALID_CONTINUITY_INPUT",
      `${label} does not satisfy its schema.`,
      ExitCode.data,
      { issues: parsed.error.issues },
    );
  }
  return parsed.data;
}

export async function loadImpactPlanningInputs(input: {
  root: string;
  productPath: string;
  scenarioPath: string;
  impactPath: string;
}): Promise<{
  product: ContinuityProductContract;
  scenarios: ContinuityScenarioSet;
  manifest: ImpactManifest;
}> {
  const [product, scenarios, impact] = await Promise.all([
    safeReadText(input.root, input.productPath, 2 * 1024 * 1024),
    safeReadText(input.root, input.scenarioPath, 2 * 1024 * 1024),
    safeReadText(input.root, input.impactPath, 2 * 1024 * 1024),
  ]);
  return {
    product: parseContinuityDocument(
      product,
      path.extname(input.productPath).toLowerCase(),
      productContractSchema,
      input.productPath,
    ),
    scenarios: parseContinuityDocument(
      scenarios,
      path.extname(input.scenarioPath).toLowerCase(),
      scenarioSetSchema,
      input.scenarioPath,
    ),
    manifest: parseContinuityDocument(
      impact,
      path.extname(input.impactPath).toLowerCase(),
      impactManifestSchema,
      input.impactPath,
    ),
  };
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function duplicates(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated].sort();
}

export function semanticClaimDigest(
  kind: "acceptance" | "invariant" | "scenario",
  id: string,
  value: JsonValue,
): string {
  return canonicalDigest({ kind, id, value });
}

export function assessImpactManifest(input: {
  manifest: ImpactManifest;
  product: ContinuityProductContract;
  scenarios: ContinuityScenarioSet;
  now?: Date;
}): ImpactAssessment {
  const blockers: string[] = [];
  const productDigest = canonicalDigest(input.product);
  const acceptanceIds = new Set(
    input.product.acceptance.map((item) => item.id),
  );
  const invariantIds = new Set(input.product.invariants.map((item) => item.id));
  const decisions = new Map(
    input.product.decisions.map((decision) => [decision.id, decision]),
  );
  const scenarios = new Map(
    input.scenarios.scenarios.map((scenario) => [scenario.id, scenario]),
  );
  for (const duplicate of duplicates([
    ...input.product.acceptance.map((item) => item.id),
    ...input.product.invariants.map((item) => item.id),
    ...input.product.decisions.map((item) => item.id),
    ...input.scenarios.scenarios.map((item) => item.id),
  ])) {
    blockers.push(`stable ID is reused: ${duplicate}`);
  }
  if (input.manifest.productContractDigest !== productDigest) {
    blockers.push("impact manifest is bound to another product contract");
  }
  if (input.scenarios.productContractDigest !== productDigest) {
    blockers.push("scenario set is bound to another product contract");
  }
  for (const [label, values] of [
    ["acceptance", input.manifest.acceptanceIds],
    ["affected invariant", input.manifest.affectedInvariantIds],
    ["uncertain invariant", input.manifest.uncertainInvariantIds],
    ["scenario", input.manifest.scenarioIds],
    ["command", input.manifest.commandIds],
  ] as const) {
    if (!unique(values)) blockers.push(`${label} references are duplicated`);
  }
  for (const id of input.manifest.acceptanceIds) {
    if (!acceptanceIds.has(id))
      blockers.push(`acceptance is unresolved: ${id}`);
  }
  for (const id of [
    ...input.manifest.affectedInvariantIds,
    ...input.manifest.uncertainInvariantIds,
  ]) {
    if (!invariantIds.has(id)) blockers.push(`invariant is unresolved: ${id}`);
  }
  for (const id of input.manifest.uncertainInvariantIds) {
    if (input.manifest.affectedInvariantIds.includes(id)) {
      blockers.push(`invariant cannot be both affected and uncertain: ${id}`);
    }
  }
  for (const id of input.manifest.scenarioIds) {
    if (!scenarios.has(id)) blockers.push(`scenario is unresolved: ${id}`);
  }
  const impactedAcceptance = new Set(input.manifest.acceptanceIds);
  const impactedInvariants = new Set([
    ...input.manifest.affectedInvariantIds,
    ...input.manifest.uncertainInvariantIds,
  ]);
  const selectedScenarios = input.manifest.scenarioIds
    .map((id) => scenarios.get(id))
    .filter((scenario) => scenario !== undefined);
  for (const scenario of selectedScenarios) {
    const outsideAcceptance = scenario.acceptanceRefs.filter(
      (id) => !impactedAcceptance.has(id),
    );
    const outsideInvariants = scenario.invariantRefs.filter(
      (id) => !impactedInvariants.has(id),
    );
    if (outsideAcceptance.length > 0 || outsideInvariants.length > 0) {
      blockers.push(
        `selected scenario is outside impact closure: ${scenario.id}`,
      );
    }
    if (
      scenario.oracleOwner === "repository" &&
      scenario.executionRef === undefined
    ) {
      blockers.push(
        `repository scenario lacks an execution command: ${scenario.id}`,
      );
    } else if (
      scenario.executionRef !== undefined &&
      !input.manifest.commandIds.includes(scenario.executionRef)
    ) {
      blockers.push(
        `scenario command is outside approved impact: ${scenario.id}:${scenario.executionRef}`,
      );
    }
  }
  for (const id of input.manifest.acceptanceIds) {
    if (
      !selectedScenarios.some((scenario) =>
        scenario.acceptanceRefs.includes(id),
      )
    ) {
      blockers.push(`impacted acceptance lacks a selected scenario: ${id}`);
    }
  }
  for (const id of impactedInvariants) {
    if (
      !selectedScenarios.some((scenario) => scenario.invariantRefs.includes(id))
    ) {
      blockers.push(`impacted invariant lacks a selected scenario: ${id}`);
    }
  }
  for (const id of input.manifest.materialDecisions) {
    const decision = decisions.get(id);
    if (decision === undefined) blockers.push(`decision is unresolved: ${id}`);
    else if (decision.status !== "approved") {
      blockers.push(`decision is not approved: ${id}`);
    }
  }
  for (const id of input.manifest.affectedInvariantIds) {
    const invariant = input.product.invariants.find((item) => item.id === id);
    if (
      invariant?.verification.mode === "command" &&
      !input.manifest.commandIds.includes(invariant.verification.ref)
    ) {
      blockers.push(
        `invariant command is outside approved impact: ${id}:${invariant.verification.ref}`,
      );
    } else if (invariant?.verification.mode === "unsupported") {
      blockers.push(`affected invariant has unsupported verification: ${id}`);
    }
  }
  const now = input.now ?? new Date();
  const activeExceptions = input.manifest.exceptions.filter((exception) => {
    const approvedAt = Date.parse(exception.approvedAt);
    const expiresAt = Date.parse(exception.expiresAt);
    return approvedAt <= now.getTime() && expiresAt > now.getTime();
  });
  const exceptionScopes = new Set(
    activeExceptions.flatMap((exception) => exception.scopeRefs),
  );
  for (const exception of input.manifest.exceptions) {
    const approvedAt = Date.parse(exception.approvedAt);
    const expiresAt = Date.parse(exception.expiresAt);
    if (approvedAt > now.getTime()) {
      blockers.push(`impact exception is not active yet: ${exception.id}`);
    }
    if (expiresAt <= approvedAt) {
      blockers.push(
        `impact exception has an invalid interval: ${exception.id}`,
      );
    } else if (expiresAt <= now.getTime()) {
      blockers.push(`impact exception is expired: ${exception.id}`);
    }
  }
  for (const id of input.manifest.uncertainInvariantIds) {
    if (!exceptionScopes.has(id)) {
      blockers.push(`uncertain invariant lacks an approved exception: ${id}`);
    }
  }
  for (const unresolved of input.manifest.unresolved) {
    if (!exceptionScopes.has(`unresolved:${unresolved}`)) {
      blockers.push(
        `unresolved impact lacks an approved exception: ${unresolved}`,
      );
    }
  }
  if (input.manifest.riskClass !== "low") {
    if (
      !selectedScenarios.some(
        (scenario) =>
          scenario.executionRef !== undefined &&
          input.manifest.commandIds.includes(scenario.executionRef),
      )
    ) {
      blockers.push(
        "medium/high risk impact lacks a delivered-surface scenario",
      );
    }
    if (!selectedScenarios.some((scenario) => scenario.kind !== "normal")) {
      blockers.push("medium/high risk impact lacks a non-normal scenario");
    }
  }
  const proposal = { ...input.manifest, approval: null };
  const proposalDigest = canonicalDigest(proposal);
  if (input.manifest.approval === null) {
    blockers.push("impact manifest is not human approved");
  } else if (input.manifest.approval.proposalDigest !== proposalDigest) {
    blockers.push("impact approval is not bound to the exact proposal");
  }
  return {
    proposalDigest,
    manifestDigest: canonicalDigest(input.manifest),
    approved: blockers.length === 0,
    blockers: [...new Set(blockers)].sort(),
  };
}

export interface SemanticItemEvidence {
  kind: "acceptance" | "invariant" | "scenario";
  id: string;
  coverage: "new_behavior" | "preservation" | "both";
  status: "passed" | "attested" | "blocked";
  evidenceRefs: string[];
  reason?: string;
}

export interface SemanticEvidence {
  impactManifestDigest: string;
  items: SemanticItemEvidence[];
  newBehaviorPassed: boolean;
  preservationPassed: boolean;
  passed: boolean;
}

export function buildSemanticEvidence(input: {
  task: ContinuityTask;
  manifest: ImpactManifest;
  product: ContinuityProductContract;
  scenarios: ContinuityScenarioSet;
  commandResults: readonly {
    commandId: string;
    status: "passed" | "failed" | "blocked";
  }[];
  now?: Date;
}): SemanticEvidence {
  if (input.task.schemaVersion !== "2") {
    throw new MillError(
      "CONTINUITY_TASK_VERSION_REQUIRED",
      "Semantic evidence requires a task-packet version 2 continuity contract.",
      ExitCode.configuration,
    );
  }
  const task = input.task;
  const now = input.now ?? new Date();
  if (!unique(task.attestations.map((attestation) => attestation.id))) {
    throw new MillError(
      "DUPLICATE_ATTESTATION_ID",
      "Human attestation IDs must be unique within a task packet.",
      ExitCode.configuration,
    );
  }
  const activeAttestation = (
    attestationId: string,
  ): (typeof task.attestations)[number] | undefined => {
    const attestation = task.attestations.find(
      (candidate) => candidate.id === attestationId,
    );
    if (
      attestation === undefined ||
      Date.parse(attestation.approvedAt) > now.getTime() ||
      Date.parse(attestation.expiresAt) <= now.getTime()
    ) {
      return undefined;
    }
    return attestation;
  };
  const claimedBy = (
    kind: "acceptance" | "invariant" | "scenario",
    id: string,
    digest: string,
    attestationId?: string,
  ) =>
    task.attestations.find(
      (attestation) =>
        (attestationId === undefined || attestation.id === attestationId) &&
        activeAttestation(attestation.id) !== undefined &&
        attestation.claims.some(
          (claim) =>
            claim.kind === kind && claim.id === id && claim.digest === digest,
        ),
    );
  const commands = new Map(
    input.commandResults.map((command) => [command.commandId, command.status]),
  );
  const invariants = new Map(
    input.product.invariants.map((invariant) => [invariant.id, invariant]),
  );
  const scenarios = new Map(
    input.scenarios.scenarios.map((scenario) => [scenario.id, scenario]),
  );
  const items: SemanticItemEvidence[] = [];
  const taskAcceptance = new Map(
    task.acceptance.map((acceptance) => [acceptance.id, acceptance]),
  );
  for (const id of input.manifest.acceptanceIds) {
    const acceptance = taskAcceptance.get(id);
    if (acceptance?.evidence === undefined) {
      items.push({
        kind: "acceptance",
        id,
        coverage: acceptance?.coverage ?? "new_behavior",
        status: "blocked",
        evidenceRefs: [],
        reason: "evidence disposition is missing",
      });
      continue;
    }
    if (acceptance.evidence.mode === "command") {
      const commandApproved = input.manifest.commandIds.includes(
        acceptance.evidence.commandId,
      );
      const passed =
        commandApproved &&
        commands.get(acceptance.evidence.commandId) === "passed";
      items.push({
        kind: "acceptance",
        id,
        coverage: acceptance.coverage,
        status: passed ? "passed" : "blocked",
        evidenceRefs: [`command:${acceptance.evidence.commandId}`],
        ...(passed
          ? {}
          : {
              reason: commandApproved
                ? "declared command did not pass"
                : "declared command is outside approved impact",
            }),
      });
      continue;
    }
    if (acceptance.evidence.mode === "human") {
      const attestation = claimedBy(
        "acceptance",
        id,
        semanticClaimDigest("acceptance", id, {
          statement: acceptance.statement,
        }),
        acceptance.evidence.attestationId,
      );
      const valid = attestation !== undefined;
      items.push({
        kind: "acceptance",
        id,
        coverage: acceptance.coverage,
        status: valid ? "attested" : "blocked",
        evidenceRefs: [
          `attestation:${acceptance.evidence.attestationId}:acceptance:${id}`,
        ],
        ...(valid
          ? {}
          : { reason: "human attestation is stale or mismatched" }),
      });
      continue;
    }
    items.push({
      kind: "acceptance",
      id,
      coverage: acceptance.coverage,
      status: "blocked",
      evidenceRefs: [],
      reason: acceptance.evidence.reason,
    });
  }
  const acceptanceEvidence = new Map(
    items.map((item) => [item.id, item] as const),
  );
  const linked = (kind: "invariant" | "scenario", id: string) =>
    task.acceptance
      .filter((acceptance) =>
        kind === "invariant"
          ? acceptance.invariantIds.includes(id)
          : acceptance.scenarioIds.includes(id),
      )
      .map((acceptance) => acceptanceEvidence.get(acceptance.id))
      .filter((item) => item !== undefined);
  const exceptionFor = (id: string) =>
    input.manifest.exceptions.find((exception) =>
      exception.scopeRefs.includes(id),
    );
  for (const id of input.manifest.affectedInvariantIds) {
    const invariant = invariants.get(id);
    const evidence = linked("invariant", id);
    const linkedPassed =
      evidence.length > 0 &&
      evidence.every((item) => item.status !== "blocked");
    const commandRef = invariant?.verification.ref;
    const commandPassed =
      invariant?.verification.mode === "command" &&
      commandRef !== undefined &&
      input.manifest.commandIds.includes(commandRef) &&
      commands.get(commandRef) === "passed";
    const humanPassed =
      invariant?.verification.mode === "human" &&
      evidence.length > 0 &&
      evidence.every((item) => item.status !== "blocked") &&
      claimedBy(
        "invariant",
        id,
        semanticClaimDigest("invariant", id, {
          statement: invariant.statement,
          verificationRef: invariant.verification.ref,
        }),
      ) !== undefined;
    const passed = linkedPassed && (commandPassed || humanPassed);
    items.push({
      kind: "invariant",
      id,
      coverage: "preservation",
      status: passed ? (humanPassed ? "attested" : "passed") : "blocked",
      evidenceRefs: [
        ...evidence.map((item) => `acceptance:${item.id}`),
        ...(commandPassed ? [`command:${commandRef}`] : []),
        ...(humanPassed ? [`attestation:invariant:${id}`] : []),
      ],
      ...(passed
        ? {}
        : { reason: "affected invariant lacks passing evidence" }),
    });
  }
  for (const id of input.manifest.uncertainInvariantIds) {
    const exception = exceptionFor(id);
    const active =
      exception !== undefined &&
      Date.parse(exception.approvedAt) <= now.getTime() &&
      Date.parse(exception.expiresAt) > now.getTime();
    items.push({
      kind: "invariant",
      id,
      coverage: "preservation",
      status: active ? "attested" : "blocked",
      evidenceRefs: active ? [`exception:${exception.id}`] : [],
      ...(!active
        ? { reason: "uncertain invariant lacks an active exception" }
        : {}),
    });
  }
  for (const id of input.manifest.scenarioIds) {
    const scenario = scenarios.get(id);
    const evidence = linked("scenario", id);
    const linkedPassed =
      evidence.length > 0 &&
      evidence.every((item) => item.status !== "blocked");
    const commandRef = scenario?.executionRef;
    const commandPassed =
      commandRef !== undefined &&
      input.manifest.commandIds.includes(commandRef) &&
      commands.get(commandRef) === "passed";
    const humanPassed =
      commandRef === undefined &&
      scenario !== undefined &&
      scenario.oracleOwner !== "repository" &&
      evidence.length > 0 &&
      evidence.every((item) => item.status !== "blocked") &&
      claimedBy(
        "scenario",
        id,
        semanticClaimDigest("scenario", id, scenario as unknown as JsonValue),
      ) !== undefined;
    const passed = linkedPassed && (commandPassed || humanPassed);
    items.push({
      kind: "scenario",
      id,
      coverage: scenario?.coverage ?? "new_behavior",
      status: passed ? (humanPassed ? "attested" : "passed") : "blocked",
      evidenceRefs: [
        ...evidence.map((item) => `acceptance:${item.id}`),
        ...(commandPassed ? [`command:${commandRef}`] : []),
        ...(humanPassed ? [`attestation:scenario:${id}`] : []),
      ],
      ...(passed ? {} : { reason: "scenario lacks passing evidence" }),
    });
  }
  const newBehavior = items.filter(
    (item) => item.coverage === "new_behavior" || item.coverage === "both",
  );
  const preservation = items.filter(
    (item) => item.coverage === "preservation" || item.coverage === "both",
  );
  const newBehaviorPassed =
    newBehavior.length > 0 &&
    newBehavior.every((item) => item.status !== "blocked");
  const preservationPassed =
    preservation.length === 0 ||
    preservation.every((item) => item.status !== "blocked");
  return {
    impactManifestDigest: canonicalDigest(input.manifest),
    items,
    newBehaviorPassed,
    preservationPassed,
    passed: newBehaviorPassed && preservationPassed,
  };
}
