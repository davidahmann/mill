export const releaseVerifierPreparation = [
  `verifier_image=$(node -e 'const fs=require("node:fs"),y=require("yaml");const image=y.parse(fs.readFileSync("recipes/node-typescript-next-web/recipe.yaml","utf8")).verifierImage;if(typeof image!=="string"||!/@sha256:[a-f0-9]{64}$/.test(image))throw new Error("Digest-pinned verifier required");process.stdout.write(image)')`,
  'docker pull "$verifier_image"',
  'docker image inspect "$verifier_image" >/dev/null',
].join("\n");

export const releaseDispatchCheck = [
  "set -eu",
  "printf '%s\\n' \"$RELEASE_TAG\" | grep -Eq '^v[0-9]+\\.[0-9]+\\.[0-9]+(-[0-9A-Za-z.-]+)?$'",
  'normalized_ref=$(git check-ref-format --normalize "refs/tags/$RELEASE_TAG")',
  'test "$normalized_ref" = "refs/tags/$RELEASE_TAG"',
  'test "$(git cat-file -t "$normalized_ref")" = tag',
  'test "$(git rev-parse "${normalized_ref}^{commit}")" = "$(git rev-parse HEAD^{commit})"',
  'notes_dir="docs/releases"',
  'notes_file="${notes_dir}/${RELEASE_TAG}.md"',
  'test -d docs && test ! -L docs && test -d "$notes_dir" && test ! -L "$notes_dir" && test -f "$notes_file" && test ! -L "$notes_file" && test -s "$notes_file"',
].join("\n");

const releaseTagInput = "${{ inputs.tag }}";

/** Every requested-tag release job starts with one exact immutable dispatch boundary. */
export function releaseDispatchFailures(jobs) {
  const failures = [];
  for (const jobId of ["build", "qualify", "publish"]) {
    const job = jobs[jobId];
    const steps = Array.isArray(job?.steps) ? job.steps : [];
    const checks = steps
      .map((step, index) => ({ step, index }))
      .filter(({ step }) => step?.id === "verify-release-dispatch");
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
      check.step.run.trim() !== releaseDispatchCheck ||
      check.step.env?.RELEASE_TAG !== releaseTagInput ||
      check.step.if !== undefined ||
      ![undefined, false].includes(check.step["continue-on-error"]) ||
      ![undefined, false].includes(job?.["continue-on-error"]) ||
      !immutableCheckout ||
      check.index !== 1
    ) {
      failures.push(
        `${jobId}: immutable checkout must be followed immediately by exact requested-tag dispatch proof`,
      );
    }
  }
  return failures;
}

/** A public-alpha release remains plainly labelled while GitHub can mark it Latest. */
export function releasePublicationFailures(jobs) {
  const job = jobs.publish;
  const steps = Array.isArray(job?.steps) ? job.steps : [];
  const create = steps.find(
    (step) => step?.name === "Create draft GitHub Release with exact artifacts",
  );
  const finalize = steps.find(
    (step) => step?.name === "Read back GitHub Release and finalize evidence",
  );
  const failures = [];
  if (
    typeof create?.run !== "string" ||
    !create.run.includes(
      'gh release create "$RELEASE_TAG" --verify-tag --draft',
    ) ||
    !create.run.includes('--title "Mill $RELEASE_TAG (Public alpha)"') ||
    create.run.includes("--prerelease")
  ) {
    failures.push(
      "publish: GitHub release must be a plainly labelled normal public-alpha release",
    );
  }
  if (
    typeof finalize?.run !== "string" ||
    !finalize.run.includes('gh release edit "$RELEASE_TAG" --draft=false') ||
    finalize.run.includes("--prerelease")
  ) {
    failures.push(
      "publish: final GitHub release must remain a normal public-alpha release",
    );
  }
  return failures;
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
