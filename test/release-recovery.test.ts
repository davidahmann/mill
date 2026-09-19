import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { temporaryDirectory } from "./helpers.js";

const script = path.resolve("scripts/release-recovery.mjs");
const repository = "davidahmann/mill";
const tag = "v0.7.1";
const sourceCommit = "a".repeat(40);
const controllerCommit = "b".repeat(40);
const env = {
  ...process.env,
  GITHUB_REPOSITORY: repository,
  GITHUB_SERVER_URL: "https://github.com",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REF: "refs/heads/main",
  GITHUB_RUN_ATTEMPT: "1",
  GITHUB_RUN_ID: "44",
  GITHUB_SHA: controllerCommit,
  GITHUB_WORKFLOW_SHA: controllerCommit,
  GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/release-recovery.yml@refs/heads/main`,
};
const digest = (value: Buffer | string) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("missing test fixture");
  return value;
}
function fixture() {
  const run = (id: number, conclusion: string) => ({
    id,
    conclusion,
    status: "completed",
    repository: { full_name: repository },
    workflow_id: 346766046,
    path: ".github/workflows/release.yml",
    event: "workflow_dispatch",
    head_branch: tag,
    head_sha: sourceCommit,
    run_attempt: 1,
    html_url: `https://github.com/${repository}/actions/runs/${id}`,
  });
  const stepNames = [
    "Set up job",
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
    "Publish the exact preserved artifact with provenance",
    "Read back npm and verify signatures",
    "Requalify the registry-downloaded package",
    "Create draft GitHub Release with exact artifacts",
    "Read back draft GitHub Release evidence",
    "Publish GitHub Release after draft evidence readback",
    "Read back published GitHub Release and attach final evidence",
  ];
  const steps = stepNames.map((name, index) => ({
    name,
    number: index + 1,
    status: "completed",
    conclusion: index < 16 ? "success" : index === 16 ? "failure" : "skipped",
    started_at: "2026-09-19T20:00:00Z",
    completed_at: "2026-09-19T20:00:00Z",
  }));
  const job = (
    id: number,
    runId: number,
    name: string,
    conclusion: string,
    jobSteps = steps.slice(0, 0),
  ) => ({
    id,
    run_id: runId,
    head_sha: sourceCommit,
    head_branch: tag,
    run_attempt: 1,
    status: "completed",
    conclusion,
    name,
    steps: jobSteps,
    html_url: `https://github.com/${repository}/actions/runs/${runId}/job/${id}`,
  });
  const candidateJobs = [
    job(420, 42, "build-a", "success"),
    job(421, 42, "build-b", "success"),
    job(422, 42, "qualify-candidate", "success"),
    job(423, 42, "independent-release-policy", "success"),
    job(424, 42, "publish-qualified-artifact", "skipped"),
  ];
  const publishJobs = [
    job(430, 43, "publish-qualified-artifact", "failure", steps),
    job(431, 43, "build-${{ matrix.builder }}", "skipped"),
    job(432, 43, "qualify-candidate", "skipped"),
    job(433, 43, "independent-release-policy", "skipped"),
  ];
  const recoveryRun = {
    id: "44",
    attempt: 1,
    url: `https://github.com/${repository}/actions/runs/44`,
    headCommit: controllerCommit,
    workflowPath: ".github/workflows/release-recovery.yml",
    ref: "refs/heads/main",
  };
  const jobsByRun: Record<
    string,
    { total_count: number; jobs: ReturnType<typeof job>[] }[]
  > = {
    "42": [{ total_count: candidateJobs.length, jobs: candidateJobs }],
    "43": [{ total_count: publishJobs.length, jobs: publishJobs }],
  };
  const releasesPages: { id: number; tag_name: string; draft: boolean }[][] = [
    [],
  ];
  const input = {
    tag,
    candidateId: "42",
    publishId: "43",
    recoveryRun,
    workflow: {
      id: 346766046,
      path: ".github/workflows/release.yml",
      state: "active",
    },
    runsPages: [
      {
        total_count: 2,
        workflow_runs: [run(42, "success"), run(43, "failure")],
      },
    ],
    jobsByRun,
    releasesPages,
    observedAt: "2026-09-19T21:00:00Z",
  };
  const identity = {
    tag,
    tagCommit: sourceCommit,
    mainTree: "c".repeat(40),
    reviewedCandidateTree: "c".repeat(40),
    packageName: "@davidahmann/mill",
    version: "0.7.1",
  };
  const artifact = Buffer.from("the already published artifact");
  const metadata = {
    package: { name: "@davidahmann/mill", version: "0.7.1" },
    selectedArtifact: {
      sha256: digest(artifact),
      npmIntegrity: `sha512-${createHash("sha512").update(artifact).digest("base64")}`,
    },
  };
  const log = [
    '##[group]Run gh api "repos/$GITHUB_REPOSITORY/actions/runs/$CANDIDATE_RUN_ID" > "$RUNNER_TEMP/candidate-run.json"',
    "env:",
    "  CANDIDATE_RUN_ID: 42",
    "##[endgroup]",
    ...["genesis-candidate", "independent-policy"].flatMap((name) => [
      "##[group]Run actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
      "with:",
      `  name: ${name}-${tag}`,
      `  repository: ${repository}`,
      "  run-id: 42",
      "##[endgroup]",
    ]),
  ]
    .map((line) => `2026-09-19T20:00:00.1234567Z ${line}`)
    .join("\n");
  return { input, identity, metadata, artifact, log };
}
type Fixture = ReturnType<typeof fixture>;
const candidate = (f: Fixture) =>
  required(required(f.input.runsPages[0]).workflow_runs[0]);
