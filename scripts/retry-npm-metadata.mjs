import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const [metadataPath, distOutputPath, observationOutputPath] =
  process.argv.slice(2);
if (!metadataPath || !distOutputPath || !observationOutputPath) {
  throw new Error(
    "usage: retry-npm-metadata.mjs <artifact-metadata.json> <dist-output.json> <npm-observation-output.json>",
  );
}
const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
const version = metadata.package?.version;
const integrity = metadata.selectedArtifact?.npmIntegrity;
if (
  metadata.package?.name !== "@davidahmann/mill" ||
  typeof version !== "string" ||
  !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version) ||
  typeof integrity !== "string" ||
  !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(integrity)
) {
  throw new Error(
    "npm metadata readback requires an exact qualified package identity",
  );
}
function bounded(value, fallback, minimum, maximum, name) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}
const attempts = bounded(
  process.env.MILL_NPM_METADATA_ATTEMPTS,
  20,
  1,
  20,
  "MILL_NPM_METADATA_ATTEMPTS",
);
const delayMs = bounded(
  process.env.MILL_NPM_METADATA_DELAY_MS,
  30_000,
  0,
  60_000,
  "MILL_NPM_METADATA_DELAY_MS",
);
let lastFailure = "npm metadata is unavailable";
for (let attempt = 1; attempt <= attempts; attempt += 1) {
  const result = spawnSync(
    "npm",
    [
      "view",
      `${metadata.package.name}@${version}`,
      "version",
      "dist",
      "dist-tags",
      "--json",
      "--prefer-online",
    ],
    {
      encoding: "utf8",
      env: process.env,
      maxBuffer: 4 * 1024 * 1024,
      timeout: 60_000,
    },
  );
  if (result.status === 0) {
    const observed = JSON.parse(result.stdout);
    // A returned immutable identity conflict is not a propagation delay.
    if (
      (observed.version !== undefined && observed.version !== version) ||
      (observed.dist?.integrity !== undefined &&
        observed.dist.integrity !== integrity)
    ) {
      throw new Error(
        "npm metadata conflicts with the immutable qualified package identity",
      );
    }
    const dist = observed.dist;
    if (
      observed.version === version &&
      dist?.integrity === integrity &&
      typeof dist.tarball === "string" &&
      dist.tarball.startsWith("https://") &&
      typeof dist.attestations?.url === "string" &&
      dist.attestations.url.startsWith("https://") &&
      typeof dist.attestations?.provenance?.predicateType === "string" &&
      dist.attestations.provenance.predicateType.length > 0 &&
      observed["dist-tags"]?.latest === version
    ) {
      await writeFile(
        distOutputPath,
        `${JSON.stringify(dist, undefined, 2)}\n`,
        { flag: "wx", mode: 0o644 },
      );
      await writeFile(
        observationOutputPath,
        `${JSON.stringify({ latestVersion: version, observedAt: new Date().toISOString() }, undefined, 2)}\n`,
        { flag: "wx", mode: 0o644 },
      );
      process.stdout.write(
        `npm metadata and latest readback settled on attempt ${attempt}/${attempts}\n`,
      );
      process.exit(0);
    }
    lastFailure =
      "exact version, artifact integrity, provenance metadata, or latest tag has not propagated";
  } else {
    lastFailure =
      result.error === undefined
        ? `${result.stderr}${result.stdout}`.trim().slice(-4_096)
        : String(result.error);
  }
  if (attempt < attempts) {
    process.stderr.write(
      `npm metadata readback attempt ${attempt}/${attempts} failed; retrying in ${delayMs}ms\n`,
    );
    await delay(delayMs);
  }
}
throw new Error(
  `npm metadata readback did not settle after ${attempts} attempts: ${lastFailure}`,
);
