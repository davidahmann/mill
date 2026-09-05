import { validationEvidenceSchema } from "../contracts/schemas.js";
import { ExitCode, MillError } from "../errors.js";
import type { RunRecord } from "./state.js";

/** Only a completed native failure is actionable; missing infrastructure is not. */
export function validationRepairFindings(run: RunRecord) {
  if (run.blockCode !== "VALIDATION_FAILED" || run.validationJson === undefined)
    return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(run.validationJson);
  } catch {
    raw = null;
  }
  const parsed = validationEvidenceSchema.safeParse(raw);
  if (
    !parsed.success ||
    parsed.data.candidateCommit !== run.candidateCommit ||
    parsed.data.passed
  ) {
    throw new MillError(
      "VALIDATION_EVIDENCE_INVALID",
      "Repair requires failed native evidence bound to this exact candidate.",
      ExitCode.configuration,
    );
  }
  const failed = parsed.data.commands.filter(
    (command) => command.required && command.status !== "passed",
  );
  if (
    failed.length === 0 ||
    failed.some(
      (command) =>
        command.status !== "failed" || command.reason !== "NONZERO_EXIT",
    )
  )
    return undefined;
  return failed.map((command) => ({
    id: `validation-${command.commandId}`,
    severity: "P1" as const,
    class: "correctness" as const,
    title: `Native command failed: ${command.commandId}`,
    body: `Repair the candidate within its original allowed paths. Do not change tests, command controls, or authority. Command ${command.commandId} exited ${command.exitCode}; preserved output digest ${command.outputDigest}. Rerun the declared command to diagnose.`,
    file: null,
    line: null,
  }));
}
