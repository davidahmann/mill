import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";
import {
  releaseNotesFailures,
  releaseVerifierPreparationFailures,
} from "./release-workflow-policy.mjs";

const workflowDirectory = path.resolve(".github/workflows");
const files = (await readdir(workflowDirectory))
  .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
  .sort();
const failures = [];

function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : undefined;
}

for (const file of files) {
  const source = await readFile(path.join(workflowDirectory, file), "utf8");
  let workflow;
  try {
    workflow = record(parse(source));
  } catch (error) {
    failures.push(`${file}: invalid YAML: ${String(error)}`);
    continue;
  }
  if (workflow === undefined) {
    failures.push(`${file}: workflow must be a mapping`);
    continue;
  }
  if (!Object.hasOwn(workflow, "permissions")) {
    failures.push(`${file}: missing top-level permissions`);
  }
  if (!Object.hasOwn(workflow, "concurrency")) {
    failures.push(`${file}: missing concurrency control`);
  }
  const jobs = record(workflow.jobs);
  if (jobs === undefined || Object.keys(jobs).length === 0) {
    failures.push(`${file}: jobs must be a non-empty mapping`);
    continue;
  }
  if (file === "release.yml") {
    failures.push(...releaseNotesFailures(jobs));
    failures.push(...releaseVerifierPreparationFailures(jobs));
  }
  for (const [jobName, rawJob] of Object.entries(jobs)) {
    const job = record(rawJob);
    if (job === undefined) {
      failures.push(`${file}: job ${jobName} must be a mapping`);
      continue;
    }
    if (
      !Number.isInteger(job["timeout-minutes"]) ||
      job["timeout-minutes"] <= 0
    ) {
      failures.push(`${file}: job ${jobName} must declare timeout-minutes`);
    }
    if (!Array.isArray(job.steps)) {
      continue;
    }
    for (const rawStep of job.steps) {
      const step = record(rawStep);
      if (step === undefined || typeof step.uses !== "string") {
        continue;
      }
      if (!/@[a-f0-9]{40}$/u.test(step.uses)) {
        failures.push(
          `${file}: action is not pinned to a full commit: ${step.uses}`,
        );
      }
    }
  }
}

if (files.length === 0) {
  failures.push("no workflows found");
}
if (failures.length > 0) {
  throw new Error(`workflow contract failed:\n${failures.join("\n")}`);
}
process.stdout.write(`workflow contract passed: ${files.join(", ")}\n`);
