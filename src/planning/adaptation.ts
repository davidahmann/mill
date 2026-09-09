import type { z } from "zod";
import {
  adaptationEvidenceSchema,
  type adaptationManifestSchema,
} from "../contracts/schemas.js";
import type { CommandEvidence } from "../runtime/verifier.js";

export type AdaptationManifest = z.infer<typeof adaptationManifestSchema>;

export function adaptationReferences(manifest: AdaptationManifest) {
  return [
    manifest.provider.notice,
    manifest.applicability.evidence,
    ...manifest.configurations.map((item) => item.fixture),
  ];
}

/** Static consistency only; the operator owns applicability and fixture fidelity. */
export function assessAdaptation(
  manifest: AdaptationManifest,
  selected: {
    commandIds: readonly string[];
    requiredCommandIds: readonly string[];
    scenarios: readonly { id: string; executionRef?: string | undefined }[];
  },
  now = new Date(),
  allowExpired = false,
): string[] {
  const blockers: string[] = [];
  const profiles = manifest.configurations.map((item) => item.id);
  if (profiles.length === 0 || new Set(profiles).size !== profiles.length)
    blockers.push("configuration IDs must be nonempty and unique");
  if (
    manifest.workflows.length === 0 ||
    new Set(manifest.workflows).size !== manifest.workflows.length
  )
    blockers.push("workflow IDs must be nonempty and unique");
  const captured = Date.parse(manifest.fixtures.capturedAt);
  const expires = Date.parse(manifest.fixtures.expiresAt);
  if (
    !Number.isFinite(now.getTime()) ||
    captured > now.getTime() ||
    (!allowExpired && expires <= now.getTime()) ||
    expires <= captured
  )
    blockers.push("fixture evidence is future-dated or expired");
  if (manifest.provider.from === manifest.provider.to)
    blockers.push("provider source and target contracts must differ");
  const pairs = new Set<string>();
  const commands = new Set<string>();
  for (const cell of manifest.matrix) {
    const key = JSON.stringify([cell.workflowId, cell.configurationId]);
    if (pairs.has(key)) blockers.push(`duplicate matrix pair: ${key}`);
    pairs.add(key);
    if (
      !manifest.workflows.includes(cell.workflowId) ||
      !profiles.includes(cell.configurationId)
    )
      blockers.push(`unknown matrix pair: ${key}`);
    if (cell.disposition === "excluded") continue;
    if (commands.has(cell.commandId))
      blockers.push(
        `matrix cells must use distinct commands: ${cell.commandId}`,
      );
    commands.add(cell.commandId);
    if (
      !selected.commandIds.includes(cell.commandId) ||
      !selected.requiredCommandIds.includes(cell.commandId)
    )
      blockers.push(
        `matrix command must be selected and required: ${cell.commandId}`,
      );
    if (
      !selected.scenarios.some(
        (scenario) =>
          scenario.id === cell.scenarioId &&
          scenario.executionRef === cell.commandId,
      )
    )
      blockers.push(
        `matrix scenario must execute its bound command: ${cell.scenarioId}`,
      );
  }
  for (const workflow of manifest.workflows)
    for (const profile of profiles) {
      const key = JSON.stringify([workflow, profile]);
      if (!pairs.has(key)) blockers.push(`missing matrix pair: ${key}`);
    }
  if (commands.size === 0)
    blockers.push("adaptation requires at least one executed case");
  return [...new Set(blockers)].sort();
}

export function adaptationEvidence(
  manifest: AdaptationManifest,
  manifestDigest: string,
  commands: readonly CommandEvidence[],
  now = new Date(),
) {
  return adaptationEvidenceSchema.parse({
    manifestDigest,
    observedAt: now.toISOString(),
    assurance: "offline_fixture_execution",
    ownerAcceptance: "not_recorded",
    provider: manifest.provider,
    configurations: manifest.configurations,
    fixtures: manifest.fixtures,
    matrix: manifest.matrix.map((cell) => {
      if (cell.disposition === "excluded")
        return {
          workflowId: cell.workflowId,
          configurationId: cell.configurationId,
          status: "excluded",
          reason: cell.reason,
        };
      const results = commands.filter(
        (command) => command.commandId === cell.commandId,
      );
      const result = results.length === 1 ? results[0] : undefined;
      return {
        workflowId: cell.workflowId,
        configurationId: cell.configurationId,
        scenarioId: cell.scenarioId,
        commandId: cell.commandId,
        status:
          Date.parse(manifest.fixtures.expiresAt) <= now.getTime()
            ? "blocked"
            : (result?.status ?? "blocked"),
        ...(Date.parse(manifest.fixtures.expiresAt) <= now.getTime()
          ? {
              reason: "Fixture evidence expired before verification completed.",
            }
          : {}),
        ...(result === undefined
          ? { reason: "No unique command result was recorded." }
          : { outputDigest: result.outputDigest }),
      };
    }),
  });
}
