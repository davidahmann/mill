import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const bot = "dependabot[bot]";
const alias = "support@github.com";
const githubRebaseService = "web-flow";
const trailers = (message) =>
  [...message.matchAll(/^Signed-off-by:\s+.+\s+<([^>]+)>\s*$/gimu)].map(
    (match) => (match[1] ?? "").toLowerCase(),
  );
const botAccount = (value) =>
  typeof value === "object" &&
  value !== null &&
  value.login === bot &&
  value.type === "Bot";
const account = (value) =>
  typeof value === "object" &&
  value !== null &&
  typeof value.login === "string" &&
  typeof value.type === "string";
const trustedBotCommitter = (value) =>
  botAccount(value) ||
  (typeof value === "object" &&
    value !== null &&
    value.login === githubRebaseService &&
    value.type === "User");

function local(base, head) {
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
  if (result.status !== 0)
    throw new Error(`unable to read PR commits: ${result.stderr}`);
  const fields = result.stdout.replace(/\0\n?$/u, "").split(/\0\n?/u);
  const unsigned = [];
  for (let index = 0; index < fields.length; index += 3) {
    if (
      !trailers(fields[index + 2] ?? "").includes(
        (fields[index + 1] ?? "").toLowerCase(),
      )
    )
      unsigned.push(fields[index] ?? "unknown");
  }
  if (unsigned.length > 0)
    throw new Error(
      `DCO sign-off missing from commits: ${unsigned.join(", ")}`,
    );
}

async function github(eventPath) {
  const event = JSON.parse(await readFile(eventPath, "utf8"));
  const pull = event?.pull_request;
  if (
    !account(pull?.user) ||
    typeof event?.repository?.full_name !== "string" ||
    !Number.isInteger(event?.number) ||
    typeof pull?.head?.sha !== "string"
  ) {
    throw new Error(
      "Dependabot provenance rejected: malformed pull-request event",
    );
  }
  const token = process.env.GITHUB_TOKEN;
  if (token === undefined || token.length === 0)
    throw new Error("Dependabot provenance rejected: GitHub token unavailable");
  const response = await fetch(
    new URL(
      `/repos/${event.repository.full_name}/pulls/${event.number}/commits?per_page=100`,
      "https://api.github.com",
    ),
    {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
      },
    },
  );
  if (!response.ok)
    throw new Error(
      `DCO check rejected: GitHub commit read failed (${response.status})`,
    );
  if (response.headers.get("link")?.includes('rel="next"'))
    throw new Error(
      "DCO check rejected: pull request exceeds the 100-commit review limit",
    );
  const commits = await response.json();
  if (!Array.isArray(commits) || commits.length === 0) {
    throw new Error("DCO check rejected: pull request has no readable commits");
  }
  if (botAccount(pull.user)) {
    const commit = commits.length === 1 ? commits[0] : undefined;
    if (!(
      commit?.sha === pull.head.sha &&
      botAccount(commit.author) &&
      trustedBotCommitter(commit.committer) &&
      trailers(commit?.commit?.message ?? "").includes(alias) &&
      commit?.commit?.verification?.verified === true &&
      commit?.commit?.verification?.reason === "valid"
    )) {
      throw new Error(
        "Dependabot provenance rejected: PR commits do not match the verified bot exception",
      );
    }
    return;
  }
  const unsigned = commits
    .map((commit) => ({
      sha: commit?.sha,
      email: commit?.commit?.author?.email,
      message: commit?.commit?.message,
    }))
    .filter(
      (commit) =>
        typeof commit.sha !== "string" ||
        typeof commit.email !== "string" ||
        typeof commit.message !== "string" ||
        !trailers(commit.message).includes(commit.email.toLowerCase()),
    )
    .map((commit) => commit.sha ?? "unknown");
  if (commits.at(-1)?.sha !== pull.head.sha) {
    throw new Error(
      "DCO check rejected: pull-request commits do not match the event head",
    );
  }
  if (unsigned.length > 0) {
    throw new Error(
      `DCO sign-off missing from commits: ${unsigned.join(", ")}`,
    );
  }
}

const arguments_ = process.argv.slice(2);
if (arguments_[0] === "--github-event" && arguments_.length === 2)
  await github(arguments_[1]);
else if (arguments_.length === 2) local(arguments_[0], arguments_[1]);
else
  throw new Error(
    "usage: check-dco.mjs <base-sha> <head-sha> | --github-event <event.json>",
  );
