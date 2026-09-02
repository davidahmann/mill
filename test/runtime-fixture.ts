import { execFile } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { canonicalDigest, type JsonValue } from "../src/contracts/canonical.js";
import { loadRuntimeInputs, textDigest } from "../src/runtime/inputs.js";
import { temporaryDirectory } from "./helpers.js";

const execFileAsync = promisify(execFile);

async function git(root: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync(
    "/usr/bin/git",
    [
      "-c",
      "user.name=Mill Test",
      "-c",
      "user.email=mill-test@example.invalid",
      ...args,
    ],
    { cwd: root, encoding: "utf8" },
  );
  return result.stdout;
}

export async function runtimeFixture(
  options: {
    reviewRepair?: boolean;
    retryCount?: number;
    repositoryPrefix?: string;
    propose?: boolean;
    githubReviewer?: string;
  } = {},
): Promise<{
  root: string;
  stateHome: string;
  taskPath: string;
  taskDigest: string;
  codexPath: string;
  dockerPath: string;
  cleanup(): Promise<void>;
}> {
  const repository = await temporaryDirectory(
    options.repositoryPrefix ?? "mill-runtime-repo-",
  );
  const state = await temporaryDirectory("mill-runtime-state-");
  const tools = await temporaryDirectory("mill-runtime-tools-");
  const root = repository.path;
  await Promise.all([
    writeFile(path.join(root, ".gitignore"), "ignored-output\n"),
    mkdir(path.join(root, "product", "tasks"), { recursive: true }),
    mkdir(path.join(root, "quality"), { recursive: true }),
    mkdir(path.join(root, "src"), { recursive: true }),
    mkdir(path.join(root, "test"), { recursive: true }),
  ]);
  const product = `schemaVersion: "1"
id: fixture
title: Fixture
primaryUser: Test operator
jobToBeDone: Produce one exact positive-value candidate.
outcomes: [Positive value]
nonGoals: []
assumptions: []
unknowns: []
sourceRefs: [SRC-PRD]
acceptance:
  - id: ACC-POSITIVE
    kind: functional
    statement: The exported value is greater than one and the native test passes.
    sourceRefs: [SRC-PRD]
invariants:
  - id: INV-POSITIVE
    statement: The exported value remains positive.
    owner: repository
    criticality: high
    surfaceRefs: [src/value.js]
    verification:
      mode: command
      ref: test
    sourceRefs: [SRC-PRD]
    unknowns: []
decisions: []
`;
  const parsedProduct: unknown = parseYaml(product);
  const productDigest = canonicalDigest(parsedProduct as JsonValue);
  const scenarios = `schemaVersion: "1"
productContractDigest: "${productDigest}"
scenarios:
  - id: SCN-POSITIVE
    kind: normal
    given: [an approved positive-value task]
    when: [the native test runs]
    then: [the exported value remains positive]
    oracleOwner: repository
    acceptanceRefs: [ACC-POSITIVE]
    invariantRefs: [INV-POSITIVE]
    coverage: both
    visibility: builder_visible
    executionRef: test
    forbidden: []
`;
  const impactProposal = {
    schemaVersion: "1",
    id: "positive-value",
    productContractDigest: productDigest,
    outcomeId: "positive-value",
    riskClass: "low",
    acceptanceIds: ["ACC-POSITIVE"],
    affectedInvariantIds: ["INV-POSITIVE"],
    uncertainInvariantIds: [],
    surfaces: [
      { id: "src/value.js", kind: "system", change: "Increase the value." },
    ],
    scenarioIds: ["SCN-POSITIVE"],
    commandIds: ["test"],
    materialDecisions: [],
    unresolved: [],
    exceptions: [],
    approval: null,
  } as const;
  const impact = stringifyYaml({
    ...impactProposal,
    approval: {
      approvedBy: "mill-test",
      approvedAt: "2026-09-02T00:00:00.000Z",
      proposalDigest: canonicalDigest(impactProposal),
    },
  });
  const policy = "# Fixture policy\n\nOnly src/value.js may change.\n";
  await Promise.all([
    writeFile(path.join(root, "product", "contract.yaml"), product),
    writeFile(path.join(root, "product", "impact.yaml"), impact),
    writeFile(path.join(root, "quality", "scenarios.yaml"), scenarios),
    writeFile(path.join(root, "WORKFLOW.md"), policy),
    writeFile(path.join(root, "src", "value.js"), "export const value = 1;\n"),
    writeFile(
      path.join(root, "test", "value.test.js"),
      'import assert from "node:assert/strict";\nimport test from "node:test";\nimport { value } from "../src/value.js";\ntest("value stays positive", () => assert.ok(value > 0));\n',
    ),
  ]);
  const reviewMode =
    options.githubReviewer === undefined ? "local_only" : "github_required";
  const reviewers =
    options.githubReviewer === undefined ? "[]" : `[${options.githubReviewer}]`;
  const proposalConfiguration =
    options.propose === true
      ? `propose:
  forge: github
  host: github.com
  owner: example
  repository: app
  repositoryNodeId: R_example
  remoteName: origin
  baseBranch: main
  branchPrefix: mill/
  allowedActors: [operator]
  allowedMergerLogins: [operator]
  requiredChecks: [validate]
  reviewPolicy:
    mode: ${reviewMode}
    requiredReviewerLogins: ${reviewers}
  allowedMergeMethods: [linear_tree_preserving]
  approvalTtlSeconds: 900
  pollTimeoutSeconds: 30
`
      : "";
  await writeFile(
    path.join(root, "mill.yaml"),
    `schemaVersion: "1"
repositoryId: "11111111-1111-4111-8111-111111111111"
trustCeiling: ${options.propose === true ? "propose" : "build"}
sensitivePaths:
  - .env
verifier:
  image: "node@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e"
  network: none
${proposalConfiguration}commands:
  test:
    argv: ["node", "--test"]
    cwd: "."
    controlPaths:
      - test/value.test.js
    capability: test
    required: true
    timeoutSeconds: 30
    execution: oci
`,
  );
  const taskPath = "product/tasks/manual.yaml";
  await writeFile(
    path.join(root, taskPath),
    `schemaVersion: "2"
id: positive-value
title: Keep the exported value positive
objective: Change src/value.js to export a positive value greater than one.
riskClass: low
baseRef: HEAD
authority:
  productContract:
    path: product/contract.yaml
    digest: "${textDigest(product)}"
  scenarioSet:
    path: quality/scenarios.yaml
    digest: "${textDigest(scenarios)}"
  policy:
    path: WORKFLOW.md
    digest: "${textDigest(policy)}"
  impactManifest:
    path: product/impact.yaml
    digest: "${textDigest(impact)}"
contextPaths:
  - WORKFLOW.md
  - test/value.test.js
allowedPaths:
  - src/value.js
commandIds:
  - test
acceptance:
  - id: ACC-POSITIVE
    statement: The exported value is greater than one and the native test passes.
    invariantIds: [INV-POSITIVE]
    scenarioIds: [SCN-POSITIVE]
    coverage: both
    evidence:
      mode: command
      commandId: test
commit:
  message: "feat: increase fixture value"
  authorName: "Mill Test"
  authorEmail: "mill-test@example.invalid"
budget:
  deadlineSeconds: 60
  maxOutputBytes: 1048576
  retryCount: ${options.retryCount ?? 1}
`,
  );
  await git(root, ["init", "--initial-branch=main"]);
  await git(root, [
    "remote",
    "add",
    "origin",
    "https://github.com/example/app.git",
  ]);
  await git(root, ["add", "."]);
  await git(root, [
    "commit",
    "--no-gpg-sign",
    "-m",
    "test: seed runtime fixture",
  ]);

  const codexPath = path.join(tools.path, "codex");
  const reviewer =
    options.reviewRepair === true
      ? `const source=await readFile(path.join(cwd,"src/value.js"),"utf8");
const findings=source.includes("value = 2")?[{id:"R1",severity:"P1",class:"correctness",title:"Use the repaired value",body:"Set the value to three.",file:"src/value.js",line:1}]:[];`
      : "const findings=[];";
  await writeFile(
    codexPath,
    `#!${process.execPath}
import {readFile,writeFile} from "node:fs/promises";
import path from "node:path";
import {execFileSync} from "node:child_process";
const args=process.argv.slice(2);
if(args[0]==="--version"){console.log("codex-cli fixture-1");process.exit(0)}
if(args[0]==="login"){console.log("Logged in using ChatGPT");process.exit(0)}
if(args.includes("--approve-for-me")){console.error("automatic escalation approval is forbidden");process.exit(2)}
if(!args.some((value,index)=>value==="-c"&&args[index+1]==='approval_policy="never"')){console.error("approval policy must fail closed");process.exit(2)}
if(!args.some((value,index)=>value==="--disable"&&args[index+1]==="skill_search")){console.error("host skill search not disabled");process.exit(2)}
if(!args.includes("--ignore-rules")){console.error("ambient execution rules not disabled");process.exit(2)}
const sandboxIndex=args.indexOf("--sandbox");
const expectedSandbox=args.includes("--output-schema")?"read-only":"workspace-write";
if(sandboxIndex<0||args[sandboxIndex+1]!==expectedSandbox){console.error("unexpected sandbox scope");process.exit(2)}
const index=args.indexOf("--cd");
const cwd=index>=0?args[index+1]:process.cwd();
let prompt="";for await(const chunk of process.stdin){prompt+=chunk}
if(args.includes("--output-schema")){
  const candidate=execFileSync("/usr/bin/git",["rev-parse","HEAD"],{cwd,encoding:"utf8"}).trim();
  ${reviewer}
  const text=JSON.stringify({schemaVersion:"1",candidateCommit:candidate,summary:findings.length?"repair required":"clean",findings});
  console.log(JSON.stringify({type:"thread.started",thread_id:"fake-review"}));
  console.log(JSON.stringify({type:"item.completed",item:{type:"agent_message",text}}));
  console.log(JSON.stringify({type:"turn.completed",usage:{input_tokens:10,output_tokens:5}}));
}else{
  const value=prompt.includes("Repair this complete")?3:2;
  await writeFile(path.join(cwd,"src/value.js"),\`export const value = \${value};\\n\`);
  console.log(JSON.stringify({type:"thread.started",thread_id:"fake-build"}));
  console.log(JSON.stringify({type:"turn.completed",usage:{input_tokens:10,output_tokens:5}}));
}
`,
    { mode: 0o755 },
  );
  await chmod(codexPath, 0o755);

  const dockerPath = path.join(tools.path, "docker");
  await writeFile(
    dockerPath,
    `#!${process.execPath}
import {readFile} from "node:fs/promises";
import path from "node:path";
const args=process.argv.slice(2);
if(args[0]==="--version"){console.log("Docker version 29.7.2");process.exit(0)}
if(args[0]==="image"&&args[1]==="inspect"){console.log("[]");process.exit(0)}
if(args[0]==="rm"){process.exit(0)}
const mount=args[args.indexOf("--mount")+1]??"";
const source=/source=([^,]+)/u.exec(mount)?.[1];
if(!source||!mount.includes("readonly"))process.exit(2);
const value=await readFile(path.join(source,"src/value.js"),"utf8");
process.exit(/value = [1-9]/u.test(value)?0:1);
`,
    { mode: 0o755 },
  );
  await chmod(dockerPath, 0o755);
  const taskDigest = (await loadRuntimeInputs(root, taskPath)).taskDigest;
  return {
    root,
    stateHome: state.path,
    taskPath,
    taskDigest,
    codexPath,
    dockerPath,
    async cleanup(): Promise<void> {
      await Promise.all([
        repository.cleanup(),
        state.cleanup(),
        tools.cleanup(),
      ]);
    },
  };
}
