import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [
  metadataPath,
  registryPath,
  releasePath,
  downloadedArtifactPath,
  registryOutput,
  githubOutput,
] = process.argv.slice(2);
if (
  metadataPath === undefined ||
  registryPath === undefined ||
  releasePath === undefined ||
  downloadedArtifactPath === undefined ||
  registryOutput === undefined ||
  githubOutput === undefined
) {
  throw new Error(
    "usage: capture-release-readback.mjs <metadata.json> <registry.json> <release.json> <downloaded.tgz> <registry-output.json> <github-output.json>",
  );
}
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const [metadata, registry, release, downloadedBytes] = await Promise.all([
  readJson(metadataPath),
  readJson(registryPath),
  readJson(releasePath),
  readFile(downloadedArtifactPath),
]);
const expected = metadata.selectedArtifact;
const downloadedDigest = `sha256:${createHash("sha256")
  .update(downloadedBytes)
  .digest("hex")}`;
if (downloadedDigest !== expected.sha256) {
  throw new Error(
    "GitHub Release artifact bytes differ from the qualified artifact",
  );
}
if (
  registry.integrity !== expected.npmIntegrity ||
  typeof registry.tarball !== "string"
) {
  throw new Error("npm registry readback differs from the qualified artifact");
}
const provenanceUrl = registry.attestations?.url;
const provenancePredicate = registry.attestations?.provenance?.predicateType;
if (
  typeof provenanceUrl !== "string" ||
  !provenanceUrl.startsWith("https://") ||
  typeof provenancePredicate !== "string" ||
  provenancePredicate.length === 0
) {
  throw new Error(
    "npm registry readback does not expose provenance attestation",
  );
}
const expectedTag = `v${metadata.package.version}`;
let releaseUrl;
try {
  releaseUrl = new URL(release.url);
} catch {
  throw new Error("GitHub Release readback does not expose a valid URL");
}
if (
  release.tagName !== expectedTag ||
  typeof release.url !== "string" ||
  releaseUrl.protocol !== "https:" ||
  releaseUrl.origin !== "https://github.com" ||
  releaseUrl.username !== "" ||
  releaseUrl.password !== "" ||
  releaseUrl.search !== "" ||
  releaseUrl.hash !== "" ||
  !releaseUrl.pathname.endsWith(
    `/releases/tag/${encodeURIComponent(expectedTag)}`,
  ) ||
  !Array.isArray(release.assets) ||
  !release.assets.some(
    (asset) => asset.name === path.basename(downloadedArtifactPath),
  )
) {
  throw new Error(
    "GitHub Release readback does not expose the expected tag and artifact",
  );
}
await Promise.all([
  writeFile(
    registryOutput,
    `${JSON.stringify(
      {
        tarball: registry.tarball,
        integrity: registry.integrity,
        provenanceVerified: true,
      },
      undefined,
      2,
    )}\n`,
    { flag: "wx", mode: 0o644 },
  ),
  writeFile(
    githubOutput,
    `${JSON.stringify(
      {
        url: release.url,
        tag: expectedTag,
        artifactDigest: downloadedDigest,
      },
      undefined,
      2,
    )}\n`,
    { flag: "wx", mode: 0o644 },
  ),
]);
