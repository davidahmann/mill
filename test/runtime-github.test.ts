import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createGitHubAdapter,
  type ProposeConfig,
} from "../src/runtime/github.js";
import { temporaryDirectory } from "./helpers.js";

const originalGh = process.env.MILL_GH_PATH;
const originalGit = process.env.MILL_GIT_PATH;

afterEach(() => {
  if (originalGh === undefined) delete process.env.MILL_GH_PATH;
  else process.env.MILL_GH_PATH = originalGh;
  if (originalGit === undefined) delete process.env.MILL_GIT_PATH;
  else process.env.MILL_GIT_PATH = originalGit;
});

const sha = "a".repeat(40);
const config: ProposeConfig = {
  forge: "github",
  host: "github.com",
  owner: "example",
  repository: "app",
  repositoryNodeId: "R_example",
  remoteName: "origin",
  baseBranch: "main",
  branchPrefix: "mill/",
  allowedActors: ["operator"],
  requiredChecks: ["validate"],
  reviewPolicy: {
    mode: "github_required",
    requiredReviewerLogins: ["codex-review"],
  },
  allowedMergeMethods: ["squash"],
  approvalTtlSeconds: 900,
  pollTimeoutSeconds: 30,
};

describe("GitHub CLI adapter", () => {
  it("uses bounded pagination and parses exact-head provider evidence", async () => {
    const repository = await temporaryDirectory("mill-github-repository-");
    const tools = await temporaryDirectory("mill-github-tools-");
    const gh = path.join(tools.path, "gh");
    try {
      await writeFile(
        gh,
        `#!${process.execPath}
import {appendFileSync} from "node:fs";
appendFileSync(new URL("./calls.log",import.meta.url),JSON.stringify(process.argv.slice(2))+"\\n");
const args=process.argv.slice(2);const endpoint=args.find((value)=>value.startsWith("repos/"))??args.at(-1)??"";
const pull={number:41,node_id:"PR_example",html_url:"https://github.com/example/app/pull/41",state:"open",draft:true,body:"<!-- mill-delivery-key:fixture -->",head:{ref:"mill/task",sha:"${sha}"},base:{ref:"main"},merged:false,merge_commit_sha:null,merged_at:null};
if(endpoint==="user")console.log(JSON.stringify({login:"operator",id:7}));
else if(endpoint==="repos/example/app")console.log(JSON.stringify({node_id:"R_example",full_name:"example/app",clone_url:"https://github.com/example/app.git",default_branch:"main",fork:false}));
else if(endpoint.includes("/git/ref/heads/missing")){console.error("HTTP 404");process.exit(1)}
else if(endpoint.includes("/git/ref/heads/"))console.log(JSON.stringify({object:{sha:"${sha}"}}));
else if(endpoint.includes("/pulls?"))console.log(JSON.stringify([[pull]]));
else if(args.includes("--method")&&endpoint==="repos/example/app/pulls")console.log(JSON.stringify(pull));
else if(endpoint.endsWith("/pulls/41"))console.log(JSON.stringify(pull));
else if(endpoint.includes("/check-runs"))console.log(JSON.stringify([{check_runs:[{name:"validate",status:"completed",conclusion:"success"}]}]));
else if(endpoint.includes("/status?"))console.log(JSON.stringify([{statuses:[{state:"pending",context:"legacy"}]}]))
else if(endpoint.includes("/reviews?"))console.log(JSON.stringify([[{user:{login:"codex-review"},state:"COMMENTED",commit_id:"${sha}"}]]));
else if(endpoint.includes("/comments?"))console.log(JSON.stringify([[{id:12,user:{login:"codex-review"},body:"[P2] clarify edge case",path:"src/index.ts",line:4,html_url:"https://github.com/example/app/pull/41#discussion_r12",commit_id:"${sha}"}]]));
else process.exit(2);
`,
        { mode: 0o755 },
      );
      await chmod(gh, 0o755);
      process.env.MILL_GH_PATH = gh;
      const adapter = createGitHubAdapter(repository.path);
      await expect(
        adapter.inspect({ config, deadlineMs: Date.now() + 10_000 }),
      ).resolves.toMatchObject({
        actorLogin: "operator",
        repositoryNodeId: "R_example",
        fullName: "example/app",
      });
      await expect(
        adapter.findPullRequests({
          config,
          branch: "mill/task",
          deadlineMs: Date.now() + 10_000,
        }),
      ).resolves.toHaveLength(1);
      await expect(
        adapter.readBranch({
          config,
          branch: "missing",
          deadlineMs: Date.now() + 10_000,
        }),
      ).resolves.toBeNull();
      await expect(
        adapter.createDraftPullRequest({
          config,
          branch: "mill/task",
          title: "Draft",
          body: "body",
          deadlineMs: Date.now() + 10_000,
        }),
      ).resolves.toMatchObject({ number: 41, draft: true });
      const observation = await adapter.observe({
        config,
        pullRequestNumber: 41,
        deadlineMs: Date.now() + 10_000,
      });
      expect(observation).toMatchObject({
        branchSha: sha,
        checks: [
          { name: "validate", status: "completed", conclusion: "success" },
          { name: "legacy", status: "in_progress", conclusion: "pending" },
        ],
        reviews: [
          {
            actorLogin: "codex-review",
            state: "COMMENTED",
            commitId: sha,
          },
        ],
        feedback: [{ priority: "P2", commitId: sha }],
      });
      const calls = await readFile(path.join(tools.path, "calls.log"), "utf8");
      const paginated = calls
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as string[])
        .filter((args) => args.includes("--paginate"));
      expect(paginated).not.toHaveLength(0);
      expect(paginated.every((args) => args.includes("--slurp"))).toBe(true);

      const git = path.join(tools.path, "git");
      await writeFile(
        git,
        `#!${process.execPath}\nimport {writeFileSync} from "node:fs";writeFileSync(new URL("./git-call.json",import.meta.url),JSON.stringify(process.argv.slice(2)));process.exit(0);\n`,
        { mode: 0o755 },
      );
      await chmod(git, 0o755);
      process.env.MILL_GIT_PATH = git;
      await expect(
        adapter.pushExact({
          root: repository.path,
          config,
          cloneUrl: "https://github.com/example/app.git",
          branch: "mill/task",
          candidateCommit: sha,
          expectedOldCommit: null,
          deadlineMs: Date.now() + 10_000,
        }),
      ).resolves.toBeUndefined();
      const gitCall = JSON.parse(
        await readFile(path.join(tools.path, "git-call.json"), "utf8"),
      ) as string[];
      expect(gitCall).toContain("--force-with-lease=refs/heads/mill/task:");
      await expect(
        adapter.pushExact({
          root: repository.path,
          config,
          cloneUrl: "https://github.com/example/app.git",
          branch: "feature/task",
          candidateCommit: sha,
          expectedOldCommit: null,
          deadlineMs: Date.now() + 10_000,
        }),
      ).rejects.toMatchObject({ code: "INVALID_DELIVERY_BRANCH" });
      await expect(
        adapter.pushExact({
          root: repository.path,
          config,
          cloneUrl: "https://github.com/lookalike/app.git",
          branch: "mill/task",
          candidateCommit: sha,
          expectedOldCommit: null,
          deadlineMs: Date.now() + 10_000,
        }),
      ).rejects.toMatchObject({
        code: "GITHUB_REPOSITORY_BINDING_MISMATCH",
      });
      process.env.MILL_GIT_PATH = path.join(tools.path, "missing-git");
      await expect(
        adapter.pushExact({
          root: repository.path,
          config,
          cloneUrl: "https://github.com/example/app.git",
          branch: "mill/task",
          candidateCommit: sha,
          expectedOldCommit: null,
          deadlineMs: Date.now() + 10_000,
        }),
      ).rejects.toMatchObject({ code: "SHIPPER_TOOL_UNAVAILABLE" });
      await writeFile(git, `#!${process.execPath}\nprocess.exit(9);\n`, {
        mode: 0o755,
      });
      await chmod(git, 0o755);
      process.env.MILL_GIT_PATH = git;
      await expect(
        adapter.pushExact({
          root: repository.path,
          config,
          cloneUrl: "https://github.com/example/app.git",
          branch: "mill/task",
          candidateCommit: sha,
          expectedOldCommit: null,
          deadlineMs: Date.now() + 10_000,
        }),
      ).rejects.toMatchObject({ code: "GITHUB_PUSH_OUTCOME_UNKNOWN" });
    } finally {
      await Promise.all([repository.cleanup(), tools.cleanup()]);
    }
  });

  it("reads exact merge identity, containment, and post-merge checks", async () => {
    const repository = await temporaryDirectory("mill-github-merged-");
    const tools = await temporaryDirectory("mill-github-merged-tools-");
    const gh = path.join(tools.path, "gh");
    const mergeSha = "c".repeat(40);
    const tree = "b".repeat(40);
    try {
      await writeFile(
        gh,
        `#!${process.execPath}
const args=process.argv.slice(2);const endpoint=args.find((value)=>value.startsWith("repos/"))??args.at(-1)??"";
const pull={number:41,node_id:"PR_example",html_url:"https://github.com/example/app/pull/41",state:"closed",draft:false,body:"marker",head:{ref:"mill/task",sha:"${sha}"},base:{ref:"main"},merged:true,merge_commit_sha:"${mergeSha}",merged_at:"2026-09-01T17:00:00.000Z"};
if(endpoint.endsWith("/pulls/41"))console.log(JSON.stringify(pull));
else if(endpoint.includes("/git/ref/heads/mill")){console.error("HTTP 404");process.exit(1)}
else if(endpoint.includes("/git/ref/heads/main"))console.log(JSON.stringify({object:{sha:"${mergeSha}"}}));
else if(endpoint.includes("/check-runs"))console.log(JSON.stringify([{check_runs:[{name:"validate",status:"completed",conclusion:"success"}]}]));
else if(endpoint.includes("/status?"))console.log(JSON.stringify([{statuses:[]}]))
else if(endpoint.includes("/reviews?"))console.log(JSON.stringify([[]]));
else if(endpoint.includes("/comments?"))console.log(JSON.stringify([[]]));
else if(endpoint.includes("/git/commits/"))console.log(JSON.stringify({sha:"${mergeSha}",tree:{sha:"${tree}"},parents:[{sha:"${"d".repeat(40)}"}]}));
else if(endpoint.includes("/compare/"))console.log(JSON.stringify({status:"identical"}));
else process.exit(2);
`,
        { mode: 0o755 },
      );
      await chmod(gh, 0o755);
      process.env.MILL_GH_PATH = gh;
      const observation = await createGitHubAdapter(repository.path).observe({
        config,
        pullRequestNumber: 41,
        deadlineMs: Date.now() + 10_000,
      });
      expect(observation).toMatchObject({
        branchSha: null,
        defaultBranchHead: mergeSha,
        mergeCommit: { sha: mergeSha, tree, parents: ["d".repeat(40)] },
        mergeIsOnDefaultBranch: true,
        mergeChecks: [{ name: "validate", conclusion: "success" }],
      });
    } finally {
      await Promise.all([repository.cleanup(), tools.cleanup()]);
    }
  });

  it("fails closed on malformed, incomplete, and failed provider responses", async () => {
    const repository = await temporaryDirectory("mill-github-invalid-");
    const tools = await temporaryDirectory("mill-github-invalid-tools-");
    const gh = path.join(tools.path, "gh");
    const mode = path.join(tools.path, "mode");
    try {
      await writeFile(
        gh,
        `#!${process.execPath}
import {readFileSync} from "node:fs";
const mode=readFileSync(new URL("./mode",import.meta.url),"utf8").trim();
if(mode==="call-failed")process.exit(3);if(mode==="invalid-json"){console.log("{");process.exit(0)}
const args=process.argv.slice(2);const endpoint=args.find((value)=>value.startsWith("repos/"))??args.at(-1)??"";
const pull={number:41,node_id:"PR_example",html_url:"https://github.com/example/app/pull/41",state:mode==="bad-pull-state"?"unexpected":"open",draft:true,body:"marker",head:{ref:"mill/task",sha:"${sha}"},base:{ref:"main"},merged:false,merge_commit_sha:null,merged_at:null};
if(endpoint==="user")console.log(JSON.stringify({login:mode==="bad-login"?"":"operator",id:mode==="bad-actor"?0:7}));
else if(endpoint==="repos/example/app")console.log(JSON.stringify(mode==="bad-repo"?[]:{node_id:"R_example",full_name:"example/app",clone_url:"https://github.com/example/app.git",default_branch:"main",fork:false}));
else if(endpoint.includes("/git/ref/heads/"))console.log(JSON.stringify({object:{sha:mode==="bad-sha"?"bad":"${sha}"}}));
else if(endpoint.includes("/pulls?"))console.log(JSON.stringify(mode==="bad-pages"?{}:mode==="bad-page"?[{}]:[[pull]]));
else if(endpoint.endsWith("/pulls/41"))console.log(JSON.stringify(pull));
else if(endpoint.includes("/check-runs"))console.log(JSON.stringify(mode==="bad-check-pages"?{}:mode==="bad-check-page"?[{}]:[{check_runs:[]}]))
else if(endpoint.includes("/status?"))console.log(JSON.stringify([{statuses:[]}]))
else if(endpoint.includes("/reviews?"))console.log(JSON.stringify([[]]));
else if(endpoint.includes("/comments?"))console.log(JSON.stringify([[]]));
else process.exit(2);
`,
        { mode: 0o755 },
      );
      await chmod(gh, 0o755);
      process.env.MILL_GH_PATH = gh;
      const adapter = createGitHubAdapter(repository.path);
      const inspect = () =>
        adapter.inspect({ config, deadlineMs: Date.now() + 10_000 });
      for (const invalidMode of ["bad-actor", "bad-login", "bad-repo"]) {
        await writeFile(mode, invalidMode);
        await expect(inspect()).rejects.toMatchObject({
          code: "INVALID_GITHUB_RESPONSE",
        });
      }
      await writeFile(mode, "bad-sha");
      await expect(
        adapter.readBranch({
          config,
          branch: "mill/task",
          deadlineMs: Date.now() + 10_000,
        }),
      ).rejects.toMatchObject({ code: "INVALID_GITHUB_RESPONSE" });
      for (const invalidMode of ["bad-pull-state", "bad-pages", "bad-page"]) {
        await writeFile(mode, invalidMode);
        await expect(
          adapter.findPullRequests({
            config,
            branch: "mill/task",
            deadlineMs: Date.now() + 10_000,
          }),
        ).rejects.toMatchObject({ code: "INVALID_GITHUB_RESPONSE" });
      }
      for (const invalidMode of ["bad-check-pages", "bad-check-page"]) {
        await writeFile(mode, invalidMode);
        await expect(
          adapter.observe({
            config,
            pullRequestNumber: 41,
            deadlineMs: Date.now() + 10_000,
          }),
        ).rejects.toMatchObject({ code: "INVALID_GITHUB_RESPONSE" });
      }
      for (const invalidMode of ["call-failed", "invalid-json"]) {
        await writeFile(mode, invalidMode);
        await expect(inspect()).rejects.toMatchObject({
          code:
            invalidMode === "call-failed"
              ? "GITHUB_CALL_FAILED"
              : "INVALID_GITHUB_RESPONSE",
        });
      }
    } finally {
      await Promise.all([repository.cleanup(), tools.cleanup()]);
    }
  });
});
