import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertReleaseChannels,
  assertReleaseIdentity,
} from "./release-evidence-identity.mjs";

const [
  metadataPath,
  qualificationPath,
  sbomPath,
  identityPath,
  outputPath,
  registryPath,
  githubPath,
  workflowRunsPath,
  channelsPath,
] = process.argv.slice(2);
if (
  metadataPath === undefined ||
  qualificationPath === undefined ||
  sbomPath === undefined ||
  identityPath === undefined ||
  outputPath === undefined
) {
  throw new Error(
    "usage: assemble-release-evidence.mjs <artifact-metadata.json> <qualification.json> <sbom.json> <identity.json> <output.json> [registry.json] [github.json] [workflow-runs.json] [channels.json]",
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
  registryPath === undefined || registryPath === "-"
    ? null
    : await readJson(registryPath);
const githubRelease =
  githubPath === undefined || githubPath === "-"
    ? null
    : await readJson(githubPath);
const workflowRuns =
  workflowRunsPath === undefined ? undefined : await readJson(workflowRunsPath);
const channels =
  channelsPath === undefined ? undefined : await readJson(channelsPath);
assertReleaseIdentity(metadata, qualification, identity);
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
  qualification: {
    supportTuple: {
      id: qualification.supportTuple.id,
      status: qualification.supportTuple.status,
      testedAt: qualification.supportTuple.testedAt,
      expiresAt: qualification.supportTuple.expiresAt,
      digest: mill.canonicalDigest(qualification.supportTuple),
    },
  },
  sbomDigest: `sha256:${createHash("sha256").update(sbomBytes).digest("hex")}`,
  ...(workflowRuns === undefined ? {} : { workflowRuns }),
  registry,
  githubRelease,
  ...(channels === undefined ? {} : { channels }),
  generatedAt: new Date().toISOString(),
});
assertReleaseChannels(evidence);
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
if (
  workflowRuns !== undefined &&
  (workflowRuns.candidate?.headCommit !== identity.tagCommit ||
    workflowRuns.publish?.headCommit !== identity.tagCommit)
) {
  throw new Error(
    "workflow run identities do not bind the exact tagged commit",
  );
}
await writeFile(outputPath, `${JSON.stringify(evidence, undefined, 2)}\n`, {
  flag: "wx",
  mode: 0o644,
});
process.stdout.write(`${mill.canonicalDigest(evidence)}\n`);
