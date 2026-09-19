import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertReleaseChannels,
  assertReleaseIdentity,
} from "./release-evidence-identity.mjs";

const [assetsDirectory, draftName, finalName] = process.argv.slice(2);
if (
  assetsDirectory === undefined ||
  draftName === undefined ||
  finalName === undefined
) {
  throw new Error(
    "usage: reconstruct-release-evidence.mjs <release-assets-directory> <draft-evidence.json> <final-evidence.json>",
  );
}
for (const name of [draftName, finalName]) {
  if (path.basename(name) !== name) {
    throw new Error("release evidence filenames must not contain a path");
  }
}
const root = path.resolve(import.meta.dirname, "..");
const mill = await import(
  pathToFileURL(path.join(root, "dist", "index.js")).href
);
const asset = (name) => path.join(path.resolve(assetsDirectory), name);
const readJson = async (name) =>
  JSON.parse(await readFile(asset(name), "utf8"));
const digest = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const same = (left, right) =>
  mill.canonicalDigest(left) === mill.canonicalDigest(right);

const [metadata, qualification, identity, sbom, draft, final] =
  await Promise.all([
    readJson("artifact-metadata.json"),
    readJson("qualification.json"),
    readJson("identity.json"),
    readFile(asset("sbom.cdx.json")),
    readJson(draftName),
    readJson(finalName),
  ]);
const parsedQualification =
  mill.contractSchemas.publicAlphaQualification.parse(qualification);
// Judge historical qualification at its recorded generation time, not today.
const assessment = mill.assessPublicAlphaQualification(
  parsedQualification,
  new Date(parsedQualification.generatedAt),
);
if (!assessment.passed) {
  throw new Error(
    `retained qualification did not pass: ${assessment.blockers.join("; ")}`,
  );
}
const parsedDraft = mill.contractSchemas.releaseEvidence.parse(draft);
const parsedFinal = mill.contractSchemas.releaseEvidence.parse(final);
assertReleaseIdentity(metadata, parsedQualification, identity);
// Use the validated evidence filename before accessing a retained asset.
if (!same(parsedFinal.selectedArtifact, metadata.selectedArtifact)) {
  throw new Error(
    "release evidence does not bind the retained package artifact",
  );
}
const artifactPath = asset(metadata.selectedArtifact?.filename);
const artifactBytes = await readFile(artifactPath);

if (
  !Array.isArray(metadata.builders) ||
  metadata.builders.length !== 2 ||
  !same(parsedDraft.builders, metadata.builders) ||
  !same(parsedFinal.builders, metadata.builders) ||
  !same(parsedDraft.selectedArtifact, metadata.selectedArtifact) ||
  !same(parsedFinal.selectedArtifact, metadata.selectedArtifact) ||
  digest(artifactBytes) !== metadata.selectedArtifact?.sha256 ||
  `sha512-${createHash("sha512").update(artifactBytes).digest("base64")}` !==
    metadata.selectedArtifact.npmIntegrity
) {
  throw new Error(
    "release evidence does not bind the retained package artifact",
  );
}
const expectedPackage = {
  name: metadata.package?.name,
  version: metadata.package?.version,
  tag: `v${metadata.package?.version}`,
};
const expectedQualification = {
  supportTuple: {
    id: parsedQualification.supportTuple.id,
    status: parsedQualification.supportTuple.status,
    testedAt: parsedQualification.supportTuple.testedAt,
    expiresAt: parsedQualification.supportTuple.expiresAt,
    digest: mill.canonicalDigest(parsedQualification.supportTuple),
  },
};
for (const evidence of [parsedDraft, parsedFinal]) {
  assertReleaseChannels(evidence);
  if (
    !same(evidence.package, expectedPackage) ||
    evidence.qualificationDigest !==
      mill.canonicalDigest(parsedQualification) ||
    !same(evidence.qualification, expectedQualification) ||
    evidence.sbomDigest !== digest(sbom) ||
    evidence.source.reviewedCandidateTree !== identity.reviewedCandidateTree ||
    evidence.source.resultingMainCommit !== identity.tagCommit ||
    evidence.source.resultingMainTree !== identity.mainTree ||
    evidence.source.tagCommit !== identity.tagCommit ||
    evidence.workflowRuns?.candidate.headCommit !== identity.tagCommit ||
    evidence.workflowRuns?.publish.headCommit !== identity.tagCommit
  ) {
    throw new Error(
      "release evidence does not bind its qualification and source identity",
    );
  }
}
if (
  parsedDraft.state !== "verified" ||
  parsedDraft.githubRelease?.state !== "draft" ||
  parsedDraft.githubRelease.publishedAt !== null ||
  parsedFinal.state !== "verified" ||
  parsedFinal.githubRelease?.state !== "published" ||
  parsedFinal.githubRelease.publishedAt === null ||
  !same(parsedDraft.workflowRuns, parsedFinal.workflowRuns) ||
  !same(parsedDraft.registry, parsedFinal.registry)
) {
  throw new Error(
    "release evidence does not preserve ordered draft and published observations",
  );
}
for (const evidence of [parsedDraft, parsedFinal]) {
  if (
    evidence.registry === null ||
    evidence.registry.integrity !== metadata.selectedArtifact.npmIntegrity ||
    evidence.registry.provenanceVerified !== true
  ) {
    throw new Error(
      "registry readback does not prove selected artifact integrity and provenance",
    );
  }
  const receipt = evidence.githubRelease;
  if (
    receipt === null ||
    receipt.tag !== expectedPackage.tag ||
    receipt.artifactDigest !== metadata.selectedArtifact.sha256 ||
    receipt.url !==
      `https://github.com/davidahmann/mill/releases/tag/${expectedPackage.tag}`
  ) {
    throw new Error(
      "release evidence does not bind the provider release receipt",
    );
  }
}
if (
  parsedDraft.githubRelease.releaseId !== parsedFinal.githubRelease.releaseId
) {
  throw new Error(
    "release evidence does not preserve one GitHub Release identity",
  );
}
process.stdout.write(
  `${JSON.stringify(
    {
      schemaVersion: "1",
      package: expectedPackage,
      artifact: {
        filename: metadata.selectedArtifact.filename,
        sha256: metadata.selectedArtifact.sha256,
      },
      evidence: {
        draft: { name: draftName, digest: mill.canonicalDigest(parsedDraft) },
        final: { name: finalName, digest: mill.canonicalDigest(parsedFinal) },
      },
      reconstructedAt: new Date().toISOString(),
    },
    undefined,
    2,
  )}\n`,
);
