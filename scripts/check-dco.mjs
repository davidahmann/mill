import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const dependabotLogin = "dependabot[bot]";
const dependabotSignoff = "support@github.com";

function signoffs(message) {
  return [...message.matchAll(/^Signed-off-by:\s+.+\s+<([^>]+)>\s*$/gimu)].map(
    (match) => (match[1] ?? "").toLowerCase(),
  );
}

function humanCommitSigned(commit) {
  return signoffs(commit.message).includes(commit.authorEmail.toLowerCase());
}

function failUnsigned(commits) {
  const unsigned = commits
    .filter((commit) => !humanCommitSigned(commit))
    .map((commit) => commit.sha);
  if (unsigned.length > 0) {
    throw new Error(
      `DCO sign-off missing from commits: ${unsigned.join(", ")}`,
    );
  }
  process.stdout.write(`DCO check passed for ${commits.length} commit(s)\n`);
}

function localCommits(base, head) {
  const result = spawnSync(
    "/usr/bin/git",
    [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "core.fsmonitor=false",
      "log",
      "--format=%H%x00%ae%x00%B%x00",
      `${base}..${head}`,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_OPTIONAL_LOCKS: "0",
      },
      timeout: 10_000,
    },
  );
  if (result.status !== 0) {
    throw new Error(`unable to read PR commits: ${result.stderr}`);
  }
  const fields = result.stdout.replace(/\0\n?$/u, "").split(/\0\n?/u);
  return Array.from({ length: Math.floor(fields.length / 3) }, (_, index) => ({
    sha: fields[index * 3] ?? "unknown",
    authorEmail: fields[index * 3 + 1] ?? "",
    message: fields[index * 3 + 2] ?? "",
  }));
}

function isBotAccount(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    value.login === dependabotLogin &&
    value.type === "Bot"
  );
}

function isGitHubAccount(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof value.login === "string" &&
    typeof value.type === "string"
  );
}

function verifiedDependabotCommit(value, head) {
  if (typeof value !== "object" || value === null) return false;
  const commit = value;
  const metadata = commit.commit;
  return (
    typeof commit.sha === "string" &&
    commit.sha === head &&
    isBotAccount(commit.author) &&
    isBotAccount(commit.committer) &&
    typeof metadata === "object" &&
    metadata !== null &&
    typeof metadata.message === "string" &&
    signoffs(metadata.message).includes(dependabotSignoff) &&
    typeof metadata.verification === "object" &&
    metadata.verification !== null &&
    metadata.verification.verified === true &&
    metadata.verification.reason === "valid"
  );
}

async function githubDco(eventPath, commitsPath) {
  const event = JSON.parse(await readFile(eventPath, "utf8"));
  const pull = event?.pull_request;
  const repository = event?.repository?.full_name;
  const number = event?.number ?? pull?.number;
  const head = pull?.head?.sha;
  if (
    typeof repository !== "string" ||
    !Number.isInteger(number) ||
    typeof head !== "string" ||
    !isGitHubAccount(pull?.user)
  ) {
    throw new Error(
      "Dependabot provenance rejected: malformed pull-request event",
    );
  }
  let commits;
  if (commitsPath !== undefined) {
    commits = JSON.parse(await readFile(commitsPath, "utf8"));
  } else {
    const token = process.env.GITHUB_TOKEN;
    if (token === undefined || token.length === 0)
      throw new Error(
        "Dependabot provenance rejected: GitHub token unavailable",
      );
    const endpoint = new URL(
      `/repos/${repository}/pulls/${number}/commits?per_page=100`,
      "https://api.github.com",
    );
    const response = await fetch(endpoint, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
      },
    });
    if (!response.ok)
      throw new Error(
        `Dependabot provenance rejected: GitHub commit read failed (${response.status})`,
      );
    if (response.headers.get("link")?.includes('rel="next"'))
      throw new Error(
        "DCO check rejected: pull request exceeds the 100-commit review limit",
      );
    commits = await response.json();
  }
  if (!Array.isArray(commits) || commits.length === 0) {
    throw new Error("DCO check rejected: pull request has no readable commits");
  }
  if (isBotAccount(pull.user)) {
    if (commits.length !== 1 || !verifiedDependabotCommit(commits[0], head)) {
      throw new Error(
        "Dependabot provenance rejected: PR commits do not match the verified bot exception",
      );
    }
    process.stdout.write(
      "Dependabot DCO check passed for 1 verified bot commit\n",
    );
    return;
  }
  const humanCommits = commits.map((value) => {
    if (typeof value !== "object" || value === null) {
      throw new Error("DCO check rejected: malformed pull-request commit");
    }
    const commit = value;
    const metadata = commit.commit;
    const author =
      typeof metadata === "object" && metadata !== null
        ? metadata.author
        : undefined;
    if (
      typeof commit.sha !== "string" ||
      typeof metadata !== "object" ||
      metadata === null ||
      typeof metadata.message !== "string" ||
      typeof author !== "object" ||
      author === null ||
      typeof author.email !== "string"
    ) {
      throw new Error("DCO check rejected: malformed pull-request commit");
    }
    return {
      sha: commit.sha,
      authorEmail: author.email,
      message: metadata.message,
    };
  });
  if (humanCommits.at(-1)?.sha !== head) {
    throw new Error(
      "DCO check rejected: pull-request commits do not match the event head",
    );
  }
  failUnsigned(humanCommits);
}

const arguments_ = process.argv.slice(2);
if (arguments_[0] === "--github-event") {
  const eventPath = arguments_[1];
  const commitsFlag = arguments_[2];
  const commitsPath = arguments_[3];
  if (
    eventPath === undefined ||
    (commitsFlag !== undefined &&
      (commitsFlag !== "--commits-file" || commitsPath === undefined)) ||
    arguments_.length > (commitsFlag === undefined ? 2 : 4)
  ) {
    throw new Error(
      "usage: check-dco.mjs --github-event <event.json> [--commits-file <commits.json>]",
    );
  }
  await githubDco(eventPath, commitsPath);
} else {
  const [base, head] = arguments_;
  if (base === undefined || head === undefined || arguments_.length !== 2) {
    throw new Error("usage: check-dco.mjs <base-sha> <head-sha>");
  }
  failUnsigned(localCommits(base, head));
}
