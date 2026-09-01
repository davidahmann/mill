import path from "node:path";

import type { MillConfig } from "./inputs.js";
import { findTrustedExecutable } from "../doctor.js";
import { ExitCode, MillError } from "../errors.js";
import { runProcess } from "./process.js";

export type ProposeConfig = NonNullable<MillConfig["propose"]>;

export interface GitHubBinding {
  actorLogin: string;
  actorId: number;
  repositoryNodeId: string;
  fullName: string;
  cloneUrl: string;
  defaultBranch: string;
  fork: boolean;
}

export interface GitHubPullRequest {
  number: number;
  nodeId: string;
  url: string;
  state: "open" | "closed";
  draft: boolean;
  body: string;
  headRef: string;
  headSha: string;
  baseRef: string;
  merged: boolean;
  mergeCommitSha: string | null;
  mergedByLogin: string | null;
  mergedAt: string | null;
}

export interface GitHubCheck {
  name: string;
  status: string;
  conclusion: string | null;
}

export interface GitHubReview {
  id: string;
  actorLogin: string;
  state: string;
  commitId: string | null;
  body: string;
  url: string;
}

export interface GitHubFeedback {
  id: string;
  actorLogin: string;
  priority: "P0" | "P1" | "P2" | "P3" | "unclassified";
  body: string;
  path: string | null;
  line: number | null;
  url: string;
  commitId: string;
}

export interface GitHubCommit {
  sha: string;
  tree: string;
  parents: readonly string[];
}

export interface GitHubObservation {
  pullRequest: GitHubPullRequest;
  branchSha: string | null;
  checks: readonly GitHubCheck[];
  mergeChecks: readonly GitHubCheck[];
  reviews: readonly GitHubReview[];
  feedback: readonly GitHubFeedback[];
  defaultBranchHead: string;
  mergeCommit: GitHubCommit | null;
  mergeIsOnDefaultBranch: boolean;
}

export interface GitHubAdapter {
  inspect(input: {
    config: ProposeConfig;
    deadlineMs: number;
    signal?: AbortSignal;
  }): Promise<GitHubBinding>;
  readBranch(input: {
    config: ProposeConfig;
    branch: string;
    deadlineMs: number;
    signal?: AbortSignal;
  }): Promise<string | null>;
  pushExact(input: {
    root: string;
    config: ProposeConfig;
    cloneUrl: string;
    branch: string;
    candidateCommit: string;
    expectedOldCommit: string | null;
    deadlineMs: number;
    signal?: AbortSignal;
    cancellationRequested?: () => boolean;
  }): Promise<void>;
  findPullRequests(input: {
    config: ProposeConfig;
    branch: string;
    deadlineMs: number;
    signal?: AbortSignal;
  }): Promise<readonly GitHubPullRequest[]>;
  createDraftPullRequest(input: {
    config: ProposeConfig;
    branch: string;
    title: string;
    body: string;
    deadlineMs: number;
    signal?: AbortSignal;
    cancellationRequested?: () => boolean;
  }): Promise<GitHubPullRequest>;
  observe(input: {
    config: ProposeConfig;
    pullRequestNumber: number;
    deadlineMs: number;
    signal?: AbortSignal;
  }): Promise<GitHubObservation>;
}

interface ProcessLifecycle {
  deadlineMs: number;
  signal?: AbortSignal;
  cancellationRequested?: () => boolean;
}

function commandEnvironment(): NodeJS.ProcessEnv {
  return {
    HOME: process.env.HOME,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    GH_CONFIG_DIR: process.env.GH_CONFIG_DIR,
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin",
    LANG: "C",
    LC_ALL: "C",
    GH_PROMPT_DISABLED: "1",
    GH_NO_UPDATE_NOTIFIER: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    GIT_PAGER: "cat",
    PAGER: "cat",
  };
}

