import { appendFile, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const reference = process.env.MILL_RELEASE_TAG ?? process.env.GITHUB_REF_NAME;
if (
  reference === undefined ||
  !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(reference)
) {
  throw new Error("release requires an explicit SemVer v-prefixed tag");
}

function git(args) {
  const result = spawnSync(
    "/usr/bin/git",
    [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "diff.external=",
      ...args,
    ],
    {
      encoding: "utf8",
      env: {
        HOME: "/var/empty",
        LANG: "C",
        LC_ALL: "C",
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_NO_REPLACE_OBJECTS: "1",
        GIT_OPTIONAL_LOCKS: "0",
      },
      timeout: 30_000,
    },
  );
  if (result.status !== 0) {
    throw new Error(`git ${args[0] ?? ""} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
if (packageJson.version !== reference.slice(1)) {
  throw new Error(
    `package version ${String(packageJson.version)} does not match tag ${reference}`,
  );
}
if (packageJson.version === "0.0.0-development") {
  throw new Error("development version cannot be published");
}

const tagType = git(["cat-file", "-t", `refs/tags/${reference}`]);
if (tagType !== "tag") {
  throw new Error("genesis release requires an annotated tag");
}
const headCommit = git(["rev-parse", "HEAD^{commit}"]);
const tagCommit = git(["rev-parse", `refs/tags/${reference}^{commit}`]);
const mainTree = git(["rev-parse", `${headCommit}^{tree}`]);
if (tagCommit !== headCommit) {
  throw new Error("checked-out commit does not equal the annotated tag target");
}
if (
  process.env.GITHUB_SHA !== undefined &&
  process.env.GITHUB_SHA !== headCommit
) {
  throw new Error("GitHub workflow SHA does not equal the release tag target");
}
try {
  git(["merge-base", "--is-ancestor", headCommit, "refs/remotes/origin/main"]);
} catch {
  throw new Error("release tag target is not contained in origin/main");
}
const tagBody = git([
  "for-each-ref",
  "--format=%(contents)",
  `refs/tags/${reference}`,
]);
const reviewedTreeMatches = [
  ...tagBody.matchAll(/^Reviewed-Candidate-Tree:\s*([a-f0-9]{40})\s*$/gmu),
];
if (reviewedTreeMatches.length !== 1) {
  throw new Error(
    "annotated tag must contain exactly one Reviewed-Candidate-Tree trailer",
  );
}
const reviewedCandidateTree = reviewedTreeMatches[0]?.[1];
if (reviewedCandidateTree !== mainTree) {
  throw new Error(
    "reviewed candidate tree does not equal the tagged main tree",
  );
}

const result = {
  packageName: packageJson.name,
  version: packageJson.version,
  tag: reference,
  tagCommit,
  mainTree,
  reviewedCandidateTree,
};
if (process.env.GITHUB_OUTPUT !== undefined) {
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `${Object.entries(result)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join("\n")}\n`,
  );
}
process.stdout.write(`${JSON.stringify(result)}\n`);
