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

async function initializeTaggedReleaseFixture(directory: string, tag: string) {
  const notes = path.join(directory, "docs/releases", `${tag}.md`);
  await mkdir(path.dirname(notes), { recursive: true });
  await writeFile(notes, "release notes\n");
  await execute("git", ["init"], { cwd: directory });
  await execute("git", ["config", "user.email", "tests@mill.local"], {
    cwd: directory,
  });
  await execute("git", ["config", "user.name", "Mill tests"], {
    cwd: directory,
  });
  await execute("git", ["add", "docs"], { cwd: directory });
  await execute("git", ["commit", "-m", "add release record"], {
    cwd: directory,
  });
  await execute("git", ["tag", "-a", tag, "-m", "release tag"], {
    cwd: directory,
  });
  return notes;
}

function runDispatchPreflight(directory: string, run: string, tag: string) {
  return execute("sh", ["-c", run], {
    cwd: directory,
    env: { ...process.env, RELEASE_TAG: tag },
  });
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
  it.each(["build", "qualify", "publish"])(
    "rejects %s without exact requested-tag dispatch proof",
    async (jobId) => {
      const workflow = await fixture();
      const job = workflow.jobs[jobId];
      if (!job) throw new Error("missing release fixture job");
      job.steps = job.steps.filter(
        (step) => step.id !== "verify-release-dispatch",
      );
      await expect(check(workflow)).rejects.toThrow(
        "requested-tag dispatch proof",
      );
    },
  );
  it.each([
    "hard-coded-tag",
    "conditional",
    "ignored",
    "moved",
    "intervening-step",
    "weakened",
  ])("rejects a %s requested-tag dispatch proof", async (mutation) => {
    const workflow = await fixture();
    const job = workflow.jobs.build;
    if (!job) throw new Error("missing release fixture job");
    const index = job.steps.findIndex(
      (step) => step.id === "verify-release-dispatch",
    );
    const step = job.steps[index];
    if (!step || index < 0) throw new Error("missing release dispatch fixture");
    if (mutation === "hard-coded-tag") {
      step.env = { RELEASE_TAG: "v0.3.0" };
    } else if (mutation === "conditional") {
      step.if = "false";
    } else if (mutation === "ignored") {
      step["continue-on-error"] = true;
    } else if (mutation === "moved") {
      job.steps.push(...job.steps.splice(index, 1));
    } else if (mutation === "intervening-step") {
      job.steps.splice(1, 0, {
        name: "Run qualification prematurely",
        run: "npm run check",
      });
    }
    if (mutation === "weakened") step.run = 'test -n "$RELEASE_TAG"';
    await expect(check(workflow)).rejects.toThrow(
      "requested-tag dispatch proof",
    );
  });
  it("accepts only a regular, non-symlink, nonempty release record", async () => {
    const workflow = await fixture();
    const step = workflow.jobs.build?.steps.find(
      (entry) => entry.id === "verify-release-dispatch",
    );
    if (!step?.run) throw new Error("missing release dispatch fixture");
    const temporary = await temporaryDirectory("mill-release-notes-");
    try {
      const docs = path.join(temporary.path, "docs");
      const directory = path.join(docs, "releases");
      const notes = await initializeTaggedReleaseFixture(
        temporary.path,
        "v1.2.3",
      );
      await expect(
        runDispatchPreflight(temporary.path, step.run, "v1.2.3"),
      ).resolves.toBeDefined();

      await unlink(notes);
      await mkdir(notes, { recursive: true });
      await expect(
        runDispatchPreflight(temporary.path, step.run, "v1.2.3"),
      ).rejects.toThrow();

      await rmdir(notes);
      await writeFile(
        path.join(temporary.path, "target.md"),
        "release notes\n",
      );
      await symlink("../../target.md", notes);
      await expect(
        runDispatchPreflight(temporary.path, step.run, "v1.2.3"),
      ).rejects.toThrow();

      await unlink(notes);
      await writeFile(notes, "release notes\n");
      await expect(
        runDispatchPreflight(temporary.path, step.run, "v1.2.3"),
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
        runDispatchPreflight(temporary.path, step.run, "v1.2.3"),
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
        runDispatchPreflight(temporary.path, step.run, "v1.2.3"),
      ).rejects.toThrow();
    } finally {
      await temporary.cleanup();
    }
  });
  it("rejects malformed, lightweight, and stale requested tags", async () => {
    const workflow = await fixture();
    const step = workflow.jobs.build?.steps.find(
      (entry) => entry.id === "verify-release-dispatch",
    );
    if (!step?.run) throw new Error("missing release dispatch fixture");
    const temporary = await temporaryDirectory("mill-release-dispatch-");
    try {
      await initializeTaggedReleaseFixture(temporary.path, "v1.2.3");
      await expect(
        runDispatchPreflight(temporary.path, step.run, "release-candidate"),
      ).rejects.toThrow();

      await writeFile(
        path.join(temporary.path, "docs/releases/v1.2.4.md"),
        "release notes\n",
      );
      await execute("git", ["tag", "v1.2.4"], { cwd: temporary.path });
      await expect(
        runDispatchPreflight(temporary.path, step.run, "v1.2.4"),
      ).rejects.toThrow();

      await writeFile(
        path.join(temporary.path, "docs/releases/v1.2.5.md"),
        "release notes\n",
      );
      await execute("git", ["add", "docs/releases/v1.2.5.md"], {
        cwd: temporary.path,
      });
      await execute("git", ["commit", "-m", "prepare next release"], {
        cwd: temporary.path,
      });
      await execute("git", ["tag", "-a", "v1.2.5", "-m", "release tag"], {
        cwd: temporary.path,
      });
      await writeFile(path.join(temporary.path, "later-change"), "changed\n");
      await execute("git", ["add", "later-change"], { cwd: temporary.path });
      await execute("git", ["commit", "-m", "move checkout beyond tag"], {
        cwd: temporary.path,
      });
      await expect(
        runDispatchPreflight(temporary.path, step.run, "v1.2.5"),
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
