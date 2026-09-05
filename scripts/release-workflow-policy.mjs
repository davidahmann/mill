export const releaseVerifierPreparation = [
  `verifier_image=$(node -e 'const fs=require("node:fs"),y=require("yaml");const image=y.parse(fs.readFileSync("recipes/node-typescript-next-web/recipe.yaml","utf8")).verifierImage;if(typeof image!=="string"||!/@sha256:[a-f0-9]{64}$/.test(image))throw new Error("Digest-pinned verifier required");process.stdout.write(image)')`,
  'docker pull "$verifier_image"',
  'docker image inspect "$verifier_image" >/dev/null',
].join("\n");

export const releaseNotesCheck = [
  'notes_file="docs/releases/${RELEASE_TAG}.md"',
  'test -f "$notes_file" && test ! -L "$notes_file" && test -s "$notes_file"',
].join("\n");

const releaseTagInput = "${{ inputs.tag }}";

/** Candidate evidence starts with one exact immutable checkout-to-notes boundary. */
export function releaseNotesFailures(jobs) {
  const job = jobs.build;
  const steps = Array.isArray(job?.steps) ? job.steps : [];
  const checks = steps
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => step?.id === "require-release-notes");
  const check = checks[0];
  const checkout = steps[0];
  const immutableCheckout =
    checkout?.name === "Checkout immutable tag" &&
    typeof checkout.uses === "string" &&
    checkout.uses.startsWith("actions/checkout@") &&
    checkout.with?.ref === releaseTagInput &&
    checkout.with?.["fetch-depth"] === 0 &&
    checkout.with?.["persist-credentials"] === false &&
    checkout.if === undefined &&
    [undefined, false].includes(checkout["continue-on-error"]);
  if (
    checks.length !== 1 ||
    typeof check?.step?.run !== "string" ||
    check.step.run.trim() !== releaseNotesCheck ||
    check.step.env?.RELEASE_TAG !== releaseTagInput ||
    check.step.if !== undefined ||
    ![undefined, false].includes(check.step["continue-on-error"]) ||
    ![undefined, false].includes(job?.["continue-on-error"]) ||
    !immutableCheckout ||
    check.index !== 1
  ) {
    return [
      "build: immutable checkout must be followed immediately by exact tag-bound release notes",
    ];
  }
  return [];
}

/** Every fresh release runner prepares its own image before dependent effects. */
export function releaseVerifierPreparationFailures(jobs) {
  const failures = [];
  const selectedJobs = new Set(["qualify", "independent-policy", "publish"]);
  for (const [jobId, job] of Object.entries(jobs)) {
    if (
      Array.isArray(job?.steps) &&
      job.steps.some(
        (step) =>
          typeof step?.run === "string" &&
          (step.run.includes("--full-canary") ||
            /\bnpm publish\b/u.test(step.run)),
      )
    )
      selectedJobs.add(jobId);
  }
  for (const jobId of selectedJobs) {
    const job = jobs[jobId];
    const steps = Array.isArray(job?.steps) ? job.steps : [];
    const preparations = steps
      .map((step, index) => ({ step, index }))
      .filter(({ step }) => step?.id === "prepare-release-verifier");
    const firstCanary = steps.findIndex(
      (step) =>
        typeof step?.run === "string" && step.run.includes("--full-canary"),
    );
    const firstPublish = steps.findIndex(
      (step) =>
        typeof step?.run === "string" && /\bnpm publish\b/u.test(step.run),
    );
    const prepared = preparations[0];
    if (
      preparations.length !== 1 ||
      typeof prepared.step.run !== "string" ||
      prepared.step.run.trim() !== releaseVerifierPreparation ||
      prepared.step.if !== undefined ||
      ![undefined, false].includes(prepared.step["continue-on-error"]) ||
      ![undefined, false].includes(job?.["continue-on-error"]) ||
      firstCanary < 0 ||
      prepared.index >= firstCanary ||
      (firstPublish >= 0 && prepared.index >= firstPublish) ||
      (jobId === "publish" && firstPublish < 0)
    ) {
      failures.push(
        `${jobId}: verifier preparation must be exact, unconditional and before every full canary and publication effect`,
      );
    }
  }
  return failures;
}
