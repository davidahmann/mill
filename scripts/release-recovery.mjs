import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const repository = "davidahmann/mill";
const workflowId = 346766046;
const workflowPath = ".github/workflows/release.yml";
const recoveryPath = ".github/workflows/release-recovery.yml";
const publishName = "Publish the exact preserved artifact with provenance";
const preparationNames = [
  "Checkout immutable tag",
  "Verify immutable release dispatch",
  "Validate publish inputs",
  "Set up Node and npm registry",
  "Install without lifecycle scripts",
  "Build release tools",
  "Verify release identity",
  "Download the qualified candidate run",
  "Download independent verifier receipt",
  "Bind candidate run and independently verified artifact",
  "Bind candidate and publish workflow identities",
  "Verify preserved public-alpha qualification",
  "Bind qualification and prepublication release evidence",
  "Prepare the pinned verifier before immutable publication",
  publishName,
];
const githubNames = [
  "Create draft GitHub Release with exact artifacts",
  "Read back draft GitHub Release evidence",
  "Publish GitHub Release after draft evidence readback",
  "Read back published GitHub Release and attach final evidence",
];
const demand = (condition, message) => {
  if (!condition) throw new Error(message);
};
const numericId = (value) => /^[1-9][0-9]*$/u.test(String(value));
const sha = (value) =>
  typeof value === "string" && /^[a-f0-9]{40}$/u.test(value);
const timestamp = (value) =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
const read = async (file) => JSON.parse(await readFile(file, "utf8"));
const write = (file, value) =>
  writeFile(file, `${JSON.stringify(value, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
const digest = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

function pageItems(pages, key) {
  demand(Array.isArray(pages) && pages.length > 0, `missing ${key} pages`);
  const total = pages[0].total_count;
  demand(
    Number.isSafeInteger(total) && total >= 0 && total <= 1000,
    `unbounded ${key} inventory`,
  );
  demand(
    pages.every(
      (page) => page.total_count === total && Array.isArray(page[key]),
    ),
    `invalid ${key} pagination`,
  );
  const items = pages.flatMap((page) => page[key]);
  demand(
    items.length === total &&
      new Set(items.map((item) => item.id)).size === total,
    `incomplete or duplicate ${key} inventory`,
  );
  return items;
}

function assertAbsent(pages, tag) {
  demand(
    Array.isArray(pages) && pages.length > 0 && pages.every(Array.isArray),
    "invalid release inventory",
  );
  for (const release of pages.flat()) {
    demand(
      Number.isSafeInteger(release.id) &&
        release.id > 0 &&
        typeof release.tag_name === "string" &&
        typeof release.draft === "boolean",
      "invalid release observation",
    );
    demand(
      release.tag_name !== tag,
      "GitHub Release already exists for this tag; recovery cannot create or overwrite it",
    );
  }
}

function context(env) {
  demand(
    env.GITHUB_REPOSITORY === repository &&
      env.GITHUB_SERVER_URL === "https://github.com" &&
      env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
      env.GITHUB_REF === "refs/heads/main" &&
      env.GITHUB_RUN_ATTEMPT === "1" &&
      numericId(env.GITHUB_RUN_ID) &&
      sha(env.GITHUB_SHA) &&
      env.GITHUB_WORKFLOW_SHA === env.GITHUB_SHA &&
      env.GITHUB_WORKFLOW_REF ===
        `${repository}/${recoveryPath}@refs/heads/main`,
    "recovery requires a first-attempt dispatch of the exact main controller",
  );
  return {
    id: env.GITHUB_RUN_ID,
    attempt: 1,
    url: `https://github.com/${repository}/actions/runs/${env.GITHUB_RUN_ID}`,
    headCommit: env.GITHUB_SHA,
    workflowPath: recoveryPath,
    ref: env.GITHUB_REF,
  };
}

