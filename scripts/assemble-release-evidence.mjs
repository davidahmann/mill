import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [
  metadataPath,
  qualificationPath,
  sbomPath,
  identityPath,
  outputPath,
  registryPath,
  githubPath,
] = process.argv.slice(2);
if (
  metadataPath === undefined ||
  qualificationPath === undefined ||
  sbomPath === undefined ||
  identityPath === undefined ||
  outputPath === undefined
) {
  throw new Error(
    "usage: assemble-release-evidence.mjs <artifact-metadata.json> <qualification.json> <sbom.json> <identity.json> <output.json> [registry.json] [github.json]",
  );
}
const root = path.resolve(import.meta.dirname, "..");
const mill = await import(
  pathToFileURL(path.join(root, "dist", "index.js")).href
);
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const [metadata, qualification, sbomBytes, identity] = await Promise.all([
  readJson(metadataPath),
  readJson(qualificationPath),
  readFile(sbomPath),
  readJson(identityPath),
]);
const registry =
  registryPath === undefined ? null : await readJson(registryPath);
const githubRelease =
  githubPath === undefined ? null : await readJson(githubPath);
if (
  !Array.isArray(metadata.builders) ||
  metadata.builders.length !== 2 ||
  metadata.builders[0]?.builder === metadata.builders[1]?.builder ||
  metadata.builders[0]?.contentsDigest !== metadata.builders[1]?.contentsDigest
) {
  throw new Error(
    "release metadata does not contain two distinct equal-content builders",
  );
}
const selectedBuilder = metadata.builders.find(
  (builder) => builder.builder === metadata.selectedArtifact?.builder,
);
if (
  selectedBuilder === undefined ||
  selectedBuilder.filename !== metadata.selectedArtifact.filename ||
  selectedBuilder.sha256 !== metadata.selectedArtifact.sha256 ||
  selectedBuilder.npmIntegrity !== metadata.selectedArtifact.npmIntegrity ||
  selectedBuilder.contentsDigest !== metadata.selectedArtifact.contentsDigest
) {
  throw new Error("selected release artifact is not one exact builder output");
}
if (
  metadata.package.name !== qualification.package.name ||
  metadata.package.version !== qualification.package.version ||
  metadata.selectedArtifact.sha256 !== qualification.package.artifactDigest ||
  metadata.selectedArtifact.npmIntegrity !==
    qualification.package.npmIntegrity ||
  identity.packageName !== metadata.package.name ||
  identity.version !== metadata.package.version ||
  identity.tag !== `v${metadata.package.version}`
) {
  throw new Error(
    "release source, artifact, and qualification identities do not match",
  );
}
if (
  qualification.auditCandidate?.commit !== identity.tagCommit ||
  qualification.auditCandidate?.tree !== identity.mainTree
) {
  throw new Error(
    "qualification audit is not bound to the tagged main candidate",
  );
}
const evidence = mill.contractSchemas.releaseEvidence.parse({
  schemaVersion: "1",
  state:
    githubRelease === null
      ? registry === null
        ? "qualified"
        : "published"
      : "verified",
  package: {
    name: metadata.package.name,
    version: metadata.package.version,
    tag: identity.tag,
  },
  source: {
    reviewedCandidateTree: identity.reviewedCandidateTree,
    resultingMainCommit: identity.tagCommit,
    resultingMainTree: identity.mainTree,
    tagCommit: identity.tagCommit,
  },
  builders: metadata.builders,
  selectedArtifact: metadata.selectedArtifact,
  qualificationDigest: mill.canonicalDigest(qualification),
  sbomDigest: `sha256:${createHash("sha256").update(sbomBytes).digest("hex")}`,
  registry,
  githubRelease,
  generatedAt: new Date().toISOString(),
});
if (
  evidence.source.reviewedCandidateTree !== evidence.source.resultingMainTree ||
  evidence.source.tagCommit !== evidence.source.resultingMainCommit
) {
  throw new Error(
    "release source identity chain is not tree and commit preserving",
  );
}
if (
  registry !== null &&
  (registry.integrity !== metadata.selectedArtifact.npmIntegrity ||
    registry.provenanceVerified !== true)
) {
  throw new Error(
    "registry readback does not prove selected artifact integrity and provenance",
  );
}
if (
  githubRelease !== null &&
  (githubRelease.tag !== identity.tag ||
    githubRelease.artifactDigest !== metadata.selectedArtifact.sha256)
) {
  throw new Error(
    "GitHub Release readback does not prove tag and artifact identity",
  );
}
await writeFile(outputPath, `${JSON.stringify(evidence, undefined, 2)}\n`, {
  flag: "wx",
  mode: 0o644,
});
process.stdout.write(`${mill.canonicalDigest(evidence)}\n`);
