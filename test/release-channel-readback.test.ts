import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { temporaryDirectory } from "./helpers.js";

const metadataScript = path.resolve("scripts/retry-npm-metadata.mjs");
const channelsScript = path.resolve("scripts/capture-release-channels.mjs");
const integrity = `sha512-${Buffer.alloc(64).toString("base64")}`;
const metadata = {
  package: { name: "@davidahmann/mill", version: "0.7.0" },
  selectedArtifact: { npmIntegrity: integrity },
};
const publishedAt = "2020-01-01T00:00:00Z";
const githubRelease = { state: "published", releaseId: "13", publishedAt };
const githubLatest = {
  id: 13,
  tag_name: "v0.7.0",
  draft: false,
  prerelease: false,
  html_url: "https://github.com/davidahmann/mill/releases/tag/v0.7.0",
  published_at: publishedAt,
};

describe("bounded npm metadata and final channel readback", () => {
  it.each([
    { mode: "ready", expectedAttempts: 1, accepted: true },
    { mode: "http-transient", expectedAttempts: 3, accepted: true },
    { mode: "tag-transient", expectedAttempts: 3, accepted: true },
    { mode: "provenance-transient", expectedAttempts: 3, accepted: true },
    { mode: "late-propagation", expectedAttempts: 13, accepted: true },
    { mode: "integrity-conflict", expectedAttempts: 1, accepted: false },
    { mode: "version-conflict", expectedAttempts: 1, accepted: false },
    { mode: "unavailable", expectedAttempts: 3, accepted: false },
    { mode: "tag-conflict", expectedAttempts: 3, accepted: false },
  ])(
    "handles $mode without retrying publication",
    async ({ mode, expectedAttempts, accepted }) => {
      const temporary = await temporaryDirectory("mill-npm-metadata-");
      try {
        const file = (name: string) => path.join(temporary.path, name);
        await writeFile(file("metadata.json"), JSON.stringify(metadata));
        await writeFile(
          file("npm"),
          `#!/usr/bin/env node
const fs = require("node:fs");
if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(["view", "@davidahmann/mill@0.7.0", "version", "dist", "dist-tags", "--json", "--prefer-online"])) process.exit(9);
const mode = process.env.TEST_MODE;
const countFile = process.env.TEST_COUNT;
const count = fs.existsSync(countFile) ? Number(fs.readFileSync(countFile, "utf8")) + 1 : 1;
fs.writeFileSync(countFile, String(count));
if (mode === "unavailable" || (mode === "http-transient" && count < 3) || (mode === "late-propagation" && count < 13)) { process.stderr.write("npm error E404/503 propagation delay"); process.exit(1); }
const response = { version: "0.7.0", dist: { integrity: ${JSON.stringify(integrity)}, tarball: "https://registry.npmjs.org/@davidahmann/mill/-/mill-0.7.0.tgz", attestations: { url: "https://registry.npmjs.org/attestations", provenance: { predicateType: "https://slsa.dev/provenance/v1" } } }, "dist-tags": { latest: "0.7.0" } };
if (mode === "integrity-conflict") response.dist.integrity = "sha512-other";
if (mode === "version-conflict") response.version = "0.6.0";
if (mode === "tag-conflict" || (mode === "tag-transient" && count < 3)) response["dist-tags"].latest = "0.6.0";
if (mode === "provenance-transient" && count < 3) delete response.dist.attestations;
process.stdout.write(JSON.stringify(response));
`,
          { mode: 0o755 },
        );
        const environment = { ...process.env };
        if (mode === "late-propagation")
          delete environment.MILL_NPM_METADATA_ATTEMPTS;
        else environment.MILL_NPM_METADATA_ATTEMPTS = "3";
        const result = spawnSync(
          process.execPath,
          [
            metadataScript,
            file("metadata.json"),
            file("dist.json"),
            file("npm-observation.json"),
          ],
          {
            encoding: "utf8",
            timeout: 10_000,
            env: {
              ...environment,
              PATH: `${temporary.path}${path.delimiter}${process.env.PATH ?? ""}`,
              TEST_MODE: mode,
              TEST_COUNT: file("count"),
              MILL_NPM_METADATA_DELAY_MS: "0",
            },
          },
        );
        expect(result.status, result.stderr).toBe(accepted ? 0 : 1);
        expect(await readFile(file("count"), "utf8")).toBe(
          String(expectedAttempts),
        );
        if (accepted) {
          expect(
            JSON.parse(await readFile(file("dist.json"), "utf8")),
          ).toMatchObject({ integrity });
          expect(
            JSON.parse(await readFile(file("npm-observation.json"), "utf8")),
          ).toMatchObject({
            latestVersion: "0.7.0",
            observedAt: expect.any(String) as unknown,
          });
        } else {
          await expect(
            readFile(file("npm-observation.json")),
          ).rejects.toThrow();
          expect(result.stderr).toContain(
            expectedAttempts === 1
              ? "conflicts with the immutable qualified package identity"
              : "did not settle after 3 attempts",
          );
        }
      } finally {
        await temporary.cleanup();
      }
    },
  );

  it.each([
    "valid",
    "wrong-npm",
    "stale-npm",
    "wrong-id",
    "wrong-tag",
    "draft",
    "prerelease",
    "wrong-origin",
  ])("validates %s final channel observations", async (mutation) => {
    const temporary = await temporaryDirectory("mill-release-channels-");
    try {
      const file = (name: string) => path.join(temporary.path, name);
      const npm = {
        latestVersion: mutation === "wrong-npm" ? "0.6.0" : "0.7.0",
        observedAt:
          mutation === "stale-npm"
            ? "2019-01-01T00:00:00Z"
            : new Date().toISOString(),
      };
      const latest = {
        ...githubLatest,
        ...(mutation === "wrong-id" ? { id: 14 } : {}),
        ...(mutation === "wrong-tag" ? { tag_name: "v0.6.0" } : {}),
        ...(mutation === "draft" ? { draft: true } : {}),
        ...(mutation === "prerelease" ? { prerelease: true } : {}),
        ...(mutation === "wrong-origin"
          ? {
              html_url:
                "https://example.com/davidahmann/mill/releases/tag/v0.7.0",
            }
          : {}),
      };
      for (const [name, value] of Object.entries({
        "metadata.json": metadata,
        "npm.json": npm,
        "latest.json": latest,
        "release.json": githubRelease,
      })) {
        await writeFile(file(name), JSON.stringify(value));
      }
      const result = spawnSync(
        process.execPath,
        [
          channelsScript,
          file("metadata.json"),
          file("npm.json"),
          file("latest.json"),
          file("release.json"),
          file("channels.json"),
        ],
        { encoding: "utf8", timeout: 10_000 },
      );
      expect(result.status, result.stderr).toBe(mutation === "valid" ? 0 : 1);
      if (mutation === "valid") {
        expect(
          JSON.parse(await readFile(file("channels.json"), "utf8")),
        ).toMatchObject({
          npm,
          github: {
            releaseId: "13",
            tag: "v0.7.0",
            observedAt: expect.any(String) as unknown,
          },
        });
      } else {
        await expect(readFile(file("channels.json"))).rejects.toThrow();
      }
    } finally {
      await temporary.cleanup();
    }
  });
});