function assertSha(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/u.test(value)) {
    throw new MillError(
      "INVALID_GITHUB_RESPONSE",
      `GitHub returned an invalid ${label}.`,
      ExitCode.data,
    );
  }
  return value;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new MillError(
      "INVALID_GITHUB_RESPONSE",
      `GitHub returned an invalid ${label}.`,
      ExitCode.data,
    );
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new MillError(
      "INVALID_GITHUB_RESPONSE",
      `GitHub returned an invalid ${label}.`,
      ExitCode.data,
    );
  }
  return value;
}

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new MillError(
      "INVALID_GITHUB_RESPONSE",
      `GitHub returned an invalid ${label}.`,
      ExitCode.data,
    );
  }
  return value as number;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new MillError(
      "INVALID_GITHUB_RESPONSE",
      `GitHub returned an invalid ${label}.`,
      ExitCode.data,
    );
  }
  return value;
}

function parsePullRequest(
  value: unknown,
  requireMergedFlag: boolean,
): GitHubPullRequest {
  const item = object(value, "pull request");
  const head = object(item.head, "pull request head");
  const base = object(item.base, "pull request base");
  const state = item.state;
  if (state !== "open" && state !== "closed") {
    throw new MillError(
      "INVALID_GITHUB_RESPONSE",
      "GitHub returned an invalid pull request state.",
      ExitCode.data,
    );
  }
  return {
    number: integer(item.number, "pull request number"),
    nodeId: text(item.node_id, "pull request node ID"),
    url: text(item.html_url, "pull request URL"),
    state,
    draft: boolean(item.draft, "pull request draft flag"),
    body: typeof item.body === "string" ? item.body : "",
    headRef: text(head.ref, "pull request head ref"),
    headSha: assertSha(head.sha, "pull request head SHA"),
    baseRef: text(base.ref, "pull request base ref"),
    merged:
      item.merged === undefined && !requireMergedFlag
        ? false
        : boolean(item.merged, "pull request merged flag"),
    mergeCommitSha:
      item.merge_commit_sha === null
        ? null
        : assertSha(item.merge_commit_sha, "merge commit SHA"),
    mergedByLogin:
      item.merged_by === null || item.merged_by === undefined
        ? null
        : text(
            object(item.merged_by, "merge actor").login,
            "merge actor login",
          ),
    mergedAt:
      item.merged_at === null || item.merged_at === undefined
        ? null
        : text(item.merged_at, "merge timestamp"),
  };
}

function priority(body: string): GitHubFeedback["priority"] {
  const match = /(?:\[|\b)(P[0-3])(?:\]|\b)/iu.exec(body);
  return (
    (match?.[1]?.toUpperCase() as GitHubFeedback["priority"] | undefined) ??
    "unclassified"
  );
}

function parseChecks(checkValue: unknown, statusValue: unknown): GitHubCheck[] {
  const checksObject = object(checkValue, "check runs");
  const checkRuns = Array.isArray(checksObject.check_runs)
    ? checksObject.check_runs
    : [];
  const statusObject = object(statusValue, "commit statuses");
  const statuses = Array.isArray(statusObject.statuses)
    ? statusObject.statuses
    : [];
  return [
    ...checkRuns.map((raw) => {
      const item = object(raw, "check run");
      return {
        name: text(item.name, "check name"),
        status: text(item.status, "check status"),
        conclusion:
          item.conclusion === null
            ? null
            : text(item.conclusion, "check conclusion"),
      };
    }),
    ...statuses.map((raw) => {
      const item = object(raw, "commit status");
      const state = text(item.state, "commit status state");
      return {
        name: text(item.context, "commit status context"),
        status: state === "pending" ? "in_progress" : "completed",
        conclusion: state === "success" ? "success" : state,
      };
    }),
  ];
}

function paginatedArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new MillError(
      "INVALID_GITHUB_RESPONSE",
      `GitHub returned invalid paginated ${label}.`,
      ExitCode.data,
    );
  }
  const items: unknown[] = [];
  for (const page of value) {
    if (!Array.isArray(page)) {
      throw new MillError(
        "INVALID_GITHUB_RESPONSE",
        `GitHub returned an invalid ${label} page.`,
        ExitCode.data,
      );
    }
    items.push(...(page as unknown[]));
  }
  return items;
}

