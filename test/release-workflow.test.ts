import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { temporaryDirectory } from "./helpers.js";

const execute = promisify(execFile);
const checker = path.resolve("scripts/check-workflows.mjs");
const source = path.resolve(".github/workflows/release.yml");
interface Step {
  id?: string;
  run?: string;
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