function history(input) {
  const {
    tag,
    candidateId,
    publishId,
    recoveryRun,
    workflow,
    runsPages,
    jobsByRun,
  } = input;
  demand(
    /^v\d+\.\d+\.\d+$/u.test(tag) &&
      numericId(candidateId) &&
      numericId(publishId) &&
      candidateId !== publishId,
    "invalid stable tag or distinct run inputs",
  );
  demand(
    workflow.id === workflowId &&
      workflow.path === workflowPath &&
      workflow.state === "active",
    "unexpected release workflow identity",
  );
  const runs = pageItems(runsPages, "workflow_runs");
  demand(runs.length <= 50, "too many release attempts for bounded recovery");
  const publish = runs.find((run) => String(run.id) === publishId);
  const candidate = runs.find((run) => String(run.id) === candidateId);
  demand(
    publish !== undefined &&
      candidate !== undefined &&
      publishId !== recoveryRun.id &&
      candidateId !== recoveryRun.id,
    "missing distinct candidate or original publish run",
  );
  for (const run of runs) {
    demand(
      run.repository?.full_name === repository &&
        run.workflow_id === workflowId &&
        run.path === workflowPath &&
        run.event === "workflow_dispatch" &&
        run.head_branch === tag &&
        sha(run.head_sha) &&
        run.head_sha === publish.head_sha &&
        run.status === "completed" &&
        run.run_attempt === 1 &&
        run.html_url ===
          `https://github.com/${repository}/actions/runs/${run.id}`,
      "release run has wrong identity, is unfinished, or has repeated attempts",
    );
    const jobs = pageItems(jobsByRun[String(run.id)], "jobs");
    demand(
      jobs.every(
        (job) =>
          job.run_id === run.id &&
          job.run_attempt === 1 &&
          job.head_sha === run.head_sha &&
          job.head_branch === tag &&
          job.status === "completed",
      ),
      "job does not belong to exact completed first attempt",
    );
    const publishers = jobs.filter(
      (job) => job.name === "publish-qualified-artifact",
    );
    demand(publishers.length === 1, "expected exactly one publish job per run");
    if (run.id !== publish.id)
      demand(
        publishers[0].conclusion === "skipped" &&
          publishers[0].steps.length === 0,
        "another publish attempt exists; reconcile it before recovery",
      );
    if (run.id === candidate.id) {
      demand(run.conclusion === "success", "candidate did not succeed");
      for (const name of [
        "build-a",
        "build-b",
        "qualify-candidate",
        "independent-release-policy",
      ]) {
        const matches = jobs.filter((job) => job.name === name);
        demand(
          matches.length === 1 && matches[0].conclusion === "success",
          `missing successful candidate job: ${name}`,
        );
      }
    }
  }
  const jobs = pageItems(jobsByRun[publishId], "jobs");
  const job = jobs.find((item) => item.name === "publish-qualified-artifact");
  demand(
    publish.conclusion === "failure" &&
      job.conclusion === "failure" &&
      jobs.every(
        (item) =>
          item === job ||
          (item.conclusion === "skipped" && item.steps.length === 0),
      ),
    "recovery only accepts a failed publish-mode run",
  );
  demand(
    Array.isArray(job.steps) &&
      new Set(job.steps.map((step) => step.number)).size === job.steps.length,
    "ambiguous publish steps",
  );
  const step = (name, conclusion) => {
    const matches = job.steps.filter((item) => item.name === name);
    demand(
      matches.length === 1 &&
        matches[0].status === "completed" &&
        matches[0].conclusion === conclusion &&
        Number.isSafeInteger(matches[0].number) &&
        matches[0].number > 0 &&
        timestamp(matches[0].started_at) &&
        timestamp(matches[0].completed_at) &&
        Date.parse(matches[0].started_at) <=
          Date.parse(matches[0].completed_at),
      `missing exact ${conclusion} step: ${name}`,
    );
    return matches[0];
  };
  let prior;
  for (const name of preparationNames) {
    const current = step(name, "success");
    demand(
      prior === undefined ||
        (current.number > prior.number &&
          Date.parse(current.started_at) >= Date.parse(prior.completed_at)),
      "publish preparation order is invalid",
    );
    prior = current;
  }
  const npmPublish = step(publishName, "success");
  const readback = step("Read back npm and verify signatures", "failure");
  demand(
    readback.number > npmPublish.number &&
      Date.parse(readback.started_at) >= Date.parse(npmPublish.completed_at),
    "npm readback did not fail after completed publication",
  );
  for (const name of [
    "Requalify the registry-downloaded package",
    ...githubNames,
  ])
    demand(
      step(name, "skipped").number > readback.number,
      "GitHub effects were not skipped after readback failure",
    );
  const known = new Set([
    ...preparationNames,
    "Read back npm and verify signatures",
    "Requalify the registry-downloaded package",
    ...githubNames,
    "Set up job",
    "Post Set up Node and npm registry",
    "Post Checkout immutable tag",
    "Complete job",
  ]);
  demand(
    job.steps.every((item) => known.has(item.name)),
    "unknown original publish step requires manual reconciliation",
  );
  assertAbsent(input.releasesPages, tag);
  const runIdentity = (run) => ({
    id: String(run.id),
    url: run.html_url,
    headCommit: run.head_sha,
  });
  return {
    candidate,
    publish,
    job,
    npmPublish,
    workflowRuns: {
      candidate: runIdentity(candidate),
      publish: runIdentity(publish),
    },
  };
}