function paginatedObjectCollection(
  value: unknown,
  property: string,
  label: string,
): Record<string, unknown> {
  if (!Array.isArray(value)) {
    throw new MillError(
      "INVALID_GITHUB_RESPONSE",
      `GitHub returned invalid paginated ${label}.`,
      ExitCode.data,
    );
  }
  const items: unknown[] = [];
  for (const rawPage of value) {
    const page = object(rawPage, `${label} page`);
    const values = page[property];
    if (!Array.isArray(values)) {
      throw new MillError(
        "INVALID_GITHUB_RESPONSE",
        `GitHub returned an invalid ${label} collection.`,
        ExitCode.data,
      );
    }
    items.push(...(values as unknown[]));
  }
  return { [property]: items };
}

class GhGitHubAdapter implements GitHubAdapter {
  readonly #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  async #ghJson(
    args: readonly string[],
    lifecycle: ProcessLifecycle,
    allowNotFound = false,
  ): Promise<unknown> {
    const gh = await findTrustedExecutable("gh", this.#root);
    if (gh === undefined) {
      throw new MillError(
        "GH_UNAVAILABLE",
        "A trusted gh executable is required for GitHub operations.",
        ExitCode.unavailable,
      );
    }
    const result = await runProcess({
      executable: gh,
      args,
      cwd: this.#root,
      env: commandEnvironment(),
      deadlineMs: lifecycle.deadlineMs,
      maxOutputBytes: 4 * 1024 * 1024,
      ...(lifecycle.signal === undefined ? {} : { signal: lifecycle.signal }),
      ...(lifecycle.cancellationRequested === undefined
        ? {}
        : { cancellationRequested: lifecycle.cancellationRequested }),
    });
    if (
      allowNotFound &&
      result.exitCode !== 0 &&
      /HTTP 404/iu.test(result.stderr)
    ) {
      return null;
    }
    if (result.timedOut || result.cancelled || result.outputExceeded) {
      throw new MillError(
        result.cancelled
          ? "GITHUB_CANCELLED"
          : result.timedOut
            ? "GITHUB_DEADLINE_EXCEEDED"
            : "GITHUB_OUTPUT_BUDGET_EXCEEDED",
        "The GitHub operation did not complete within its approved bounds.",
        ExitCode.temporary,
      );
    }
    if (result.exitCode !== 0) {
      throw new MillError(
        "GITHUB_CALL_FAILED",
        "The GitHub operation failed without a verified effect receipt.",
        ExitCode.temporary,
        { exitCode: result.exitCode },
      );
    }
    try {
      return JSON.parse(result.stdout) as unknown;
    } catch (error) {
      throw new MillError(
        "INVALID_GITHUB_RESPONSE",
        "GitHub returned invalid JSON.",
        ExitCode.data,
        { cause: String(error) },
      );
    }
  }

  async inspect(input: {
    config: ProposeConfig;
    deadlineMs: number;
    signal?: AbortSignal;
  }): Promise<GitHubBinding> {
    const lifecycle = {
      deadlineMs: input.deadlineMs,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    };
    const [actorValue, repositoryValue] = await Promise.all([
      this.#ghJson(["api", "--hostname", input.config.host, "user"], lifecycle),
      this.#ghJson(
        [
          "api",
          "--hostname",
          input.config.host,
          `repos/${input.config.owner}/${input.config.repository}`,
        ],
        lifecycle,
      ),
    ]);
    const actor = object(actorValue, "actor");
    const repository = object(repositoryValue, "repository");
    return {
      actorLogin: text(actor.login, "actor login"),
      actorId: integer(actor.id, "actor ID"),
      repositoryNodeId: text(repository.node_id, "repository node ID"),
      fullName: text(repository.full_name, "repository full name"),
      cloneUrl: text(repository.clone_url, "repository clone URL"),
      defaultBranch: text(repository.default_branch, "default branch"),
      fork: boolean(repository.fork, "repository fork flag"),
    };
  }

  async readBranch(input: {
    config: ProposeConfig;
    branch: string;
    deadlineMs: number;
    signal?: AbortSignal;
  }): Promise<string | null> {
    const value = await this.#ghJson(
      [
        "api",
        "--hostname",
        input.config.host,
        `repos/${input.config.owner}/${input.config.repository}/git/ref/heads/${encodeURIComponent(input.branch)}`,
      ],
      {
        deadlineMs: input.deadlineMs,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      },
      true,
    );
    if (value === null) return null;
    return assertSha(
      object(object(value, "branch ref").object, "branch object").sha,
      "branch SHA",
    );
  }

  async pushExact(input: {
    root: string;
    config: ProposeConfig;
    cloneUrl: string;
    branch: string;
    candidateCommit: string;
    expectedOldCommit: string | null;
    deadlineMs: number;
    signal?: AbortSignal;
    cancellationRequested?: () => boolean;
  }): Promise<void> {
    if (!/^mill\/[A-Za-z0-9._-]+$/u.test(input.branch)) {
      throw new MillError(
        "INVALID_DELIVERY_BRANCH",
        "The delivery branch is outside Mill's fixed branch namespace.",
        ExitCode.configuration,
      );
    }
    const expectedClone = `https://${input.config.host}/${input.config.owner}/${input.config.repository}.git`;
    if (input.cloneUrl !== expectedClone) {
      throw new MillError(
        "GITHUB_REPOSITORY_BINDING_MISMATCH",
        "GitHub clone URL does not match the approved repository identity.",
        ExitCode.configuration,
      );
    }
    const [git, gh] = await Promise.all([
      findTrustedExecutable("git", input.root),
      findTrustedExecutable("gh", input.root),
    ]);
    if (git === undefined || gh === undefined) {
      throw new MillError(
        "SHIPPER_TOOL_UNAVAILABLE",
        "Trusted git and gh executables are required for an exact push.",
        ExitCode.unavailable,
      );
    }
    if (!/^[A-Za-z0-9_./ -]+$/u.test(gh)) {
      throw new MillError(
        "UNSAFE_GH_EXECUTABLE_PATH",
        "The gh executable path cannot be represented safely as a Git credential helper.",
        ExitCode.configuration,
      );
    }
    const lease = `--force-with-lease=refs/heads/${input.branch}:${input.expectedOldCommit ?? ""}`;
    const result = await runProcess({
      executable: git,
      args: [
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "credential.helper=",
        "-c",
        `credential.helper=!"${gh}" auth git-credential`,
        "-c",
        "credential.useHttpPath=true",
        "push",
        "--porcelain",
        "--no-verify",
        lease,
        input.cloneUrl,
        `${input.candidateCommit}:refs/heads/${input.branch}`,
      ],
      cwd: input.root,
      env: commandEnvironment(),
      deadlineMs: input.deadlineMs,
      maxOutputBytes: 1024 * 1024,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      ...(input.cancellationRequested === undefined
        ? {}
        : { cancellationRequested: input.cancellationRequested }),
    });
    if (
      result.exitCode !== 0 ||
      result.timedOut ||
      result.cancelled ||
      result.outputExceeded
    ) {
      throw new MillError(
        "GITHUB_PUSH_OUTCOME_UNKNOWN",
        "The exact Git push did not return a verified receipt; authoritative readback is required.",
        ExitCode.temporary,
        { exitCode: result.exitCode },
      );
    }
  }

  async findPullRequests(input: {
    config: ProposeConfig;
    branch: string;
    deadlineMs: number;
    signal?: AbortSignal;
  }): Promise<readonly GitHubPullRequest[]> {
    const query = new URLSearchParams({
      state: "all",
      head: `${input.config.owner}:${input.branch}`,
      base: input.config.baseBranch,
      per_page: "100",
    });
    const value = await this.#ghJson(
      [
        "api",
        "--hostname",
        input.config.host,
        "--paginate",
        "--slurp",
        `repos/${input.config.owner}/${input.config.repository}/pulls?${query.toString()}`,
      ],
      {
        deadlineMs: input.deadlineMs,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      },
    );
    return paginatedArray(value, "pull request collection").map((item) =>
      parsePullRequest(item, false),
    );
  }

  async createDraftPullRequest(input: {
    config: ProposeConfig;
    branch: string;
    title: string;
    body: string;
    deadlineMs: number;
    signal?: AbortSignal;
    cancellationRequested?: () => boolean;
  }): Promise<GitHubPullRequest> {
    const value = await this.#ghJson(
      [
        "api",
        "--hostname",
        input.config.host,
        "--method",
        "POST",
        `repos/${input.config.owner}/${input.config.repository}/pulls`,
        "--raw-field",
        `title=${input.title}`,
        "--raw-field",
        `head=${input.branch}`,
        "--raw-field",
        `base=${input.config.baseBranch}`,
        "--raw-field",
        `body=${input.body}`,
        "--field",
        "draft=true",
      ],
      {
        deadlineMs: input.deadlineMs,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        ...(input.cancellationRequested === undefined
          ? {}
          : { cancellationRequested: input.cancellationRequested }),
      },
    );
    return parsePullRequest(value, true);
  }

  async observe(input: {
    config: ProposeConfig;
    pullRequestNumber: number;
    deadlineMs: number;
    signal?: AbortSignal;
  }): Promise<GitHubObservation> {
    const lifecycle = {
      deadlineMs: input.deadlineMs,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    };
    const prefix = `repos/${input.config.owner}/${input.config.repository}`;
    const pullValue = await this.#ghJson(
      [
        "api",
        "--hostname",
        input.config.host,
        `${prefix}/pulls/${input.pullRequestNumber}`,
      ],
      lifecycle,
    );
    const pullRequest = parsePullRequest(pullValue, true);
    const [
      branchSha,
      checkValue,
      statusValue,
      reviewsValue,
      commentsValue,
      defaultRefValue,
    ] = await Promise.all([
      this.readBranch({
        config: input.config,
        branch: pullRequest.headRef,
        deadlineMs: input.deadlineMs,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      }),
      this.#ghJson(
        [
          "api",
          "--hostname",
          input.config.host,
          "--paginate",
          "--slurp",
          `${prefix}/commits/${pullRequest.headSha}/check-runs?filter=latest&per_page=100`,
        ],
        lifecycle,
      ),
      this.#ghJson(
        [
          "api",
          "--hostname",
          input.config.host,
          "--paginate",
          "--slurp",
          `${prefix}/commits/${pullRequest.headSha}/status?per_page=100`,
        ],
        lifecycle,
      ),
      this.#ghJson(
        [
          "api",
          "--hostname",
          input.config.host,
          "--paginate",
          "--slurp",
          `${prefix}/pulls/${input.pullRequestNumber}/reviews?per_page=100`,
        ],
        lifecycle,
      ),
      this.#ghJson(
        [
          "api",
          "--hostname",
          input.config.host,
          "--paginate",
          "--slurp",
          `${prefix}/pulls/${input.pullRequestNumber}/comments?per_page=100`,
        ],
        lifecycle,
      ),
      this.#ghJson(
        [
          "api",
          "--hostname",
          input.config.host,
          `${prefix}/git/ref/heads/${encodeURIComponent(input.config.baseBranch)}`,
        ],
        lifecycle,
      ),
    ]);
    const checks = parseChecks(
      paginatedObjectCollection(checkValue, "check_runs", "check runs"),
      paginatedObjectCollection(statusValue, "statuses", "commit statuses"),
    );
    const reviews = paginatedArray(reviewsValue, "reviews").map(
      (raw): GitHubReview => {
        const item = object(raw, "review");
        const user = object(item.user, "review actor");
        return {
          id: String(integer(item.id, "review ID")),
          actorLogin: text(user.login, "review actor login"),
          state: text(item.state, "review state").toUpperCase(),
          commitId:
            item.commit_id === null || item.commit_id === undefined
              ? null
              : assertSha(item.commit_id, "review commit ID"),
          body: typeof item.body === "string" ? item.body : "",
          url: text(item.html_url, "review URL"),
        };
      },
    );
    const inlineFeedback = paginatedArray(commentsValue, "review comments").map(
      (raw): GitHubFeedback => {
        const item = object(raw, "review comment");
        const user = object(item.user, "review comment actor");
        const body = typeof item.body === "string" ? item.body : "";
        return {
          id: String(integer(item.id, "review comment ID")),
          actorLogin: text(user.login, "review comment actor login"),
          priority: priority(body),
          body,
          path: text(item.path, "review comment path"),
          line: Number.isSafeInteger(item.line) ? (item.line as number) : null,
          url: text(item.html_url, "review comment URL"),
          commitId: assertSha(item.commit_id, "review comment commit ID"),
        };
      },
    );
    const reviewFeedback = reviews.flatMap((review): GitHubFeedback[] => {
      const reviewPriority = priority(review.body);
      if (
        review.body.trim().length === 0 ||
        review.commitId === null ||
        reviewPriority === "unclassified"
      ) {
        return [];
      }
      return [
        {
          id: `review-${review.id}`,
          actorLogin: review.actorLogin,
          priority: reviewPriority,
          body: review.body,
          path: null,
          line: null,
          url: review.url,
          commitId: review.commitId,
        },
      ];
    });
    const feedback = [...reviewFeedback, ...inlineFeedback];
    const defaultBranchHead = assertSha(
      object(
        object(defaultRefValue, "default branch ref").object,
        "default branch object",
      ).sha,
      "default branch SHA",
    );
    let mergeCommit: GitHubCommit | null = null;
    let mergeChecks: GitHubCheck[] = [];
    let mergeIsOnDefaultBranch = false;
    if (pullRequest.merged && pullRequest.mergeCommitSha !== null) {
      const [commitValue, compareValue, mergeCheckValue, mergeStatusValue] =
        await Promise.all([
          this.#ghJson(
            [
              "api",
              "--hostname",
              input.config.host,
              `${prefix}/git/commits/${pullRequest.mergeCommitSha}`,
            ],
            lifecycle,
          ),
          this.#ghJson(
            [
              "api",
              "--hostname",
              input.config.host,
              `${prefix}/compare/${pullRequest.mergeCommitSha}...${defaultBranchHead}`,
            ],
            lifecycle,
          ),
          this.#ghJson(
            [
              "api",
              "--hostname",
              input.config.host,
              "--paginate",
              "--slurp",
              `${prefix}/commits/${pullRequest.mergeCommitSha}/check-runs?filter=latest&per_page=100`,
            ],
            lifecycle,
          ),
          this.#ghJson(
            [
              "api",
              "--hostname",
              input.config.host,
              "--paginate",
              "--slurp",
              `${prefix}/commits/${pullRequest.mergeCommitSha}/status?per_page=100`,
            ],
            lifecycle,
          ),
        ]);
      const commit = object(commitValue, "merge commit");
      const treeObject = object(commit.tree, "merge commit tree");
      const parents = Array.isArray(commit.parents) ? commit.parents : [];
      mergeCommit = {
        sha: assertSha(commit.sha, "merge commit SHA"),
        tree: assertSha(treeObject.sha, "merge tree SHA"),
        parents: parents.map((raw) =>
          assertSha(object(raw, "merge parent").sha, "merge parent SHA"),
        ),
      };
      const compare = object(compareValue, "default branch comparison");
      mergeIsOnDefaultBranch =
        compare.status === "ahead" || compare.status === "identical";
      mergeChecks = parseChecks(
        paginatedObjectCollection(
          mergeCheckValue,
          "check_runs",
          "merge check runs",
        ),
        paginatedObjectCollection(
          mergeStatusValue,
          "statuses",
          "merge commit statuses",
        ),
      );
    }
    return {
      pullRequest,
      branchSha,
      checks,
      mergeChecks,
      reviews,
      feedback,
      defaultBranchHead,
      mergeCommit,
      mergeIsOnDefaultBranch,
    };
  }
}

export function createGitHubAdapter(root: string): GitHubAdapter {
  return new GhGitHubAdapter(path.resolve(root));
}
