import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
const parsedDraft = mill.contractSchemas.releaseEvidence.parse(draft);
const parsedFinal = mill.contractSchemas.releaseEvidence.parse(final);
const artifactPath = asset(metadata.selectedArtifact?.filename);
const artifactBytes = await readFile(artifactPath);

if (
  !Array.isArray(metadata.builders) ||
  metadata.builders.length !== 2 ||
  !same(parsedDraft.builders, metadata.builders) ||
  !same(parsedFinal.builders, metadata.builders) ||
  !same(parsedDraft.selectedArtifact, metadata.selectedArtifact) ||
  !same(parsedFinal.selectedArtifact, metadata.selectedArtifact) ||
  digest(artifactBytes) !== metadata.selectedArtifact?.sha256
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
