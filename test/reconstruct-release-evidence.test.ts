import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { canonicalDigest } from "../src/contracts/canonical.js";
import { temporaryDirectory } from "./helpers.js";

const script = path.resolve("scripts/reconstruct-release-evidence.mjs");
const hex = (character: string) => character.repeat(40);
const sha256 = (value: Buffer | string) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

function run(
  directory: string,
  draft = "release-evidence-draft.json",
  final = "release-evidence-final.json",
) {
  return spawnSync(process.execPath, [script, directory, draft, final], {
    cwd: directory,
    encoding: "utf8",
    timeout: 10_000,
  });
}

describe("permanent release evidence reconstruction", () => {
  it("reconstructs retained draft and published evidence and rejects missing, swapped, or mismatched assets", async () => {
    const temporary = await temporaryDirectory("mill-release-reconstruct-");
    try {
      const assets = path.join(temporary.path, "assets");
      await mkdir(assets);
      const artifact = Buffer.from("qualified artifact\n");
      const artifactDigest = sha256(artifact);
      const digest = sha256("fixture");
      const integrity = `sha512-${Buffer.alloc(64).toString("base64")}`;
      const supportTuple = {
        id: "darwin-arm64-node24-codex",
        status: "qualified",
        testedAt: "2026-09-16T00:00:00.000Z",
        expiresAt: "2026-10-16T00:00:00.000Z",
        host: { os: "darwin", architecture: "arm64" },
        runtime: { node: "24.20.0", npm: "11.19.0" },
        container: {
          engine: "docker",
          version: "29.7.2",
          verifierImage: `image@${digest}`,
        },
        worker: {
          adapter: "codex-cli",
          harnessVersion: "0.153.0-alpha.5",
          modelIdentity: "provider-mutable",
          authMode: "operator-session",
        },
        forge: {
          gitVersion: "2.50.1",
          ghVersion: "2.74.2",
          host: "github.com",
        },
        recipe: { id: "node-typescript-next-web", version: "1.0.0", digest },
      } as const;
      const qualification = {
        schemaVersion: "1",
        package: {
          name: "@davidahmann/mill",
          version: "0.7.0",
          artifactDigest,
          npmIntegrity: integrity,
        },
        supportTuple,
        sequence: {
          steps: ["1", "2", "3", "4", "5"].map((id, index) => ({
            id: `step-${id}`,
            dependsOn: index === 0 ? [] : [`step-${index}`],
            baseCommit: hex(String(index + 1)),
            candidateCommit: hex(String(index + 2)),
            status: "accepted",
            newBehavior: { requiredIds: [`A-${id}`], passedIds: [`A-${id}`] },
            preservation: { requiredIds: ["INV-1"], passedIds: ["INV-1"] },
            scenarioIds: [`SCN-${id}`],
            usage: {
              inputTokens: null,
              outputTokens: null,
              currencyCost: null,
              source: "unavailable",
            },
          })),
          seededFault: {
            baseCommit: hex("6"),
            candidateCommit: hex("f"),
            status: "failed",
            rejected: true,
            recovered: true,
            enteredAcceptedSequence: false,
            reason: "independent preservation check rejected the fixture",
          },
        },
        canaries: {
          packedInstall: "passed",
          greenfield: "passed",
          adoption: "passed",
          downstreamWithoutMill: "passed",
          recovery: "passed",
          security: "passed",
        },
        auditCandidate: { commit: hex("7"), tree: hex("8") },
        audits: [
          "product",
          "code",
          "ux",
          "accessibility",
          "security",
          "dependencies",
          "architecture",
          "operations",
          "release",
        ].map((category) => ({
          category,
          status: "passed",
          reportDigest: digest,
        })),
        generatedAt: "2026-09-16T00:00:00.000Z",
      } as const;
      const identity = {
        reviewedCandidateTree: hex("a"),
        tagCommit: hex("b"),
        mainTree: hex("a"),
      };
      const builder = {
        builder: "build-a",
        filename: "davidahmann-mill-0.7.0.tgz",
        sha256: artifactDigest,
        npmIntegrity: integrity,
        contentsDigest: digest,
      };
      const metadata = {
        package: { name: "@davidahmann/mill", version: "0.7.0" },
        builders: [builder, { ...builder, builder: "build-b" }],
        selectedArtifact: builder,
      };
      const evidence = (state: "draft" | "published") => ({
        schemaVersion: "1",
        state: "verified",
        package: { name: "@davidahmann/mill", version: "0.7.0", tag: "v0.7.0" },
        source: {
          reviewedCandidateTree: identity.reviewedCandidateTree,
          resultingMainCommit: identity.tagCommit,
          resultingMainTree: identity.mainTree,
          tagCommit: identity.tagCommit,
        },
        builders: metadata.builders,
        selectedArtifact: metadata.selectedArtifact,
        qualificationDigest: canonicalDigest(qualification),
        qualification: {
          supportTuple: {
            id: supportTuple.id,
            status: supportTuple.status,
            testedAt: supportTuple.testedAt,
            expiresAt: supportTuple.expiresAt,
            digest: canonicalDigest(supportTuple),
          },
        },
        sbomDigest: sha256("sbom\n"),
        workflowRuns: {
          candidate: {
            id: "11",
            url: "https://github.com/davidahmann/mill/actions/runs/11",
            headCommit: identity.tagCommit,
          },
          publish: {
            id: "12",
            url: "https://github.com/davidahmann/mill/actions/runs/12",
            headCommit: identity.tagCommit,
          },
        },
        registry: {
          tarball:
            "https://registry.npmjs.org/@davidahmann/mill/-/mill-0.7.0.tgz",
          integrity,
          provenanceVerified: true,
        },
        githubRelease: {
          url: "https://github.com/davidahmann/mill/releases/tag/v0.7.0",
          tag: "v0.7.0",
          artifactDigest,
          state,
          releaseId: "13",
          publishedAt: state === "draft" ? null : "2026-09-16T00:01:00.000Z",
          observedAt: "2026-09-16T00:01:00.000Z",
        },
        generatedAt: "2026-09-16T00:01:00.000Z",
      });
      await Promise.all([
        writeFile(
          path.join(assets, metadata.selectedArtifact.filename),
          artifact,
        ),
        writeFile(
          path.join(assets, "artifact-metadata.json"),
          JSON.stringify(metadata),
        ),
        writeFile(
          path.join(assets, "qualification.json"),
          JSON.stringify(qualification),
        ),
        writeFile(path.join(assets, "identity.json"), JSON.stringify(identity)),
        writeFile(path.join(assets, "sbom.cdx.json"), "sbom\n"),
        writeFile(
          path.join(assets, "release-evidence-draft.json"),
          JSON.stringify(evidence("draft")),
        ),
        writeFile(
          path.join(assets, "release-evidence-final.json"),
          JSON.stringify(evidence("published")),
        ),
      ]);

      expect(run(assets).status).toBe(0);

      await rm(path.join(assets, "qualification.json"));
      expect(run(assets).status).toBe(1);
      await writeFile(
        path.join(assets, "qualification.json"),
        JSON.stringify(qualification),
      );

      const draft = await readFile(
        path.join(assets, "release-evidence-draft.json"),
        "utf8",
      );
      const final = await readFile(
        path.join(assets, "release-evidence-final.json"),
        "utf8",
      );
      await writeFile(path.join(assets, "release-evidence-draft.json"), final);
      expect(run(assets).status).toBe(1);
      await writeFile(path.join(assets, "release-evidence-draft.json"), draft);

      const mismatched = {
        ...qualification,
        supportTuple: { ...supportTuple, status: "expired" },
      };
      await writeFile(
        path.join(assets, "qualification.json"),
        JSON.stringify(mismatched),
      );
      expect(run(assets).status).toBe(1);
    } finally {
      await temporary.cleanup();
    }
  });
});