const publish = (f: Fixture) =>
  required(required(f.input.runsPages[0]).workflow_runs[1]);
const publishJobs = (f: Fixture) =>
  required(required(f.input.jobsByRun["43"])[0]);
const publishJob = (f: Fixture) => required(publishJobs(f).jobs[0]);
const publishStep = (f: Fixture, number: number) =>
  required(publishJob(f).steps.find((step) => step.number === number));
const invoke = (args: string[], extraEnv: NodeJS.ProcessEnv = {}) =>
  spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    timeout: 10_000,
    env: { ...env, ...extraEnv },
  });
async function prepare(directory: string, f: Fixture) {
  await Promise.all([
    writeFile(
      path.join(directory, "recovery-observations.json"),
      JSON.stringify(f.input),
    ),
    writeFile(
      path.join(directory, "identity.json"),
      JSON.stringify(f.identity),
    ),
    writeFile(
      path.join(directory, "metadata.json"),
      JSON.stringify(f.metadata),
    ),
    writeFile(path.join(directory, "publish-job.log"), f.log),
  ]);
  return [
    "validate",
    directory,
    path.join(directory, "identity.json"),
    path.join(directory, "metadata.json"),
  ];
}

describe("bounded finalization after immutable npm publication", () => {
  it("retains the original publication identity and separately binds the main controller", async () => {
    const temporary = await temporaryDirectory("mill-release-recovery-");
    try {
      const f = fixture();
      const result = invoke(await prepare(temporary.path, f));
      expect(result.status, result.stderr).toBe(0);
      const workflowRuns: unknown = JSON.parse(
        await readFile(path.join(temporary.path, "workflow-runs.json"), "utf8"),
      );
      expect(workflowRuns).toEqual({
        candidate: {
          id: "42",
          url: candidate(f).html_url,
          headCommit: sourceCommit,
        },
        publish: {
          id: "43",
          url: publish(f).html_url,
          headCommit: sourceCommit,
        },
      });
      const source: unknown = JSON.parse(
        await readFile(
          path.join(temporary.path, "recovery-source.json"),
          "utf8",
        ),
      );
      expect(source).toMatchObject({
        source: { tagCommit: sourceCommit },
        recoveryRun: { id: "44", headCommit: controllerCommit },
        originalPublish: {
          attempt: 1,
          step: {
            name: "Publish the exact preserved artifact with provenance",
            conclusion: "success",
          },
          candidateBinding: { candidateId: "42", logsDigest: digest(f.log) },
        },
      });
      const evidence = {
        state: "verified",
        package: { name: f.metadata.package.name, version: "0.7.1", tag },
        source: {
          tagCommit: sourceCommit,
          resultingMainCommit: sourceCommit,
          resultingMainTree: f.identity.mainTree,
          reviewedCandidateTree: f.identity.mainTree,
        },
        selectedArtifact: f.metadata.selectedArtifact,
        workflowRuns,
        githubRelease: { state: "published", releaseId: "700" },
      };
      const evidenceFile = path.join(
        temporary.path,
        "release-evidence-final.json",
      );
      const qualificationFile = path.join(temporary.path, "qualification.json");
      await writeFile(evidenceFile, JSON.stringify(evidence));
      await writeFile(qualificationFile, '{"historical":"qualification"}\n');
      const finalized = invoke([
        "finalize",
        temporary.path,
        evidenceFile,
        qualificationFile,
      ]);
      expect(finalized.status, finalized.stderr).toBe(0);
      expect(
        JSON.parse(
          await readFile(
            path.join(temporary.path, "release-recovery.json"),
            "utf8",
          ),
        ),
      ).toMatchObject({
        releaseId: "700",
        finalEvidenceFileDigest: digest(JSON.stringify(evidence)),
        qualificationFileDigest: digest('{"historical":"qualification"}\n'),
        workflowRuns,
      });
    } finally {
      await temporary.cleanup();
    }
  });

  const invalid: [string, (f: Fixture) => void][] = [
    [
      "foreign repository",
      (f) => {
        publish(f).repository.full_name = "foreign/mill";
      },
    ],
    [
      "wrong workflow",
      (f) => {
        publish(f).workflow_id = 9;
      },
    ],
    [
      "wrong event",
      (f) => {
        publish(f).event = "push";
      },
    ],
    [
      "wrong tag",
      (f) => {
        publish(f).head_branch = "v0.7.0";
      },
    ],
    [
      "wrong source",
      (f) => {
        candidate(f).head_sha = "d".repeat(40);
      },
    ],
    [
      "unfinished run",
      (f) => {
        publish(f).status = "in_progress";
      },
    ],
    [
      "repeated publish attempt",
      (f) => {
        publish(f).run_attempt = 2;
      },
    ],
    [
      "repeated candidate attempt",
      (f) => {
        candidate(f).run_attempt = 2;
      },
    ],
    [
      "wrong job attempt",
      (f) => {
        publishJob(f).run_attempt = 2;
      },
    ],
    [
      "job from another run",
      (f) => {
        publishJob(f).run_id = 90;
      },
    ],
    [
      "missing job page",
      (f) => {
        publishJobs(f).total_count++;
      },
    ],
    [
      "candidate failure",
      (f) => {
        candidate(f).conclusion = "failure";
      },
    ],
    [
      "failed npm publication",
      (f) => {
        publishStep(f, 16).conclusion = "failure";
      },
    ],
    [
      "unfinished npm publication",
      (f) => {
        publishStep(f, 16).status = "in_progress";
      },
    ],
    [
      "failed prior qualification",
      (f) => {
        publishStep(f, 13).conclusion = "failure";
      },
    ],
    [
      "missing readback failure",
      (f) => {
        publishStep(f, 17).conclusion = "success";
      },
    ],
    [
      "GitHub create already attempted",
      (f) => {
        publishStep(f, 19).conclusion = "failure";
      },
    ],
    [
      "duplicate npm step",
      (f) => {
        publishJob(f).steps.push({ ...publishStep(f, 16), number: 23 });
      },
    ],
    [
      "unknown mutation step",
      (f) => {
        publishJob(f).steps.push({
          ...publishStep(f, 16),
          number: 23,
          name: "Another publication",
        });
      },
    ],
    [
      "existing draft on second page",
      (f) => {
        f.input.releasesPages.push([{ id: 90, tag_name: tag, draft: true }]);
      },
    ],
    [
      "existing public release",
      (f) => {
        f.input.releasesPages.push([{ id: 90, tag_name: tag, draft: false }]);
      },
    ],
    [
      "mismatched tag identity",
      (f) => {
        f.identity.tagCommit = controllerCommit;
      },
    ],
    [
      "different candidate consumed",
      (f) => {
        f.log = f.log.replace("CANDIDATE_RUN_ID: 42", "CANDIDATE_RUN_ID: 41");
      },
    ],
    [
      "different candidate downloaded",
      (f) => {
        f.log = f.log.replace("run-id: 42", "run-id: 41");
      },
    ],
    [
      "missing publish log binding",
      (f) => {
        f.log = "";
      },
    ],
    [
      "duplicate candidate log binding",
      (f) => {
        f.log += `\n${f.log}`;
      },
    ],
    [
      "another publication run",
      (f) => {
        const run = {
          ...publish(f),
          id: 45,
          html_url: `https://github.com/${repository}/actions/runs/45`,
        };
        required(f.input.runsPages[0]).workflow_runs.push(run);
        required(f.input.runsPages[0]).total_count++;
        f.input.jobsByRun["45"] = [
          { total_count: 1, jobs: [{ ...publishJob(f), id: 450, run_id: 45 }] },
        ];
      },
    ],
  ];
  it.each(invalid)(
    "rejects %s before writing authority",
    async (_name, mutate) => {
      const temporary = await temporaryDirectory(
        "mill-release-recovery-denial-",
      );
      try {
        const f = fixture();
        mutate(f);
        expect(invoke(await prepare(temporary.path, f)).status).toBe(1);
        await expect(
          readFile(path.join(temporary.path, "workflow-runs.json")),
        ).rejects.toThrow();
      } finally {
        await temporary.cleanup();
      }
    },
  );

  it.each([
    { GITHUB_REF: "refs/tags/v0.7.1" },
    { GITHUB_RUN_ATTEMPT: "2" },
    { GITHUB_WORKFLOW_SHA: sourceCommit },
    {
      GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/other.yml@refs/heads/main`,
    },
  ])("rejects changed controller context %j", async (extraEnv) => {
    const temporary = await temporaryDirectory(
      "mill-release-recovery-context-",
    );
    try {
      expect(
        invoke(await prepare(temporary.path, fixture()), extraEnv).status,
      ).toBe(1);
    } finally {
      await temporary.cleanup();
    }
  });

  it("checks the fresh complete release inventory and exact registry bytes", async () => {
    const temporary = await temporaryDirectory("mill-release-recovery-bytes-");
    try {
      const f = fixture();
      await prepare(temporary.path, f);
      const inventory = path.join(temporary.path, "releases.json");
      await writeFile(
        inventory,
        JSON.stringify([[], [{ id: 7, tag_name: tag, draft: true }]]),
      );
      expect(invoke(["absent", inventory, tag]).status).toBe(1);
      await writeFile(
        inventory,
        JSON.stringify([[{ id: 6, tag_name: "v0.7.0", draft: false }]]),
      );
      expect(invoke(["absent", inventory, tag]).status).toBe(0);
      const registry = path.join(temporary.path, "registry");
      await mkdir(registry);
      const artifact = path.join(registry, "mill.tgz");
      await writeFile(artifact, f.artifact);
      expect(
        invoke([
          "registry",
          path.join(temporary.path, "metadata.json"),
          registry,
        ]).status,
      ).toBe(0);
      await writeFile(artifact, "different registry package");
      expect(
        invoke([
          "registry",
          path.join(temporary.path, "metadata.json"),
          registry,
        ]).status,
      ).toBe(1);
    } finally {
      await temporary.cleanup();
    }
  });

  it("retains only necessary provider observations and keeps raw job logs private", async () => {
    const temporary = await temporaryDirectory(
      "mill-release-recovery-observe-",
    );
    try {
      const f = fixture();
      const root = `repos/${repository}/`;
      const privateValue = "PRIVATE_UNNEEDED_PROVIDER_FIELD";
      const responses: Record<string, unknown> = {
        [`${root}actions/workflows/release.yml`]: {
          ...f.input.workflow,
          url: privateValue,
        },
        [`${root}actions/workflows/release.yml/runs?event=workflow_dispatch&branch=${tag}&per_page=100`]:
          f.input.runsPages.map((page) => ({
            ...page,
            workflow_runs: page.workflow_runs.map((run) => ({
              ...run,
              actor: { email: privateValue },
              head_commit: { message: privateValue },
            })),
          })),
        [`${root}releases?per_page=100`]: [
          [
            {
              id: 1,
              tag_name: "v0.7.0",
              draft: false,
              body: privateValue,
              author: { email: privateValue },
            },
          ],
        ],
        [`${root}actions/jobs/430/logs`]: `${f.log}\n${privateValue}\n`,
      };
      for (const [id, pages] of Object.entries(f.input.jobsByRun))
        responses[`${root}actions/runs/${id}/attempts/1/jobs?per_page=100`] =
          pages.map((page) => ({
            ...page,
            jobs: page.jobs.map((job) => ({
              ...job,
              runner_name: privateValue,
            })),
          }));
      const responsesFile = path.join(temporary.path, "api.json");
      await writeFile(responsesFile, JSON.stringify(responses));
      await writeFile(
        path.join(temporary.path, "gh"),
        `#!/usr/bin/env node
const fs=require("node:fs");
const values=JSON.parse(fs.readFileSync(process.env.TEST_API_FILE,"utf8"));
const value=values[process.argv.at(-1)];
if(value===undefined)process.exit(9);
process.stdout.write(typeof value==="string"?value:JSON.stringify(value));
`,
        { mode: 0o755 },
      );
      const result = invoke(["observe", tag, "42", "43", temporary.path], {
        PATH: `${temporary.path}${path.delimiter}${process.env.PATH ?? ""}`,
        TEST_API_FILE: responsesFile,
      });
      expect(result.status, result.stderr).toBe(0);
      for (const name of [
        "recovery-observations.json",
        "candidate-run.json",
        "candidate-jobs.json",
        "publish-run.json",
      ])
        expect(
          await readFile(path.join(temporary.path, name), "utf8"),
        ).not.toContain(privateValue);
      expect(
        await readFile(path.join(temporary.path, "publish-job.log"), "utf8"),
      ).toContain(privateValue);
      await writeFile(
        path.join(temporary.path, "identity.json"),
        JSON.stringify(f.identity),
      );
      await writeFile(
        path.join(temporary.path, "metadata.json"),
        JSON.stringify(f.metadata),
      );
      const validated = invoke([
        "validate",
        temporary.path,
        path.join(temporary.path, "identity.json"),
        path.join(temporary.path, "metadata.json"),
      ]);
      expect(validated.status, validated.stderr).toBe(0);
      expect(
        await readFile(
          path.join(temporary.path, "recovery-source.json"),
          "utf8",
        ),
      ).not.toContain(privateValue);
    } finally {
      await temporary.cleanup();
    }
  });

  it("rejects changed final source, artifact and original workflow identities", async () => {
    const temporary = await temporaryDirectory(
      "mill-release-recovery-final-denial-",
    );
    try {
      const f = fixture();
      const validated = invoke(await prepare(temporary.path, f));
      expect(validated.status, validated.stderr).toBe(0);
      const workflows: unknown = JSON.parse(
        await readFile(path.join(temporary.path, "workflow-runs.json"), "utf8"),
      );
      const evidence = {
        state: "verified",
        package: { tag },
        source: {
          tagCommit: sourceCommit,
          resultingMainCommit: sourceCommit,
          resultingMainTree: f.identity.mainTree,
          reviewedCandidateTree: f.identity.mainTree,
        },
        selectedArtifact: f.metadata.selectedArtifact,
        workflowRuns: workflows,
        githubRelease: { state: "published", releaseId: "700" },
      };
      const file = path.join(temporary.path, "final.json");
      const qualification = path.join(temporary.path, "qualification.json");
      await writeFile(qualification, "{}");
      for (const mutation of [
        { source: { ...evidence.source, tagCommit: controllerCommit } },
        {
          selectedArtifact: {
            ...f.metadata.selectedArtifact,
            sha256: digest("different"),
          },
        },
        {
          workflowRuns: { publish: { id: "44", headCommit: controllerCommit } },
        },
        { githubRelease: { state: "draft", releaseId: "700" } },
      ]) {
        await writeFile(file, JSON.stringify({ ...evidence, ...mutation }));
        expect(
          invoke(["finalize", temporary.path, file, qualification]).status,
        ).toBe(1);
      }
      await expect(
        readFile(path.join(temporary.path, "release-recovery.json")),
      ).rejects.toThrow();
    } finally {
      await temporary.cleanup();
    }
  });

  it("protects recovery while keeping publication and model credentials out of package checks", async () => {
    const text = await readFile(
      ".github/workflows/release-recovery.yml",
      "utf8",
    );
    const workflow = parse(text) as {
      on: Record<string, unknown>;
      concurrency: unknown;
      permissions: Record<string, string>;
      jobs: {
        finalize: {
          if: string;
          environment: string;
          permissions: Record<string, string>;
          env: Record<string, string>;
          steps: {
            name: string;
            run?: string;
            if?: unknown;
            "continue-on-error"?: unknown;
            uses?: string;
            env?: Record<string, string>;
            with?: Record<string, unknown>;
          }[];
        };
      };
    };
    const job = workflow.jobs.finalize;
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
    expect(workflow.concurrency).toEqual({
      group: "release-${{ inputs.tag }}",
      "cancel-in-progress": false,
    });
    expect(job.environment).toBe("npm");
    expect(job.if).toBe(
      "github.ref == 'refs/heads/main' && github.repository == 'davidahmann/mill'",
    );
    expect(job.permissions).toEqual({ actions: "read", contents: "write" });
    expect(workflow.permissions).toEqual({ actions: "read", contents: "read" });
    expect(job.env).not.toHaveProperty("GH_TOKEN");
    expect(text).not.toMatch(/npm publish|npm dist-tag|id-token:|--clobber/u);
    const steps = job.steps;
    const index = (name: string) =>
      steps.findIndex((step) => step.name === name);
    const create = index("Create draft GitHub Release with exact artifacts");
    expect(create).toBeGreaterThan(
      index("Read back npm and verify signatures"),
    );
    expect(create).toBeGreaterThan(
      index("Requalify the registry-downloaded package"),
    );
    const createSource = required(steps[create]).run ?? "";
    expect(
      createSource.indexOf(
        ' absent "$RUNNER_TEMP/releases-before-create.json"',
      ),
    ).toBeGreaterThanOrEqual(0);
    expect(
      createSource.indexOf(
        ' absent "$RUNNER_TEMP/releases-before-create.json"',
      ),
    ).toBeLessThan(createSource.indexOf("gh release create"));
    expect(createSource).toContain("--paginate --slurp");
    expect(
      required(steps[index("Requalify the registry-downloaded package")]).run,
    ).toContain("--full-canary");
    for (const name of [
      "Read back npm and verify signatures",
      "Requalify the registry-downloaded package",
      "Install tagged tools without lifecycle scripts",
    ])
      expect(required(steps[index(name)]).env).toBeUndefined();
    for (const step of steps) {
      expect(step.if).toBeUndefined();
      expect(step["continue-on-error"]).toBeUndefined();
    }
    expect(
      required(steps[index("Checkout approved recovery controller")]).with,
    ).toMatchObject({
      ref: "${{ github.sha }}",
      path: "controller",
      "persist-credentials": false,
    });
    expect(
      required(steps[index("Checkout immutable release source separately")])
        .with,
    ).toMatchObject({
      ref: "${{ inputs.tag }}",
      path: "release-source",
      "persist-credentials": false,
    });
    expect(text.match(/GITHUB_SHA="\$tag_commit"/gu)).toHaveLength(1);
    expect(text.match(/gh release create/gu)).toHaveLength(1);
    expect(text).toContain('cmp "$RUNNER_TEMP/release-recovery.json"');
  });
});
