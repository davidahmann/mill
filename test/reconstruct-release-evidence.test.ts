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
  // Each adversarial case starts a fresh CLI; keep the per-process bound above
  // and allow the complete matrix to finish on shared CI runners.
  it("reconstructs retained draft and published evidence and rejects missing, swapped, or mismatched assets", async () => {
    const temporary = await temporaryDirectory("mill-release-reconstruct-");
    try {
      const assets = path.join(temporary.path, "assets");
      await mkdir(assets);
      const artifact = Buffer.from("qualified artifact\n");
      const artifactDigest = sha256(artifact);
      const digest = sha256("fixture");
      const integrity = `sha512-${createHash("sha512").update(artifact).digest("base64")}`;
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
        auditCandidate: { commit: hex("b"), tree: hex("a") },
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
        packageName: "@davidahmann/mill",
        version: "0.7.0",
        tag: "v0.7.0",
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

      const channels = {
        npm: { latestVersion: "0.7.0", observedAt: "2026-09-16T00:01:00.000Z" },
        github: {
          releaseId: "13",
          tag: "v0.7.0",
          observedAt: "2026-09-16T00:01:00.000Z",
        },
      };
      const replaceAssets = async (overrides: Record<string, unknown>) => {
        const documents = {
          "artifact-metadata.json": metadata,
          "qualification.json": qualification,
          "identity.json": identity,
          "release-evidence-draft.json": evidence("draft"),
          "release-evidence-final.json": evidence("published"),
          ...overrides,
        };
        await Promise.all(
          Object.entries(documents).map(([name, value]) =>
            writeFile(path.join(assets, name), JSON.stringify(value)),
          ),
        );
      };
      await replaceAssets({
        "release-evidence-final.json": { ...evidence("published"), channels },
      });
      expect(run(assets).status).toBe(0);
      await Promise.all(
        Object.entries({
          "channels.json": channels,
          "registry.json": evidence("published").registry,
          "github.json": evidence("published").githubRelease,
          "workflow-runs.json": evidence("published").workflowRuns,
        }).map(([name, value]) =>
          writeFile(path.join(assets, name), JSON.stringify(value)),
        ),
      );
      const assemble = (name: string, withChannels: boolean) =>
        spawnSync(
          process.execPath,
          [
            path.resolve("scripts/assemble-release-evidence.mjs"),
            ...[
              "artifact-metadata.json",
              "qualification.json",
              "sbom.cdx.json",
              "identity.json",
              name,
              "registry.json",
              "github.json",
              "workflow-runs.json",
              ...(withChannels ? ["channels.json"] : []),
            ].map((file) => path.join(assets, file)),
          ],
          { encoding: "utf8", timeout: 10_000 },
        );
      const assembled = assemble("assembled-final.json", true);
      expect(assembled.status, assembled.stderr).toBe(0);
      expect(
        JSON.parse(
          await readFile(path.join(assets, "assembled-final.json"), "utf8"),
        ),
      ).toMatchObject({ channels });
      expect(assemble("assembled-legacy.json", false).status).toBe(0);
      await writeFile(
        path.join(assets, "channels.json"),
        JSON.stringify({
          ...channels,
          npm: { ...channels.npm, latestVersion: "0.6.0" },
        }),
      );
      expect(assemble("assembled-wrong-channel.json", true).status).toBe(1);
      await expect(
        readFile(path.join(assets, "assembled-wrong-channel.json")),
      ).rejects.toThrow();
      for (const [name, changedChannels] of Object.entries({
        "wrong npm latest": {
          ...channels,
          npm: { ...channels.npm, latestVersion: "0.6.0" },
        },
        "wrong GitHub Latest": {
          ...channels,
          github: { ...channels.github, releaseId: "14" },
        },
        "wrong Latest tag": {
          ...channels,
          github: { ...channels.github, tag: "v0.6.0" },
        },
        "stale observation": {
          ...channels,
          npm: { ...channels.npm, observedAt: "2026-09-16T00:00:00.000Z" },
        },
        "future observation": {
          ...channels,
          github: {
            ...channels.github,
            observedAt: "2026-09-17T00:01:00.000Z",
          },
        },
      })) {
        await replaceAssets({
          "release-evidence-final.json": {
            ...evidence("published"),
            channels: changedChannels,
          },
        });
        expect(run(assets).status, name).toBe(1);
      }
      await replaceAssets({
        "release-evidence-draft.json": { ...evidence("draft"), channels },
      });
      expect(run(assets).status, "draft cannot prove final channels").toBe(1);

      // Keep the duplicated evidence internally consistent: each failure must
      // come from a cross-document binding, not merely a changed digest.
      for (const changedQualification of [
        {
          ...qualification,
          canaries: { ...qualification.canaries, security: "failed" },
        },
        {
          ...qualification,
          sequence: {
            ...qualification.sequence,
            steps: qualification.sequence.steps.map((step, index) =>
              index === 0
                ? {
                    ...step,
                    newBehavior: { ...step.newBehavior, passedIds: [] },
                  }
                : step,
            ),
          },
        },
        {
          ...qualification,
          package: { ...qualification.package, version: "0.6.0" },
        },
        {
          ...qualification,
          package: { ...qualification.package, artifactDigest: digest },
        },
        {
          ...qualification,
          package: {
            ...qualification.package,
            npmIntegrity: `sha512-${Buffer.alloc(64).toString("base64")}`,
          },
        },
        {
          ...qualification,
          auditCandidate: { commit: hex("7"), tree: hex("a") },
        },
        {
          ...qualification,
          auditCandidate: { commit: hex("b"), tree: hex("8") },
        },
      ]) {
        await replaceAssets({
          "qualification.json": changedQualification,
          "release-evidence-draft.json": {
            ...evidence("draft"),
            qualificationDigest: canonicalDigest(changedQualification),
          },
          "release-evidence-final.json": {
            ...evidence("published"),
            qualificationDigest: canonicalDigest(changedQualification),
          },
        });
        expect(
          run(assets).status,
          JSON.stringify(changedQualification.package),
        ).toBe(1);
      }
      for (const changedMetadata of [
        { ...metadata, builders: [builder, builder] },
        {
          ...metadata,
          builders: [
            builder,
            {
              ...builder,
              builder: "build-b",
              contentsDigest: sha256("different contents"),
            },
          ],
        },
        {
          ...metadata,
          selectedArtifact: { ...builder, builder: "unrelated-builder" },
        },
      ]) {
        const { builders, selectedArtifact } = changedMetadata;
        await replaceAssets({
          "artifact-metadata.json": changedMetadata,
          "release-evidence-draft.json": {
            ...evidence("draft"),
            builders,
            selectedArtifact,
          },
          "release-evidence-final.json": {
            ...evidence("published"),
            builders,
            selectedArtifact,
          },
        });
        expect(
          run(assets).status,
          "builder independence and selected membership",
        ).toBe(1);
      }
      for (const registry of [
        null,
        { ...evidence("published").registry, provenanceVerified: false },
        {
          ...evidence("published").registry,
          integrity: `sha512-${Buffer.alloc(64).toString("base64")}`,
        },
      ]) {
        await replaceAssets({
          "release-evidence-draft.json": { ...evidence("draft"), registry },
          "release-evidence-final.json": { ...evidence("published"), registry },
        });
        expect(
          run(assets).status,
          "equal registry receipts still require provenance and identity",
        ).toBe(1);
      }
      await replaceAssets({
        "identity.json": { ...identity, reviewedCandidateTree: hex("c") },
        ...Object.fromEntries(
          (["draft", "published"] as const).map((state) => [
            state === "draft"
              ? "release-evidence-draft.json"
              : "release-evidence-final.json",
            {
              ...evidence(state),
              source: {
                ...evidence(state).source,
                reviewedCandidateTree: hex("c"),
              },
            },
          ]),
        ),
      });
      expect(run(assets).status, "source must preserve the reviewed tree").toBe(
        1,
      );
      for (const field of ["packageName", "version", "tag"] as const) {
        await replaceAssets({
          "identity.json": { ...identity, [field]: "wrong" },
        });
        expect(run(assets).status, `source ${field}`).toBe(1);
      }
      await replaceAssets({
        "release-evidence-final.json": {
          ...evidence("published"),
          githubRelease: {
            ...evidence("published").githubRelease,
            url: "https://example.com/davidahmann/mill/releases/tag/v0.7.0",
          },
        },
      });
      expect(run(assets).status, "GitHub receipt origin").toBe(1);

      // A historically qualified tuple may be expired at reconstruction time.
      const historicalTuple = {
        ...supportTuple,
        testedAt: "2020-01-01T00:00:00.000Z",
        expiresAt: "2020-02-01T00:00:00.000Z",
      };
      const historicalQualification = {
        ...qualification,
        supportTuple: historicalTuple,
        generatedAt: "2020-01-02T00:00:00.000Z",
      };
      await replaceAssets({
        "qualification.json": historicalQualification,
        ...Object.fromEntries(
          (["draft", "published"] as const).map((state) => [
            state === "draft"
              ? "release-evidence-draft.json"
              : "release-evidence-final.json",
            {
              ...evidence(state),
              qualificationDigest: canonicalDigest(historicalQualification),
              qualification: {
                supportTuple: {
                  ...evidence(state).qualification.supportTuple,
                  testedAt: historicalTuple.testedAt,
                  expiresAt: historicalTuple.expiresAt,
                  digest: canonicalDigest(historicalTuple),
                },
              },
            },
          ]),
        ),
      });
      expect(
        run(assets).status,
        "historical support tuple does not expire retained evidence",
      ).toBe(0);
      await replaceAssets({});

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

      const parsedFinal = JSON.parse(final) as unknown as {
        githubRelease: { releaseId: string };
      };
      const mismatchedRelease = {
        ...parsedFinal,
        githubRelease: {
          ...parsedFinal.githubRelease,
          releaseId: "unexpected-release",
        },
      };
      await writeFile(
        path.join(assets, "release-evidence-final.json"),
        JSON.stringify(mismatchedRelease),
      );
      expect(run(assets).status).toBe(1);
      await writeFile(path.join(assets, "release-evidence-final.json"), final);

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
  }, 60_000);
});
