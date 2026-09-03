import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [
  metadataPath,
  supportPath,
  sequencePath,
  canaryPath,
  auditPath,
  outputPath,
] = process.argv.slice(2);
if (
  metadataPath === undefined ||
  supportPath === undefined ||
  sequencePath === undefined ||
  canaryPath === undefined ||
  auditPath === undefined ||
  outputPath === undefined
) {
  throw new Error(
    "usage: assemble-public-alpha-qualification.mjs <artifact-metadata.json> <support-tuple.json> <sequence.json> <release-canary.json> <audit.json> <output.json>",
  );
}

const root = path.resolve(import.meta.dirname, "..");
const mill = await import(
  pathToFileURL(path.join(root, "dist", "index.js")).href
);
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const [metadata, supportTuple, sequence, canary, auditInput] =
  await Promise.all(
    [metadataPath, supportPath, sequencePath, canaryPath, auditPath].map(
      readJson,
    ),
  );
const audit = auditInput.data ?? auditInput;
if (audit.status !== "passed")
  throw new Error("repository audit is not passed");
if (
  canary.package?.name !== metadata.package?.name ||
  canary.package?.version !== metadata.package?.version ||
  canary.recipe?.id !== supportTuple.recipe?.id ||
  canary.recipe?.version !== supportTuple.recipe?.version ||
  canary.recipe?.digest !== supportTuple.recipe?.digest ||
  canary.recipe?.verifierImage !== supportTuple.container?.verifierImage
) {
  throw new Error(
    "artifact, support tuple, verifier image, and canary identities do not match",
  );
}
const qualification = mill.contractSchemas.publicAlphaQualification.parse({
  schemaVersion: "1",
  package: {
    name: metadata.package.name,
    version: metadata.package.version,
    artifactDigest: metadata.selectedArtifact.sha256,
    npmIntegrity: metadata.selectedArtifact.npmIntegrity,
  },
  supportTuple,
  sequence,
  canaries: canary.canaries,
  auditCandidate: audit.candidate,
  audits: audit.checks.map((check) => ({
    category: check.category,
    status: check.status,
    reportDigest: mill.canonicalDigest({
      candidate: audit.candidate,
      check,
    }),
  })),
  generatedAt: new Date().toISOString(),
});
const assessment = mill.assessPublicAlphaQualification(qualification);
if (!assessment.passed) {
  throw new Error(
    `public-alpha qualification is blocked:\n${assessment.blockers.join("\n")}`,
  );
}
await writeFile(
  outputPath,
  `${JSON.stringify(qualification, undefined, 2)}\n`,
  {
    flag: "wx",
    mode: 0o644,
  },
);
process.stdout.write(`${assessment.reportDigest}\n`);
