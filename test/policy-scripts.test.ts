import { createHash } from "node:crypto";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { temporaryDirectory } from "./helpers.js";

const dcoScript = path.resolve("scripts/check-dco.mjs");
const workflowScript = path.resolve("scripts/check-workflows.mjs");
const compareArtifactsScript = path.resolve(
  "scripts/compare-release-artifacts.mjs",
);
const releaseTagScript = path.resolve("scripts/verify-release-tag.mjs");
const releaseReadbackScript = path.resolve(
  "scripts/capture-release-readback.mjs",
);
const qualifyReleaseArtifactScript = path.resolve(
  "scripts/qualify-release-artifact.mjs",
);
const artifactMetadataSchema = z.object({
  builders: z.array(z.object({ contentsDigest: z.string() })).length(2),
  selectedArtifact: z.object({ filename: z.string() }),
});

function run(
  executable: string,
  arguments_: readonly string[],
  cwd: string,
  extraEnvironment: NodeJS.ProcessEnv = {},
): { status: number | null; stderr: string; stdout: string } {
  const result = spawnSync(executable, arguments_, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_OPTIONAL_LOCKS: "0",
      ...extraEnvironment,
    },
    timeout: 10_000,
  });
  return {
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

function git(arguments_: readonly string[], cwd: string): string {
  const result = run("/usr/bin/git", arguments_, cwd);
  if (result.status !== 0) {
    throw new Error(`git ${arguments_.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

describe("repository policy scripts", () => {
  it("accepts an author-matching DCO sign-off and rejects a foreign one", async () => {
    const temporary = await temporaryDirectory("mill-dco-");
    try {
      git(["init", "--quiet"], temporary.path);
      git(["config", "user.name", "Alice"], temporary.path);
      git(["config", "user.email", "alice@example.com"], temporary.path);
      await writeFile(path.join(temporary.path, "fixture.txt"), "base\n");
      git(["add", "fixture.txt"], temporary.path);
      git(
        [
          "commit",
          "--quiet",
          "-m",
          "base",
          "-m",
          "Signed-off-by: Alice <alice@example.com>",
        ],
        temporary.path,
      );
      const base = git(["rev-parse", "HEAD"], temporary.path);

      await writeFile(path.join(temporary.path, "fixture.txt"), "signed\n");
      git(["add", "fixture.txt"], temporary.path);
      git(
        [
          "commit",
          "--quiet",
          "-m",
          "signed",
          "-m",
          "Signed-off-by: Alice <alice@example.com>",
        ],
        temporary.path,
      );
      const signedHead = git(["rev-parse", "HEAD"], temporary.path);
      const signed = run(
        process.execPath,
        [dcoScript, base, signedHead],
        temporary.path,
      );
      expect(signed.status, signed.stderr).toBe(0);
      expect(signed.stdout).toContain("DCO check passed for 1 commit(s)");

      await writeFile(path.join(temporary.path, "fixture.txt"), "foreign\n");
      git(["add", "fixture.txt"], temporary.path);
      git(
        [
          "commit",
          "--quiet",
          "-m",
          "foreign",
          "-m",
          "Signed-off-by: Mallory <mallory@example.com>",
        ],
        temporary.path,
      );
      const foreignHead = git(["rev-parse", "HEAD"], temporary.path);
      const foreign = run(
        process.execPath,
        [dcoScript, signedHead, foreignHead],
        temporary.path,
      );
      expect(foreign.status).toBe(1);
      expect(foreign.stderr).toContain("DCO sign-off missing");
    } finally {
      await temporary.cleanup();
    }
  });

  it("requires a timeout on every workflow job", async () => {
    const temporary = await temporaryDirectory("mill-workflow-policy-");
    try {
      await mkdir(path.join(temporary.path, ".github", "workflows"), {
        recursive: true,
      });
      await writeFile(
        path.join(temporary.path, ".github", "workflows", "ci.yml"),
        [
          "name: CI",
          "on: [push]",
          "permissions:",
          "  contents: read",
          "concurrency:",
          "  group: ci",
          "jobs:",
          "  bounded:",
          "    runs-on: ubuntu-24.04",
          "    timeout-minutes: 5",
          "    steps:",
          "      - run: echo bounded",
          "  unbounded:",
          "    runs-on: ubuntu-24.04",
          "    steps:",
          "      - run: echo unbounded",
          "",
        ].join("\n"),
      );
      const result = run(process.execPath, [workflowScript], temporary.path);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        "ci.yml: job unbounded must declare timeout-minutes",
      );
    } finally {
      await temporary.cleanup();
    }
  });

  it("rejects malformed release-qualification arguments before execution", () => {
    const missingValue = run(
      process.execPath,
      [qualifyReleaseArtifactScript, "candidate.tgz", "--report-output"],
      process.cwd(),
    );
    expect(missingValue.status).toBe(1);
    expect(missingValue.stderr).toContain("--report-output requires a path");

    const unsupported = run(
      process.execPath,
      [qualifyReleaseArtifactScript, "candidate.tgz", "--publish"],
      process.cwd(),
    );
    expect(unsupported.status).toBe(1);
    expect(unsupported.stderr).toContain("unsupported argument: --publish");
  });

  it("compares canonical package contents and preserves one exact artifact", async () => {
    const temporary = await temporaryDirectory("mill-release-artifacts-");
    try {
      const packageRoot = path.join(temporary.path, "source", "package");
      const output = path.join(temporary.path, "qualified");
      await mkdir(packageRoot, { recursive: true });
      await writeFile(
        path.join(packageRoot, "package.json"),
        `${JSON.stringify({ name: "@davidahmann/mill", version: "0.1.0" })}\n`,
      );
      await writeFile(path.join(packageRoot, "index.js"), "export {};\n");
      const first = path.join(temporary.path, "first.tgz");
      const second = path.join(temporary.path, "second.tgz");
      for (const destination of [first, second]) {
        const archived = run(
          "/usr/bin/tar",
          ["-czf", destination, "package"],
          path.join(temporary.path, "source"),
        );
        expect(archived.status, archived.stderr).toBe(0);
      }
      const compared = run(
        process.execPath,
        [compareArtifactsScript, first, second, output],
        temporary.path,
      );
      expect(compared.status, compared.stderr).toBe(0);
      const metadata = artifactMetadataSchema.parse(
        JSON.parse(
          await readFile(path.join(output, "artifact-metadata.json"), "utf8"),
        ),
      );
      expect(metadata.builders).toHaveLength(2);
      const [firstBuilder, secondBuilder] = metadata.builders;
      if (firstBuilder === undefined || secondBuilder === undefined) {
        throw new Error("artifact metadata has fewer than two builders");
      }
      expect(firstBuilder.contentsDigest).toBe(secondBuilder.contentsDigest);
      expect(metadata.selectedArtifact.filename).toBe("first.tgz");

      await writeFile(
        path.join(packageRoot, "index.js"),
        "export const drift = true;\n",
      );
      const repacked = run(
        "/usr/bin/tar",
        ["-czf", second, "package"],
        path.join(temporary.path, "source"),
      );
      expect(repacked.status, repacked.stderr).toBe(0);
      const mismatched = run(
        process.execPath,
        [
          compareArtifactsScript,
          first,
          second,
          path.join(temporary.path, "mismatched"),
        ],
        temporary.path,
      );
      expect(mismatched.status).toBe(1);
      expect(mismatched.stderr).toContain("identical canonical contents");
    } finally {
      await temporary.cleanup();
    }
  });

  it("rejects linked archive entries before writing an output artifact", async () => {
    const temporary = await temporaryDirectory("mill-release-link-");
    try {
      const packageRoot = path.join(temporary.path, "source", "package");
      await mkdir(packageRoot, { recursive: true });
      await writeFile(
        path.join(packageRoot, "package.json"),
        `${JSON.stringify({ name: "@davidahmann/mill", version: "0.1.0" })}\n`,
      );
      await symlink("../../outside", path.join(packageRoot, "escape"));
      const linked = path.join(temporary.path, "linked.tgz");
      const archived = run(
        "/usr/bin/tar",
        ["-czf", linked, "package"],
        path.join(temporary.path, "source"),
      );
      expect(archived.status, archived.stderr).toBe(0);
      const compared = run(
        process.execPath,
        [
          compareArtifactsScript,
          linked,
          linked,
          path.join(temporary.path, "qualified"),
        ],
        temporary.path,
      );
      expect(compared.status).toBe(1);
      expect(compared.stderr).toContain("unsupported artifact entry type");
    } finally {
      await temporary.cleanup();
    }
  });

  it("requires an annotated exact-tree release tag", async () => {
    const temporary = await temporaryDirectory("mill-release-tag-");
    try {
      git(["init", "--quiet", "--initial-branch=main"], temporary.path);
      git(["config", "user.name", "Release Test"], temporary.path);
      git(["config", "user.email", "release@example.invalid"], temporary.path);
      await writeFile(
        path.join(temporary.path, "package.json"),
        `${JSON.stringify({ name: "@davidahmann/mill", version: "0.1.0" })}\n`,
      );
      git(["add", "package.json"], temporary.path);
      git(
        [
          "commit",
          "--quiet",
          "-m",
          "release: v0.1.0",
          "-m",
          "Signed-off-by: Release Test <release@example.invalid>",
        ],
        temporary.path,
      );
      const commit = git(["rev-parse", "HEAD"], temporary.path);
      const tree = git(["rev-parse", "HEAD^{tree}"], temporary.path);
      git(["update-ref", "refs/remotes/origin/main", commit], temporary.path);
      git(["tag", "v0.1.0"], temporary.path);
      const lightweight = run(
        process.execPath,
        [releaseTagScript],
        temporary.path,
        {
          MILL_RELEASE_TAG: "v0.1.0",
          GITHUB_SHA: commit,
        },
      );
      expect(lightweight.status).toBe(1);
      expect(lightweight.stderr).toContain("requires an annotated tag");
      git(["tag", "--delete", "v0.1.0"], temporary.path);
      git(
        [
          "tag",
          "-a",
          "v0.1.0",
          "-m",
          `Mill v0.1.0\n\nReviewed-Candidate-Tree: ${tree}`,
        ],
        temporary.path,
      );
      const result = run(process.execPath, [releaseTagScript], temporary.path, {
        MILL_RELEASE_TAG: "v0.1.0",
        GITHUB_SHA: commit,
      });
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        tag: "v0.1.0",
        tagCommit: commit,
        mainTree: tree,
        reviewedCandidateTree: tree,
      });
    } finally {
      await temporary.cleanup();
    }
  });

  it("binds npm provenance and downloaded GitHub release bytes", async () => {
    const temporary = await temporaryDirectory("mill-release-readback-");
    try {
      const artifact = Buffer.from("qualified artifact");
      const artifactDigest = `sha256:${createHash("sha256")
        .update(artifact)
        .digest("hex")}`;
      const integrity = `sha512-${Buffer.alloc(64).toString("base64")}`;
      const metadata = path.join(temporary.path, "metadata.json");
      const registry = path.join(temporary.path, "registry.json");
      const release = path.join(temporary.path, "release.json");
      const downloaded = path.join(
        temporary.path,
        "davidahmann-mill-0.1.0.tgz",
      );
      await Promise.all([
        writeFile(
          metadata,
          JSON.stringify({
            package: { name: "@davidahmann/mill", version: "0.1.0" },
            selectedArtifact: {
              filename: path.basename(downloaded),
              sha256: artifactDigest,
              npmIntegrity: integrity,
            },
          }),
        ),
        writeFile(
          registry,
          JSON.stringify({
            tarball:
              "https://registry.npmjs.org/@davidahmann/mill/-/mill-0.1.0.tgz",
            integrity,
            attestations: {
              url: "https://registry.npmjs.org/-/npm/v1/attestations/@davidahmann/mill@0.1.0",
              provenance: {
                predicateType: "https://slsa.dev/provenance/v1",
              },
            },
          }),
        ),
        writeFile(
          release,
          JSON.stringify({
            url: "https://github.com/davidahmann/mill/releases/tag/v0.1.0",
            tagName: "v0.1.0",
            assets: [{ name: path.basename(downloaded) }],
          }),
        ),
        writeFile(downloaded, artifact),
      ]);
      const registryOutput = path.join(temporary.path, "registry-output.json");
      const githubOutput = path.join(temporary.path, "github-output.json");
      const result = run(
        process.execPath,
        [
          releaseReadbackScript,
          metadata,
          registry,
          release,
          downloaded,
          registryOutput,
          githubOutput,
        ],
        temporary.path,
      );
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(await readFile(registryOutput, "utf8"))).toMatchObject({
        integrity,
        provenanceVerified: true,
      });
      expect(JSON.parse(await readFile(githubOutput, "utf8"))).toMatchObject({
        tag: "v0.1.0",
        artifactDigest,
      });
    } finally {
      await temporary.cleanup();
    }
  });
});
