import { execFile } from "node:child_process";
import {
  mkdir,
  readFile,
  rmdir,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { temporaryDirectory } from "./helpers.js";

const execute = promisify(execFile);
const checker = path.resolve("scripts/check-workflows.mjs");
const source = path.resolve(".github/workflows/release.yml");
interface Step {
  name?: string;
  id?: string;
  run?: string;
  uses?: string;
  env?: Record<string, string>;
  with?: Record<string, string | number | boolean>;
  if?: string;
  "continue-on-error"?: boolean;
}
interface Workflow {
  jobs: Record<string, { steps: Step[] }>;
}
async function fixture() {
  return parse(await readFile(source, "utf8")) as Workflow;
}
async function check(workflow: Workflow) {
  const temporary = await temporaryDirectory("mill-release-workflow-");
  try {
    const directory = path.join(temporary.path, ".github/workflows");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "release.yml"), stringify(workflow));
    return await execute(process.execPath, [checker], { cwd: temporary.path });
  } finally {
    await temporary.cleanup();
  }
}

describe("release verifier preparation policy", () => {
  it("accepts the complete checked-in release workflow", async () => {
    expect((await check(await fixture())).stdout).toContain(
      "workflow contract passed",
    );
  });
  it.each(["qualify", "independent-policy", "publish"])(
    "rejects %s without explicit verifier preparation",
    async (jobId) => {
      const workflow = await fixture();
      const job = workflow.jobs[jobId];
      if (!job) throw new Error("missing release fixture job");
      job.steps = job.steps.filter(
        (step) => !step.run?.includes("docker pull"),
      );
      await expect(check(workflow)).rejects.toThrow("verifier preparation");
    },
  );
  it("rejects a candidate builder without tag-bound release notes", async () => {
    const workflow = await fixture();
    const job = workflow.jobs.build;
    if (!job) throw new Error("missing release fixture job");
    job.steps = job.steps.filter((step) => step.id !== "require-release-notes");
    await expect(check(workflow)).rejects.toThrow("tag-bound release notes");
  });
  it.each([
    "hard-coded-tag",
    "conditional",
    "ignored",
    "moved",
    "intervening-step",
  ])("rejects a %s release-notes check", async (mutation) => {
    const workflow = await fixture();
    const job = workflow.jobs.build;
    const index =
      job?.steps.findIndex((step) => step.id === "require-release-notes") ?? -1;
    const step = job?.steps[index];
    if (!job || !step || index < 0)
      throw new Error("missing release-notes fixture");
    if (mutation === "hard-coded-tag") {
      step.env = { RELEASE_TAG: "v0.3.0" };
    } else if (mutation === "conditional") {
      step.if = "false";
    } else if (mutation === "ignored") {
      step["continue-on-error"] = true;
    } else if (mutation === "moved") {
      job.steps.push(...job.steps.splice(index, 1));
    } else {
      job.steps.splice(1, 0, {
        name: "Run qualification prematurely",
        run: "npm run check",
      });
    }
    await expect(check(workflow)).rejects.toThrow("immutable checkout");
  });
  it("accepts only a regular, non-symlink, nonempty release record", async () => {
    const workflow = await fixture();
    const step = workflow.jobs.build?.steps.find(
      (entry) => entry.id === "require-release-notes",
    );
    if (!step?.run) throw new Error("missing release-notes fixture");
    const temporary = await temporaryDirectory("mill-release-notes-");
    try {
      const docs = path.join(temporary.path, "docs");
      const directory = path.join(docs, "releases");
      const notes = path.join(directory, "v1.2.3.md");
      await mkdir(notes, { recursive: true });
      await expect(
        execute("sh", ["-c", step.run], {
          cwd: temporary.path,
          env: { ...process.env, RELEASE_TAG: "v1.2.3" },
        }),
      ).rejects.toThrow();

      await rmdir(notes);
      await writeFile(
        path.join(temporary.path, "target.md"),
        "release notes\n",
      );
      await symlink("../../target.md", notes);
      await expect(
        execute("sh", ["-c", step.run], {
          cwd: temporary.path,
          env: { ...process.env, RELEASE_TAG: "v1.2.3" },
        }),
      ).rejects.toThrow();

      await unlink(notes);
      await writeFile(notes, "release notes\n");
      await expect(
        execute("sh", ["-c", step.run], {
          cwd: temporary.path,
          env: { ...process.env, RELEASE_TAG: "v1.2.3" },
        }),
      ).resolves.toBeDefined();

      await unlink(notes);
      await rmdir(directory);
      const releasesTarget = path.join(temporary.path, "releases-target");
      await mkdir(releasesTarget, { recursive: true });
      await writeFile(
        path.join(releasesTarget, "v1.2.3.md"),
        "release notes\n",
      );
      await symlink("../releases-target", directory);
      await expect(
        execute("sh", ["-c", step.run], {
          cwd: temporary.path,
          env: { ...process.env, RELEASE_TAG: "v1.2.3" },
        }),
      ).rejects.toThrow();

      await unlink(directory);
      await rmdir(docs);
      const docsTarget = path.join(temporary.path, "docs-target");
      await mkdir(path.join(docsTarget, "releases"), { recursive: true });
      await writeFile(
        path.join(docsTarget, "releases/v1.2.3.md"),
        "release notes\n",
      );
      await symlink("docs-target", docs);
      await expect(
        execute("sh", ["-c", step.run], {
          cwd: temporary.path,
          env: { ...process.env, RELEASE_TAG: "v1.2.3" },
        }),
      ).rejects.toThrow();
    } finally {
      await temporary.cleanup();
    }
  });
  it.each(["late", "conditional", "ignored", "unpinned"])(
    "rejects %s publish preparation before an immutable effect",
    async (mutation) => {
      const workflow = await fixture();
      const job = workflow.jobs.publish;
      const index =
        job?.steps.findIndex(
          (step) => step.id === "prepare-release-verifier",
        ) ?? -1;
      const step = job?.steps[index];
      if (!job || !step || index < 0)
        throw new Error("missing preparation fixture");
      if (mutation === "late") job.steps.push(...job.steps.splice(index, 1));
      if (mutation === "conditional") step.if = "false";
      if (mutation === "ignored") step["continue-on-error"] = true;
      if (mutation === "unpinned") step.run = "docker pull node:latest";
      await expect(check(workflow)).rejects.toThrow("verifier preparation");
    },
  );
  it("rejects a newly added full-canary job without its own preparation", async () => {
    const workflow = await fixture();
    const job = structuredClone(workflow.jobs.qualify);
    if (!job) throw new Error("missing qualifier fixture");
    job.steps = job.steps.filter(
      (step) => step.id !== "prepare-release-verifier",
    );
    workflow.jobs.extra = job;
    await expect(check(workflow)).rejects.toThrow("verifier preparation");
  });
  it("rejects duplicated preparation identifiers", async () => {
    const workflow = await fixture();
    const job = workflow.jobs.publish;
    const step = job?.steps.find(
      (entry) => entry.id === "prepare-release-verifier",
    );
    if (!job || !step) throw new Error("missing preparation fixture");
    job.steps.unshift(structuredClone(step));
    await expect(check(workflow)).rejects.toThrow("verifier preparation");
  });
});
