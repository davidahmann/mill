import { readFile, writeFile } from "node:fs/promises";
import { assertReleaseChannels } from "./release-evidence-identity.mjs";

const [
  metadataPath,
  npmPath,
  githubLatestPath,
  githubReadbackPath,
  outputPath,
] = process.argv.slice(2);
if (
  !metadataPath ||
  !npmPath ||
  !githubLatestPath ||
  !githubReadbackPath ||
  !outputPath
) {
  throw new Error(
    "usage: capture-release-channels.mjs <artifact-metadata.json> <npm-observation.json> <github-latest.json> <github-readback.json> <channels-output.json>",
  );
}
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const [metadata, npm, latest, githubRelease] = await Promise.all([
  readJson(metadataPath),
  readJson(npmPath),
  readJson(githubLatestPath),
  readJson(githubReadbackPath),
]);
const tag = `v${metadata.package.version}`;
if (
  !Number.isSafeInteger(latest.id) ||
  latest.id <= 0 ||
  latest.draft !== false ||
  latest.prerelease !== false ||
  latest.html_url !==
    `https://github.com/davidahmann/mill/releases/tag/${tag}` ||
  !Number.isFinite(Date.parse(latest.published_at)) ||
  Date.parse(latest.published_at) !== Date.parse(githubRelease.publishedAt)
) {
  throw new Error(
    "GitHub Latest response is not the published release receipt",
  );
}
const observedAt = new Date().toISOString();
const channels = {
  npm,
  github: { releaseId: String(latest.id), tag: latest.tag_name, observedAt },
};
assertReleaseChannels({
  state: "verified",
  package: { ...metadata.package, tag },
  githubRelease,
  channels,
  generatedAt: observedAt,
});
await writeFile(outputPath, `${JSON.stringify(channels, undefined, 2)}\n`, {
  flag: "wx",
  mode: 0o644,
});