function api(endpoint, paginated = false) {
  const args = [
    "api",
    ...(paginated ? ["--paginate", "--slurp"] : []),
    `repos/${repository}/${endpoint}`,
  ];
  return JSON.parse(
    execFileSync("gh", args, {
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
}

// Only provider facts consumed by this gate become permanent public evidence.
const pick = (value, keys) =>
  Object.fromEntries(keys.map((key) => [key, value[key]]));
const runObservation = (value) => ({
  ...pick(value, [
    "id",
    "workflow_id",
    "path",
    "event",
    "head_branch",
    "head_sha",
    "status",
    "run_attempt",
    "html_url",
    "conclusion",
  ]),
  repository: pick(value.repository, ["full_name"]),
});
const jobObservation = (value) => ({
  ...pick(value, [
    "id",
    "run_id",
    "run_attempt",
    "head_sha",
    "head_branch",
    "status",
    "name",
    "conclusion",
    "html_url",
  ]),
  steps: value.steps.map((step) =>
    pick(step, [
      "name",
      "number",
      "status",
      "conclusion",
      "started_at",
      "completed_at",
    ]),
  ),
});
const observationPages = (pages, key, select) =>
  pages.map((page) => ({
    total_count: page.total_count,
    [key]: page[key].map(select),
  }));

function candidateBinding(log, candidateId, tag, job) {
  const lines = log
    .split(/\r?\n/u)
    .map((line) => line.replace(/^\d{4}-\d{2}-\d{2}T\S+ /u, ""));
  const groups = [];
  let group;
  for (const line of lines) {
    if (line.startsWith("##[group]")) {
      demand(group === undefined, "nested job log groups are ambiguous");
      group = [line];
    } else if (line === "##[endgroup]") {
      if (group !== undefined) groups.push(group);
      group = undefined;
    } else if (group !== undefined) group.push(line);
  }
  const command =
    '##[group]Run gh api "repos/$GITHUB_REPOSITORY/actions/runs/$CANDIDATE_RUN_ID" > "$RUNNER_TEMP/candidate-run.json"';
  const binding = groups.filter((item) => item[0] === command);
  demand(
    binding.length === 1 &&
      binding[0].filter((line) => line.startsWith("  CANDIDATE_RUN_ID:"))
        .length === 1 &&
      binding[0].includes(`  CANDIDATE_RUN_ID: ${candidateId}`),
    "original publish consumed a different or unproven candidate run",
  );
  for (const name of [
    `genesis-candidate-${tag}`,
    `independent-policy-${tag}`,
  ]) {
    const downloads = groups.filter(
      (item) =>
        item[0] ===
          "##[group]Run actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c" &&
        item.includes(`  name: ${name}`),
    );
    demand(
      downloads.length === 1 &&
        downloads[0].filter((line) => line.startsWith("  run-id:")).length ===
          1 &&
        downloads[0].includes(`  run-id: ${candidateId}`) &&
        downloads[0].includes(`  repository: ${repository}`),
      "original artifact download did not consume the approved candidate run",
    );
  }
  return {
    candidateId,
    jobId: String(job.id),
    logsUrl: `https://api.github.com/repos/${repository}/actions/jobs/${job.id}/logs`,
    logsDigest: digest(log),
    bindingStepName: "Bind candidate run and independently verified artifact",
  };
}

const [mode, ...args] = process.argv.slice(2);
if (mode === "observe") {
  const [tag, candidateId, publishId, directory] = args;
  const recoveryRun = context(process.env);
  demand(
    /^v\d+\.\d+\.\d+$/u.test(tag) &&
      numericId(candidateId) &&
      numericId(publishId) &&
      typeof directory === "string",
    "invalid recovery inputs",
  );
  const workflow = pick(api("actions/workflows/release.yml"), [
    "id",
    "path",
    "state",
  ]);
  const runsPages = observationPages(
    api(
      `actions/workflows/release.yml/runs?event=workflow_dispatch&branch=${tag}&per_page=100`,
      true,
    ),
    "workflow_runs",
    runObservation,
  );
  const runs = pageItems(runsPages, "workflow_runs");
  demand(runs.length <= 50, "too many release attempts for bounded recovery");
  const jobsByRun = {};
  for (const run of runs) {
    demand(
      numericId(run.id) && run.run_attempt === 1,
      "repeated or invalid release attempt",
    );
    jobsByRun[String(run.id)] = observationPages(
      api(`actions/runs/${run.id}/attempts/1/jobs?per_page=100`, true),
      "jobs",
      jobObservation,
    );
  }
  const input = {
    tag,
    candidateId,
    publishId,
    recoveryRun,
    workflow,
    runsPages,
    jobsByRun,
    releasesPages: api("releases?per_page=100", true).map((page) =>
      page.map((release) => pick(release, ["id", "tag_name", "draft"])),
    ),
    observedAt: new Date().toISOString(),
  };
  const accepted = history(input);
  const log = execFileSync(
    "gh",
    ["api", `repos/${repository}/actions/jobs/${accepted.job.id}/logs`],
    {
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  candidateBinding(log, candidateId, tag, accepted.job);
  await writeFile(path.join(directory, "publish-job.log"), log, {
    flag: "wx",
    mode: 0o600,
  });
  await write(path.join(directory, "recovery-observations.json"), input);
  await write(path.join(directory, "candidate-run.json"), accepted.candidate);
  await write(
    path.join(directory, "candidate-jobs.json"),
    jobsByRun[candidateId],
  );
  await write(path.join(directory, "publish-run.json"), accepted.publish);
} else if (mode === "validate") {
  const [directory, identityFile, metadataFile] = args;
  const input = await read(path.join(directory, "recovery-observations.json"));
  demand(
    JSON.stringify(input.recoveryRun) === JSON.stringify(context(process.env)),
    "recovery controller context changed",
  );
  const accepted = history(input);
  const binding = candidateBinding(
    await readFile(path.join(directory, "publish-job.log"), "utf8"),
    input.candidateId,
    input.tag,
    accepted.job,
  );
  const identity = await read(identityFile);
  const metadata = await read(metadataFile);
  demand(
    identity.tag === input.tag &&
      identity.tagCommit === accepted.publish.head_sha &&
      sha(identity.mainTree) &&
      identity.mainTree === identity.reviewedCandidateTree &&
      identity.packageName === "@davidahmann/mill" &&
      identity.version === input.tag.slice(1) &&
      metadata.package.name === identity.packageName &&
      metadata.package.version === identity.version,
    "recovery tag, package or original publication identity mismatch",
  );
  await write(
    path.join(directory, "workflow-runs.json"),
    accepted.workflowRuns,
  );
  await write(path.join(directory, "recovery-source.json"), {
    schemaVersion: "1",
    tag: input.tag,
    source: identity,
    artifactDigest: metadata.selectedArtifact.sha256,
    workflowRuns: accepted.workflowRuns,
    originalPublish: {
      attempt: 1,
      jobId: String(accepted.job.id),
      jobUrl: accepted.job.html_url,
      step: accepted.npmPublish,
      candidateBinding: binding,
    },
    recoveryRun: input.recoveryRun,
    observationsDigest: digest(
      await readFile(path.join(directory, "recovery-observations.json")),
    ),
    observedAt: input.observedAt,
  });
} else if (mode === "absent") {
  const [pagesFile, tag] = args;
  assertAbsent(await read(pagesFile), tag);
} else if (mode === "registry") {
  const [metadataFile, directory] = args;
  const metadata = await read(metadataFile);
  const files = (await readdir(directory)).filter((file) =>
    file.endsWith(".tgz"),
  );
  demand(files.length === 1, "expected one registry tarball");
  const bytes = await readFile(path.join(directory, files[0]));
  demand(
    digest(bytes) === metadata.selectedArtifact.sha256 &&
      `sha512-${createHash("sha512").update(bytes).digest("base64")}` ===
        metadata.selectedArtifact.npmIntegrity,
    "registry bytes differ from preserved artifact",
  );
} else if (mode === "finalize") {
  const [directory, finalEvidenceFile, qualificationFile] = args;
  const source = await read(path.join(directory, "recovery-source.json"));
  demand(
    JSON.stringify(source.recoveryRun) === JSON.stringify(context(process.env)),
    "recovery controller context changed",
  );
  const finalBytes = await readFile(finalEvidenceFile);
  const evidence = JSON.parse(finalBytes);
  demand(
    evidence.state === "verified" &&
      evidence.githubRelease?.state === "published" &&
      evidence.package.tag === source.tag &&
      evidence.source.tagCommit === source.source.tagCommit &&
      evidence.source.resultingMainCommit === source.source.tagCommit &&
      evidence.source.resultingMainTree === source.source.mainTree &&
      evidence.source.reviewedCandidateTree === source.source.mainTree &&
      evidence.selectedArtifact.sha256 === source.artifactDigest &&
      JSON.stringify(evidence.workflowRuns) ===
        JSON.stringify(source.workflowRuns),
    "final evidence differs from recovered publication",
  );
  await write(path.join(directory, "release-recovery.json"), {
    ...source,
    qualificationFileDigest: digest(await readFile(qualificationFile)),
    finalEvidenceFileDigest: digest(finalBytes),
    releaseId: evidence.githubRelease.releaseId,
    completedAt: new Date().toISOString(),
  });
} else {
  throw new Error(
    "expected observe, validate, absent, registry or finalize recovery operation",
  );
}
