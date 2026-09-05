import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { textDigest } from "../src/runtime/inputs.js";
import { temporaryDirectory } from "./helpers.js";

const execute = promisify(execFile);
const script = path.resolve("scripts/verify-independent-release.mjs");

describe("independent release publication gate", () => {
  it("requires exact pinned verifier, preserved bytes and authoritative successful run jobs", async () => {
    const temporary = await temporaryDirectory("mill-independent-release-");
    const file = (name: string) => path.join(temporary.path, name);
    const run = {
      id: 42,
      conclusion: "success",
      event: "workflow_dispatch",
      path: ".github/workflows/release.yml",
      head_sha: "a".repeat(40),
      repository: { full_name: "example/mill" },
    };
    const jobs = [
      {
        jobs: [
          "build-a",
          "build-b",
          "qualify-candidate",
          "independent-release-policy",
        ].map((name) => ({
          name,
          run_id: run.id,
          head_sha: run.head_sha,
          conclusion: "success",
        })),
      },
    ];
    const receipt = {
      schemaVersion: "1",
      verifierCommit: "c547762d7644f62ac48011089564f5f46a48b786",
      artifactDigest: textDigest("preserved artifact"),
      qualificationDigest: textDigest("qualification"),
    };
    const invoke = () =>
      execute(
        process.execPath,
        [
          script,
          temporary.path,
          file("receipt.json"),
          file("run.json"),
          file("jobs.json"),
          file("identity.json"),
        ],
        {
          env: { ...process.env, GITHUB_REPOSITORY: "example/mill" },
        },
      );
    const json = (name: string, value: unknown) =>
      writeFile(file(name), JSON.stringify(value));
    try {
      await writeFile(file("mill.tgz"), "preserved artifact");
      await writeFile(file("qualification.json"), "qualification");
      await json("receipt.json", receipt);
      await json("run.json", run);
      const page = jobs[0];
      if (page === undefined) throw new Error("missing job fixture");
      await json("jobs.json", jobs);
      await json("identity.json", { tagCommit: run.head_sha });
      expect((await invoke()).stdout).toContain("verified");
      for (const mutation of [
        { verifierCommit: "b".repeat(40) },
        { artifactDigest: textDigest("different") },
        { qualificationDigest: textDigest("different") },
      ]) {
        await json("receipt.json", { ...receipt, ...mutation });
        await expect(invoke()).rejects.toThrow("artifact binding mismatch");
      }
      await json("receipt.json", receipt);
      for (const mutation of [
        { conclusion: "failure" },
        { event: "push" },
        { head_sha: "b".repeat(40) },
        { path: "foreign.yml" },
        { repository: { full_name: "foreign/mill" } },
      ]) {
        await json("run.json", { ...run, ...mutation });
        await expect(invoke()).rejects.toThrow("exact-tag release workflow");
      }
      await json("run.json", run);
      for (const mutation of [
        { conclusion: "skipped" },
        { run_id: 99 },
        { head_sha: "b".repeat(40) },
      ]) {
        await json("jobs.json", [
          {
            jobs: page.jobs.map((job) =>
              job.name === "independent-release-policy"
                ? { ...job, ...mutation }
                : job,
            ),
          },
        ]);
        await expect(invoke()).rejects.toThrow("exact-run job");
      }
      await json("jobs.json", [{ jobs: [...page.jobs, page.jobs[0]] }]);
      await expect(invoke()).rejects.toThrow("exact-run job");
      await writeFile(file("second.tgz"), "another artifact");
      await expect(invoke()).rejects.toThrow("exactly one preserved tarball");
    } finally {
      await temporary.cleanup();
    }
  });
});
