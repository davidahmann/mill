import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { ExitCode, MillError } from "../errors.js";
import { safeReadText } from "../security/safe-path.js";

const minutes = z.number().nonnegative().nullable();

const developmentEvidenceLedgerSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  records: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        change: z.string().min(1),
        eligibility: z.discriminatedUnion("status", [
          z.strictObject({ status: z.literal("eligible") }),
          z.strictObject({
            status: z.literal("excluded"),
            reason: z.string().min(1),
          }),
        ]),
        route: z.discriminatedUnion("kind", [
          z.strictObject({ kind: z.literal("mill") }),
          z.strictObject({
            kind: z.literal("manual"),
            reason: z.string().min(1),
          }),
        ]),
        outcome: z.enum([
          "in_progress",
          "accepted",
          "not_accepted",
          "abandoned",
        ]),
        effort: z.strictObject({
          preparationMinutes: minutes,
          reviewMinutes: minutes,
          repairMinutes: minutes,
        }),
        elapsedMinutes: minutes,
        repairs: z.number().int().nonnegative(),
        providerUsage: z
          .strictObject({
            inputTokens: z.number().int().nonnegative().nullable(),
            outputTokens: z.number().int().nonnegative().nullable(),
            cost: z.number().nonnegative().nullable(),
            currency: z.string().min(1).nullable(),
          })
          .optional(),
      }),
    )
    .refine(
      (records) =>
        new Set(records.map((record) => record.id)).size === records.length,
      {
        message: "expected unique development-evidence record IDs",
      },
    ),
});

export type DevelopmentEvidenceLedger = z.infer<
  typeof developmentEvidenceLedgerSchema
>;

export interface DevelopmentEvidenceSummary {
  ledgerPath: string | null;
  records: number;
  eligibleChanges: number;
  eligibleMillRoute: number;
  eligibleManualRoute: number;
  eligibleCompleted: number;
  eligibleAccepted: number;
  effort: {
    preparationMinutes: number | null;
    reviewMinutes: number | null;
    repairMinutes: number | null;
  };
  elapsedMinutes: number | null;
  providerUsage: {
    inputTokens: number | null;
    outputTokens: number | null;
    cost: number | null;
    currency: string | null;
  };
}

function completeSum(values: readonly (number | null)[]): number | null {
  if (values.length === 0 || values.some((value) => value === null)) {
    return null;
  }
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

/**
 * Loads maintainer-entered change evidence. It intentionally does not infer a
 * denominator, human time, or provider cost from durable run state.
 */
export async function developmentEvidenceSummary(input: {
  root: string;
  ledgerPath?: string;
}): Promise<DevelopmentEvidenceSummary> {
  if (input.ledgerPath === undefined) {
    return {
      ledgerPath: null,
      records: 0,
      eligibleChanges: 0,
      eligibleMillRoute: 0,
      eligibleManualRoute: 0,
      eligibleCompleted: 0,
      eligibleAccepted: 0,
      effort: {
        preparationMinutes: null,
        reviewMinutes: null,
        repairMinutes: null,
      },
      elapsedMinutes: null,
      providerUsage: {
        inputTokens: null,
        outputTokens: null,
        cost: null,
        currency: null,
      },
    };
  }
  let parsed: DevelopmentEvidenceLedger;
  try {
    parsed = developmentEvidenceLedgerSchema.parse(
      parseYaml(
        await safeReadText(input.root, input.ledgerPath, 2 * 1024 * 1024),
      ),
    );
  } catch (error) {
    if (error instanceof MillError) throw error;
    throw new MillError(
      "DEVELOPMENT_EVIDENCE_LEDGER_INVALID",
      `The development-evidence ledger does not satisfy its contract: ${input.ledgerPath}.`,
      ExitCode.data,
    );
  }
  const eligible = parsed.records.filter(
    (record) => record.eligibility.status === "eligible",
  );
  const values = (
    key: keyof (typeof parsed.records)[number]["effort"],
  ): (number | null)[] => eligible.map((record) => record.effort[key]);
  const elapsed = eligible.map((record) => record.elapsedMinutes);
  const usage = eligible.map((record) => record.providerUsage);
  const currencies = new Set(
    usage
      .map((value) => value?.currency)
      .filter(
        (value): value is string => value !== null && value !== undefined,
      ),
  );
  const currency =
    usage.length > 0 &&
    usage.every(
      (value) => value?.currency !== null && value?.currency !== undefined,
    ) &&
    currencies.size === 1
      ? ([...currencies][0] ?? null)
      : null;
  return {
    ledgerPath: input.ledgerPath,
    records: parsed.records.length,
    eligibleChanges: eligible.length,
    eligibleMillRoute: eligible.filter((record) => record.route.kind === "mill")
      .length,
    eligibleManualRoute: eligible.filter(
      (record) => record.route.kind === "manual",
    ).length,
    eligibleCompleted: eligible.filter(
      (record) => record.outcome !== "in_progress",
    ).length,
    eligibleAccepted: eligible.filter((record) => record.outcome === "accepted")
      .length,
    effort: {
      preparationMinutes: completeSum(values("preparationMinutes")),
      reviewMinutes: completeSum(values("reviewMinutes")),
      repairMinutes: completeSum(values("repairMinutes")),
    },
    elapsedMinutes: completeSum(elapsed),
    providerUsage: {
      inputTokens: completeSum(
        usage.map((value) => value?.inputTokens ?? null),
      ),
      outputTokens: completeSum(
        usage.map((value) => value?.outputTokens ?? null),
      ),
      cost:
        currency === null
          ? null
          : completeSum(usage.map((value) => value?.cost ?? null)),
      currency,
    },
  };
}
