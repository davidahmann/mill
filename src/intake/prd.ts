import path from "node:path";

import { canonicalDigest } from "../contracts/canonical.js";
import { safeReadText } from "../security/safe-path.js";

export interface PrdInspection {
  path: string;
  digest: string;
  bytes: number;
  headings: readonly string[];
  signals: {
    assumptions: readonly string[];
    ambiguities: readonly string[];
    untrustedInstructions: readonly string[];
  };
  authority: "narrative_untrusted";
}

const unsafeInstructionPatterns = [
  /ignore\s+(all\s+)?previous\s+instructions/iu,
  /(?:^|\s)sudo\s+/iu,
  /(?:^|\s)(?:curl|wget)\s+[^\n|]+\|\s*(?:sh|bash)/iu,
  /grant\s+(?:yourself|the agent)\s+(?:access|permission)/iu,
];

export async function inspectPrd(
  root: string,
  requestedPath: string,
): Promise<PrdInspection> {
  const source = await safeReadText(root, requestedPath);
  const lines = source.split(/\r?\n/u);
  const headings = lines
    .filter((line) => /^#{1,6}\s+/u.test(line))
    .map((line) => line.replace(/^#{1,6}\s+/u, "").trim());
  const ambiguities = lines
    .filter((line) =>
      /\b(?:TBD|TODO|unknown|maybe|unclear)\b|\?\s*$/iu.test(line),
    )
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 50);
  const assumptions = lines
    .filter((line) =>
      /\b(?:assume|assumption|expected to|likely)\b/iu.test(line),
    )
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 50);
  const untrustedInstructions = lines
    .filter((line) =>
      unsafeInstructionPatterns.some((pattern) => pattern.test(line)),
    )
    .map((line) => line.trim())
    .slice(0, 50);

  return {
    path: path.relative(root, path.resolve(root, requestedPath)) || ".",
    digest: canonicalDigest(source),
    bytes: Buffer.byteLength(source),
    headings,
    signals: { assumptions, ambiguities, untrustedInstructions },
    authority: "narrative_untrusted",
  };
}
