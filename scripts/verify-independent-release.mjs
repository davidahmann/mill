import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const [directory, receiptPath, runPath, jobsPath, identityPath] =
  process.argv.slice(2);
if (
  [directory, receiptPath, runPath, jobsPath, identityPath].some(
    (value) => value === undefined,
  )
)
  throw new Error(
    "expected artifact directory, trusted receipt, candidate run, jobs and tag identity",
  );
const read = async (file) => JSON.parse(await readFile(file, "utf8"));
const [receipt, run, pages, identity] = await Promise.all([
  read(receiptPath),
  read(runPath),
  read(jobsPath),
  read(identityPath),
]);
const artifacts = (await readdir(directory)).filter((file) =>
  file.endsWith(".tgz"),
);
if (artifacts.length !== 1)
  throw new Error("expected exactly one preserved tarball");
const digest = async (file) =>
  `sha256:${createHash("sha256")
    .update(await readFile(file))
    .digest("hex")}`;
const jobs = pages.flatMap((page) => page.jobs ?? []);
if (
  receipt.schemaVersion !== "1" ||
  receipt.verifierCommit !== "c547762d7644f62ac48011089564f5f46a48b786" ||
  receipt.artifactDigest !==
    (await digest(path.join(directory, artifacts[0]))) ||
  receipt.qualificationDigest !==
    (await digest(path.join(directory, "qualification.json")))
)
  throw new Error("independent verifier identity or artifact binding mismatch");
if (
  run.conclusion !== "success" ||
  run.event !== "workflow_dispatch" ||
  run.path !== ".github/workflows/release.yml" ||
  run.head_sha !== identity.tagCommit ||
  run.repository?.full_name !== process.env.GITHUB_REPOSITORY
)
  throw new Error(
    "candidate run is not the successful exact-tag release workflow",
  );
for (const name of [
  "build-a",
  "build-b",
  "qualify-candidate",
  "independent-release-policy",
]) {
  const matching = jobs.filter(
    (job) =>
      job.name === name &&
      job.run_id === run.id &&
      job.head_sha === run.head_sha,
  );
  if (matching.length !== 1 || matching[0].conclusion !== "success")
    throw new Error(`missing successful exact-run job: ${name}`);
}
process.stdout.write(
  "independent release policy and preserved artifact verified\n",
);
