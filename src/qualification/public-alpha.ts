import { parse as parseYaml } from "yaml";
import type { z } from "zod";

import {
  auditCategorySchema,
  publicAlphaQualificationSchema,
} from "../contracts/schemas.js";
import { canonicalDigest } from "../contracts/canonical.js";
import { ExitCode, MillError } from "../errors.js";
import { safeReadText } from "../security/safe-path.js";

export type PublicAlphaQualification = z.infer<
  typeof publicAlphaQualificationSchema
>;

export interface PublicAlphaQualificationAssessment {
  report: PublicAlphaQualification;
  reportDigest: string;
  passed: boolean;
  blockers: string[];
}

const requiredAuditCategories = auditCategorySchema.options;

function sameMembers(actual: readonly string[], expected: readonly string[]) {
  return (
    actual.length === expected.length &&
    new Set(actual).size === actual.length &&
    actual.every((item) => expected.includes(item))
  );
}

function parseQualification(source: string): PublicAlphaQualification {
  let raw: unknown;
  try {
    raw = parseYaml(source);
  } catch (error) {
    throw new MillError(
      "INVALID_PUBLIC_ALPHA_QUALIFICATION",
      "The public-alpha qualification record is not valid YAML or JSON.",
      ExitCode.data,
      { cause: String(error) },
    );
  }
  const parsed = publicAlphaQualificationSchema.safeParse(raw);
  if (!parsed.success) {
    throw new MillError(
      "INVALID_PUBLIC_ALPHA_QUALIFICATION",
      "The public-alpha qualification record does not satisfy its schema.",
      ExitCode.data,
      { issues: parsed.error.issues },
    );
  }
  return parsed.data;
}

export function assessPublicAlphaQualification(
  report: PublicAlphaQualification,
  now = new Date(),
): PublicAlphaQualificationAssessment {
  const blockers: string[] = [];
  const nowTime = now.getTime();
  const testedAt = Date.parse(report.supportTuple.testedAt);
  const expiresAt = Date.parse(report.supportTuple.expiresAt);
  const generatedAt = Date.parse(report.generatedAt);

  if (report.supportTuple.status !== "qualified") {
    blockers.push("support tuple is not qualified");
  }
  if (testedAt > nowTime || generatedAt > nowTime) {
    blockers.push("qualification evidence is future-dated");
  }
  if (expiresAt <= testedAt || expiresAt <= nowTime) {
    blockers.push(
      "support tuple qualification is expired or has no valid window",
    );
  }

  const steps = report.sequence.steps;
  const stepIds = steps.map((step) => step.id);
  if (new Set(stepIds).size !== stepIds.length) {
    blockers.push("longitudinal step IDs are duplicated");
  }
  const candidateCommits = steps.map((step) => step.candidateCommit);
  if (new Set(candidateCommits).size !== candidateCommits.length) {
    blockers.push("accepted sequence reuses a candidate commit");
  }
  for (const [index, step] of steps.entries()) {
    const previous = steps[index - 1];
    if (index === 0) {
      if (step.dependsOn.length !== 0) {
        blockers.push(`${step.id} must be the dependency-free sequence root`);
      }
    } else if (
      previous === undefined ||
      step.dependsOn.length !== 1 ||
      step.dependsOn[0] !== previous.id ||
      step.baseCommit !== previous.candidateCommit
    ) {
      blockers.push(`${step.id} does not start from the prior accepted output`);
    }
    if (step.baseCommit === step.candidateCommit) {
      blockers.push(`${step.id} did not produce a new candidate identity`);
    }
    if (step.status !== "accepted") {
      blockers.push(`${step.id} is not accepted`);
    }
    if (
      !sameMembers(step.newBehavior.passedIds, step.newBehavior.requiredIds)
    ) {
      blockers.push(`${step.id} does not close every new-behavior item`);
    }
    if (
      !sameMembers(step.preservation.passedIds, step.preservation.requiredIds)
    ) {
      blockers.push(`${step.id} does not preserve every required prior item`);
    }
    if (
      step.usage.source === "unavailable" &&
      (step.usage.inputTokens !== null ||
        step.usage.outputTokens !== null ||
        step.usage.currencyCost !== null)
    ) {
      blockers.push(`${step.id} reports usage while declaring it unavailable`);
    }
    if (
      step.usage.source === "operator-declared" &&
      step.usage.inputTokens === null &&
      step.usage.outputTokens === null &&
      step.usage.currencyCost === null
    ) {
      blockers.push(`${step.id} has no operator-declared usage value`);
    }
  }

  const acceptedIdentities = new Set([
    steps[0]?.baseCommit,
    ...candidateCommits,
  ]);
  const fault = report.sequence.seededFault;
  if (!acceptedIdentities.has(fault.baseCommit)) {
    blockers.push("seeded fault does not branch from an accepted identity");
  }
  if (
    fault.baseCommit === fault.candidateCommit ||
    fault.status === "passed" ||
    !fault.rejected ||
    !fault.recovered ||
    fault.enteredAcceptedSequence ||
    candidateCommits.includes(fault.candidateCommit)
  ) {
    blockers.push(
      "seeded fault was not rejected and recovered outside the accepted sequence",
    );
  }

  for (const [name, status] of Object.entries(report.canaries)) {
    if (status !== "passed")
      blockers.push(`required canary did not pass: ${name}`);
  }
  const auditCategories = report.audits.map((audit) => audit.category);
  if (!sameMembers(auditCategories, requiredAuditCategories)) {
    blockers.push(
      "qualification does not contain exactly one result for every audit category",
    );
  }
  for (const audit of report.audits) {
    if (audit.status !== "passed") {
      blockers.push(`required audit did not pass: ${audit.category}`);
    }
  }

  return {
    report,
    reportDigest: canonicalDigest(report),
    passed: blockers.length === 0,
    blockers: [...new Set(blockers)].sort(),
  };
}

export async function loadPublicAlphaQualification(input: {
  root: string;
  file: string;
  now?: Date;
}): Promise<PublicAlphaQualificationAssessment> {
  const source = await safeReadText(input.root, input.file, 2 * 1024 * 1024);
  return assessPublicAlphaQualification(
    parseQualification(source),
    input.now ?? new Date(),
  );
}
