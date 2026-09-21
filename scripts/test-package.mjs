import { existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { canonicalDigest } from "../dist/contracts/canonical.js";
import { MILL_VERSION } from "../dist/version.js";

const root = path.resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(path.join(tmpdir(), "mill-package-"));
const npmCli = process.env.npm_execpath;
const gitExecutable = process.env.MILL_GIT_PATH ?? "git";

if (npmCli === undefined) {
  throw new Error("npm_execpath is required for package validation");
}

function npm(args, cwd) {
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_audit: "false",
      npm_config_fund: "false",
    },
    timeout: 120_000,
  });
  if (result.status !== 0) {
    throw new Error(
      `npm ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout;
}

function command(executable, args, cwd, env = process.env) {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    env,
    timeout: 120_000,
  });
  if (result.status !== 0) {
    throw new Error(
      `${executable} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout;
}

function digest(value) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

try {
  const packOutput = npm(
    ["pack", "--ignore-scripts", "--json", "--pack-destination", temporary],
    root,
  );
  const packResult = JSON.parse(packOutput)[0];
  const files = packResult.files.map((entry) => entry.path);
  for (const required of [
    "dist/cli.js",
    "dist/index.js",
    "policy-starters/README.md",
    "policy-starters/node-npm/AGENTS.addendum.md",
    "policy-starters/node-npm/.github/dependabot.yml",
    "policy-starters/node-npm/.github/workflows/dco.yml",
    "policy-starters/node-npm/scripts/check-dco.mjs",
    "policy-starters/node-npm/scripts/check-docs.mjs",
    "README.md",
    "LICENSE",
    "schemas/audit-report.schema.json",
    "schemas/context-manifest.schema.json",
    "schemas/delivery-record.schema.json",
    "schemas/impact-manifest.schema.json",
    "schemas/mill-config.schema.json",
    "schemas/playbook-index.schema.json",
    "schemas/playbook.schema.json",
    "schemas/recipe-manifest.schema.json",
    "schemas/release-evidence.schema.json",
    "schemas/repository-integration-plan.schema.json",
    "schemas/repository-intelligence.schema.json",
    "schemas/review-result.schema.json",
    "schemas/run-outcome.schema.json",
    "schemas/run-timeline.schema.json",
    "schemas/source-manifest.schema.json",
    "schemas/support-tuple.schema.json",
    "scripts/maintainer-review.mjs",
    "schemas/specification-proposal.schema.json",
    "schemas/task-packet.schema.json",
    "schemas/validation-evidence.schema.json",
    "schemas/public-alpha-qualification.schema.json",
    "schemas/worker-invocation.schema.json",
    "schemas/worker-profile.schema.json",
    "node_modules/typescript/lib/typescript.js",
    "recipes/node-typescript-next-web/recipe.yaml",
    "recipes/node-typescript-next-web/gitignore.template",
    "recipes/node-typescript-next-web/package-lock.json",
  ]) {
    if (!files.includes(required)) {
      throw new Error(`packed artifact is missing ${required}`);
    }
  }
  if (
    files.some((file) => file.startsWith("src/") || file.startsWith("test/"))
  ) {
    throw new Error("packed artifact contains source or test files");
  }

  const tarball = path.join(temporary, packResult.filename);
  const consumer = path.join(temporary, "consumer");
  await writeFile(
    path.join(temporary, "package.json"),
    `${JSON.stringify({ private: true, type: "module" }, undefined, 2)}\n`,
  );
  npm(["install", "--ignore-scripts", tarball], temporary);
  const bin = path.join(temporary, "node_modules", ".bin", "millctl");
  const version = spawnSync(bin, ["--version"], {
    cwd: temporary,
    encoding: "utf8",
    timeout: 10_000,
  });
  if (version.status !== 0 || version.stdout.trim() !== MILL_VERSION) {
    throw new Error(
      `packed millctl version smoke failed: ${version.stdout}${version.stderr}`,
    );
  }

  // This real nested CLI call must reach admission, not lose its flags to `run`.
  // A proposed outcome blocks before state creation, dependencies or model spend.
  const routingFixture = path.join(temporary, "command-routing");
  await mkdir(path.join(routingFixture, "product"), { recursive: true });
  const routingApproval = `sha256:${"0".repeat(64)}`;
  await writeFile(
    path.join(routingFixture, "product", "plan.yaml"),
    JSON.stringify({
      schemaVersion: "1",
      productContractDigest: routingApproval,
      outcomes: [
        {
          id: "OUT-NOT-APPROVED",
          title: "Unapproved outcome",
          acceptance: ["Owner approval is required"],
          dependsOn: [],
          status: "proposed",
        },
      ],
    }),
  );
  for (const [flags, expectedCode, expectedExit] of [
    [["--approve", routingApproval, "--attended"], "NO_READY_OUTCOME", 78],
    [["--attended"], "USAGE_ERROR", 64],
    [["--approve", routingApproval], "USAGE_ERROR", 64],
    [
      ["--approve", routingApproval, "--attended", "--isolation", "isolated"],
      "BUILDER_ISOLATION_UNQUALIFIED",
      78,
    ],
  ]) {
    const routed = spawnSync(
      bin,
      ["--json", "--cwd", routingFixture, "run", "next", ...flags],
      {
        cwd: temporary,
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    const envelope = JSON.parse(routed.stdout);
    if (
      routed.status !== expectedExit ||
      envelope.reasons?.[0]?.code !== expectedCode
    ) {
      throw new Error(
        `packed nested run authority routing failed: ${routed.stdout}${routed.stderr}`,
      );
    }
  }

  const packageJson = JSON.parse(
    await readFile(
      path.join(
        temporary,
        "node_modules",
        "@davidahmann",
        "mill",
        "package.json",
      ),
      "utf8",
    ),
  );
  if (packageJson.scripts?.postinstall !== undefined) {
    throw new Error("packed package must not define postinstall");
  }
  const installedPackageRoot = path.join(
    temporary,
    "node_modules",
    "@davidahmann",
    "mill",
  );
  const publicImport = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", 'await import("@davidahmann/mill")'],
    { cwd: temporary, encoding: "utf8", timeout: 10_000 },
  );
  if (
    publicImport.status === 0 ||
    !publicImport.stderr.includes("ERR_PACKAGE_PATH_NOT_EXPORTED")
  ) {
    throw new Error(
      "packed package must expose only its documented CLI and schemas",
    );
  }
  const installedMill = await import(
    pathToFileURL(path.join(installedPackageRoot, "dist", "index.js")).href
  );
  const renderedRecipe = await installedMill.renderNodeWebRecipe({
    projectName: "packed-recipe",
    productTitle: 'Packed "Recipe" # Draft & Review',
  });
  const renderedIgnore = renderedRecipe.find(
    (entry) => entry.path === ".gitignore",
  );
  if (
    renderedIgnore === undefined ||
    !renderedIgnore.content.includes("node_modules")
  ) {
    throw new Error("packed recipe does not render its .gitignore contract");
  }
  const renderedLayout = renderedRecipe.find(
    (entry) => entry.path === "app/layout.tsx",
  );
  if (
    !renderedLayout?.content.includes(
      'title: "Packed \\"Recipe\\" # Draft & Review"',
    )
  ) {
    throw new Error("packed recipe does not syntax-escape its product title");
  }
  const renderedReadme = renderedRecipe.find(
    (entry) => entry.path === "README.md",
  );
  if (
    !renderedReadme?.content.startsWith(
      '# Packed \\"Recipe\\" \\# Draft \\& Review\n',
    ) ||
    renderedReadme.content.includes("MILL_PRODUCT_TITLE")
  ) {
    throw new Error("packed recipe does not Markdown-escape its product title");
  }
  for (const schema of [
    "mill-lock",
    "adaptation-manifest",
    "playbook",
    "playbook-index",
    "run-outcome",
    "run-timeline",
  ]) {
    const schemaImport = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `await import("@davidahmann/mill/schemas/${schema}.schema.json", { with: { type: "json" } })`,
      ],
      {
        cwd: temporary,
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    if (schemaImport.status !== 0) {
      throw new Error(
        `packed ${schema} schema import failed: ${schemaImport.stdout}${schemaImport.stderr}`,
      );
    }
  }
  for (const command of [
    "audit",
    "discover",
    "init",
    "playbooks",
    "new",
    "adopt",
    "auth",
    "dependencies",
    "detach",
    "plan",
    "qualify",
    "run",
    "status",
    "report",
    "outcome",
    "timeline",
    "verify",
    "review",
    "pr",
    "ship",
    "start",
    "resume",
    "cancel",
    "state",
    "support-bundle",
  ]) {
    const help = spawnSync(bin, [command, "--help"], {
      cwd: temporary,
      encoding: "utf8",
      timeout: 10_000,
    });
    if (help.status !== 0) {
      throw new Error(
        `packed millctl ${command} help failed: ${help.stdout}${help.stderr}`,
      );
    }
  }

  const abandonmentHelp = command(
    bin,
    ["state", "abandon-plan", "--help"],
    temporary,
  );
  const refreshHelp = command(bin, ["review", "--help"], temporary);
  for (const option of ["--refresh", "--base <commit>", "--attended"]) {
    if (!refreshHelp.includes(option))
      throw new Error(`Packed review-refresh contract is missing ${option}`);
  }
  for (const option of ["--approve <digest>", "--attended"]) {
    if (!abandonmentHelp.includes(option))
      throw new Error(`Packed abandonment contract is missing ${option}`);
  }

  await Promise.all([
    mkdir(path.join(consumer, "product", "impacts"), { recursive: true }),
    mkdir(path.join(consumer, "product", "tasks"), { recursive: true }),
    mkdir(path.join(consumer, "quality"), { recursive: true }),
    mkdir(path.join(consumer, "src"), { recursive: true }),
    mkdir(path.join(consumer, "test"), { recursive: true }),
  ]);
  const acceptanceStatement =
    "The packed CLI produces an exact reviewed candidate.";
  const productContract = {
    schemaVersion: "1",
    id: "package-canary",
    title: "Package canary",
    primaryUser: "Package maintainer",
    jobToBeDone: "Prove the delivered package can run the attended lifecycle.",
    outcomes: [
      {
        id: "OUT-REVIEWED-CANDIDATE",
        statement: "One exact reviewed candidate",
      },
    ],
    nonGoals: [],
    assumptions: [],
    unknowns: [],
    sourceRefs: ["SRC-PACKAGE-CANARY"],
    acceptance: [1, 2, 3, 4, 5].map((step) => ({
      id: `PKG-A${step}`,
      kind: "functional",
      statement: `${acceptanceStatement} Step ${step}.`,
      sourceRefs: ["SRC-PACKAGE-CANARY"],
    })),
    invariants: [
      {
        id: "INV-PACKAGE-POSITIVE",
        statement: "The exported value remains positive.",
        owner: "repository",
        criticality: "high",
        surfaceRefs: ["src/value.js"],
        verification: { mode: "command", ref: "test" },
        sourceRefs: ["SRC-PACKAGE-CANARY"],
        unknowns: [],
      },
    ],
    decisions: [],
  };
  const product = `${JSON.stringify(productContract, undefined, 2)}\n`;
  const productContractDigest = canonicalDigest(productContract);
  const scenarioSet = {
    schemaVersion: "1",
    productContractDigest,
    scenarios: [1, 2, 3, 4, 5].map((step) => ({
      id: `SCN-PACKAGE-CANARY-${step}`,
      kind: "normal",
      given: ["the package canary repository"],
      when: [`dependent step ${step} runs from the prior accepted candidate`],
      then: ["the exported value remains positive"],
      oracleOwner: "repository",
      acceptanceRefs: [`PKG-A${step}`],
      invariantRefs: ["INV-PACKAGE-POSITIVE"],
      coverage: "both",
      visibility: "builder_visible",
      executionRef: "test",
      forbidden: [],
    })),
  };
  const scenarios = `${JSON.stringify(scenarioSet, undefined, 2)}\n`;
  const policy = "# Package canary policy\n\nOnly src/value.js may change.\n";
  const taskArtifacts = [1, 2, 3, 4, 5].flatMap((step) => {
    const taskId = `package-canary-${step}`;
    const acceptanceId = `PKG-A${step}`;
    const scenarioId = `SCN-PACKAGE-CANARY-${step}`;
    const impactProposal = {
      schemaVersion: "1",
      id: taskId,
      productContractDigest,
      outcomeId: "OUT-REVIEWED-CANDIDATE",
      riskClass: "low",
      acceptanceIds: [acceptanceId],
      affectedInvariantIds: ["INV-PACKAGE-POSITIVE"],
      uncertainInvariantIds: [],
      surfaces: [
        {
          id: "src/value.js",
          kind: "system",
          change: `Increase the exported positive value in step ${step}.`,
        },
      ],
      scenarioIds: [scenarioId],
      commandIds: ["test"],
      materialDecisions: [],
      unresolved: [],
      exceptions: [],
      approval: null,
    };
    const impact = `${JSON.stringify(
      {
        ...impactProposal,
        approval: {
          approvedBy: "mill-package-test",
          approvedAt: "2026-09-02T00:00:00.000Z",
          proposalDigest: canonicalDigest(impactProposal),
        },
      },
      undefined,
      2,
    )}\n`;
    const impactPath = `product/impacts/canary-${step}.yaml`;
    const task = `schemaVersion: "2"
id: ${taskId}
title: Exercise dependent packed lifecycle step ${step}
objective: Increase the positive exported value from the prior accepted output.
riskClass: low
baseRef: HEAD
authority:
  productContract:
    path: product/contract.yaml
    digest: "${digest(product)}"
  scenarioSet:
    path: quality/scenarios.yaml
    digest: "${digest(scenarios)}"
  policy:
    path: WORKFLOW.md
    digest: "${digest(policy)}"
  impactManifest:
    path: ${impactPath}
    digest: "${digest(impact)}"
contextPaths: [WORKFLOW.md, test/value.test.js]
allowedPaths: [src/value.js]
commandIds: [test]
acceptance:
  - id: ${acceptanceId}
    statement: ${acceptanceStatement} Step ${step}.
    invariantIds: [INV-PACKAGE-POSITIVE]
    scenarioIds: [${scenarioId}]
    coverage: both
    evidence:
      mode: command
      commandId: test
commit:
  message: "feat: pass package canary step ${step}"
  authorName: "Mill Package Test"
  authorEmail: "mill-package@example.invalid"
budget:
  deadlineSeconds: 60
  maxOutputBytes: 1048576
  retryCount: 1
`;
    return [
      writeFile(path.join(consumer, impactPath), impact),
      writeFile(
        path.join(consumer, "product", "tasks", `canary-${step}.yaml`),
        task,
      ),
    ];
  });
  await Promise.all([
    ...taskArtifacts,
    writeFile(path.join(consumer, "product", "contract.yaml"), product),
    writeFile(path.join(consumer, "quality", "scenarios.yaml"), scenarios),
    writeFile(path.join(consumer, "WORKFLOW.md"), policy),
    writeFile(
      path.join(consumer, "src", "value.js"),
      "export const value = 1;\n",
    ),
    writeFile(
      path.join(consumer, "test", "value.test.js"),
      'import assert from "node:assert/strict";\nimport test from "node:test";\nimport { value } from "../src/value.js";\ntest("value stays positive", () => assert.ok(value > 0));\n',
    ),
    writeFile(
      path.join(consumer, "mill.yaml"),
      `schemaVersion: "1"
repositoryId: "22222222-2222-4222-8222-222222222222"
trustCeiling: propose
sensitivePaths: [.env]
verifier:
  image: "node@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e"
  network: none
propose:
  forge: github
  host: github.com
  owner: example
  repository: app
  repositoryNodeId: R_package_canary
  remoteName: origin
  baseBranch: main
  branchPrefix: mill/
  allowedActors: [package-operator]
  allowedMergerLogins: [package-operator]
  requiredChecks: [validate]
  reviewPolicy:
    mode: local_only
    requiredReviewerLogins: []
  allowedMergeMethods: [linear_tree_preserving]
  approvalTtlSeconds: 900
  pollTimeoutSeconds: 30
commands:
  test:
    argv: ["node", "--test"]
    cwd: "."
    controlPaths: [test/value.test.js]
    capability: test
    required: true
    timeoutSeconds: 30
    execution: oci
`,
    ),
  ]);
  command(gitExecutable, ["init", "--initial-branch=main"], consumer);
  command(
    gitExecutable,
    ["remote", "add", "origin", "https://github.com/example/app.git"],
    consumer,
  );
  command(gitExecutable, ["add", "."], consumer);
  command(
    gitExecutable,
    [
      "-c",
      "user.name=Mill Package Test",
      "-c",
      "user.email=mill-package@example.invalid",
      "commit",
      "--no-gpg-sign",
      "-m",
      "test: seed package canary",
    ],
    consumer,
  );

  const discovery = JSON.parse(
    command(
      bin,
      [
        "--json",
        "--cwd",
        consumer,
        "discover",
        ".",
        "--changed",
        "src/value.js",
      ],
      temporary,
    ),
  );
  if (
    discovery.command !== "discover" ||
    discovery.ok !== true ||
    discovery.data?.authority !== "derived_read_only" ||
    discovery.data?.tests?.executedCoverage !== "unknown" ||
    discovery.data?.changeImpact?.[0]?.changedPath !== "src/value.js"
  ) {
    throw new Error("installed package discovery contract failed");
  }

  const tools = path.join(temporary, "tools");
  const state = path.join(temporary, "state");
  await Promise.all([
    mkdir(tools, { mode: 0o700 }),
    mkdir(state, { mode: 0o700 }),
  ]);
  const codex = path.join(tools, "codex");
  const docker = path.join(tools, "docker");
  const gh = path.join(tools, "gh");
  const git = path.join(tools, "git");
  await writeFile(
    codex,
    `#!${process.execPath}
import {readFile,writeFile} from "node:fs/promises";
import {readFileSync} from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
const args=process.argv.slice(2);
if(args[0]==="--version"){console.log("codex-cli package-fixture-1");process.exit(0)}
if(args[0]==="login"){console.log("Logged in using ChatGPT");process.exit(0)}
if(args.includes("--approve-for-me")){process.exit(2)}
if(!args.some((value,index)=>value==="-c"&&args[index+1]==='approval_policy="never"')){process.exit(2)}
if(!args.some((value,index)=>value==="--disable"&&args[index+1]==="skill_search")){process.exit(2)}
if(!args.includes("--ignore-rules")){process.exit(2)}
const sandboxIndex=args.indexOf("--sandbox");
const expectedSandbox=args.includes("--output-schema")?"read-only":"workspace-write";
if(sandboxIndex<0||args[sandboxIndex+1]!==expectedSandbox){process.exit(2)}
const index=args.indexOf("--cd");const cwd=index>=0?args[index+1]:process.cwd();
if(args.includes("--output-schema")){
  const candidate=execFileSync(${JSON.stringify(gitExecutable)},["rev-parse","HEAD"],{cwd,encoding:"utf8"}).trim();
  const prompt=readFileSync(0,"utf8");
  const scope=JSON.parse(prompt.split("Review scope JSON: ")[1]?.split("\\n")[0]??"null");
  const schema=JSON.parse(await readFile(args[args.indexOf("--output-schema")+1],"utf8"));
  if(Object.hasOwn(schema.properties,"gate"))process.exit(2);
  let scenario={};
  try{scenario=JSON.parse(await readFile(new URL("./review-scenario.json",import.meta.url),"utf8"))}catch(error){if(error.code!=="ENOENT")throw error}
  const findings=scenario.severity?[{id:"PACKED-F1",severity:scenario.severity,class:"correctness",title:"Packed review policy fixture",body:"Synthetic review finding retained by the packed lifecycle.",file:"src/value.js",line:1}]:[];
  const gate=scenario.injectGate?{schemaVersion:"1",policy:"p0_p1",configDigest:"sha256:"+"0".repeat(64),blockingFindingIds:[],advisoryFindingIds:["PACKED-F1"]}:undefined;
  const text=JSON.stringify({schemaVersion:"1",candidateCommit:candidate,...(scope===null?{}:{scope}),summary:findings.length?"fixture finding":"clean",findings,...(gate===undefined?{}:{gate})});
  const outputIndex=args.indexOf("--output-last-message");
  if(outputIndex<0||!args[outputIndex+1])process.exit(2);
  await writeFile(args[outputIndex+1],text,{mode:0o600});
  console.log(JSON.stringify({type:"item.completed",item:{type:"agent_message",text}}));
  console.log(JSON.stringify({type:"turn.completed",usage:{input_tokens:2,output_tokens:1}}));
}else{
  const valuePath=path.join(cwd,"src/value.js");
  const current=await readFile(valuePath,"utf8");
  const value=Number(/value = (\\d+)/u.exec(current)?.[1]??"0");
  await writeFile(valuePath,"export const value = "+(value+1)+";\\n");
  console.log(JSON.stringify({type:"turn.completed",usage:{input_tokens:2,output_tokens:1}}));
}
`,
    { mode: 0o700 },
  );
  await writeFile(
    docker,
    `#!${process.execPath}
import {readFile} from "node:fs/promises";
import {existsSync,readFileSync,writeFileSync} from "node:fs";
import {randomBytes} from "node:crypto";
import path from "node:path";
const args=process.argv.slice(2);
const stateFile=new URL("./containers.json",import.meta.url);
if(args[0]==="info"){console.log(JSON.stringify("package-fixture-daemon"));process.exit(0)}
let containers=existsSync(stateFile)?JSON.parse(readFileSync(stateFile,"utf8")):[];
const save=()=>writeFileSync(stateFile,JSON.stringify(containers));
if(args[0]==="image"&&args[1]==="inspect"){process.exit(existsSync(new URL("./image-unavailable",import.meta.url))?1:0)}
if(args[0]==="container"&&args[1]==="inspect"){
  const found=containers.find(value=>value.name==="/"+args.at(-1)||value.id===args.at(-1));
  if(found){console.log(JSON.stringify(found));process.exit(0)}
  console.error("No such container: "+args.at(-1));process.exit(1);
}
if(args[0]==="rm"){containers=containers.filter(value=>value.id!==args.at(-1));save();process.exit(0)}
if(args[0]==="run"){
  const labels={};for(let i=0;i<args.length-1;i++)if(args[i]==="--label"){const [key,...value]=args[i+1].split("=");labels[key]=value.join("=")}
  containers.push({id:randomBytes(32).toString("hex"),name:"/"+args[args.indexOf("--name")+1],labels});save();
}
const mounts=args.flatMap((value,index)=>value==="--mount"?[args[index+1]??""]:[]);
const mount=mounts.find((value)=>value.includes("target=/workspace/src,"))??"";
const source=/source=([^,]+)/u.exec(mount)?.[1];
if(!source||!mount.includes("readonly"))process.exit(2);
const value=await readFile(path.join(source,"value.js"),"utf8");
process.exit(/value = [1-9]/u.test(value)?0:1);
`,
    { mode: 0o700 },
  );
  await writeFile(
    git,
    `#!${process.execPath}
import {spawnSync} from "node:child_process";
import {writeFileSync} from "node:fs";
const args=process.argv.slice(2);
if(args.includes("push")){
  const refspec=args.at(-1)??"";const candidate=refspec.split(":",1)[0]??"";
  if(!/^[a-f0-9]{40}$/.test(candidate))process.exit(2);
  writeFileSync(new URL("./remote-head",import.meta.url),candidate+"\\n",{mode:0o600});
  console.log("done");process.exit(0);
}
const result=spawnSync(${JSON.stringify(gitExecutable)},args,{cwd:process.cwd(),env:process.env,encoding:"utf8"});
process.stdout.write(result.stdout??"");process.stderr.write(result.stderr??"");process.exit(result.status??1);
`,
    { mode: 0o700 },
  );
  await writeFile(
    gh,
    `#!${process.execPath}
import {readFileSync,writeFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
const args=process.argv.slice(2);const endpoint=args.find((value)=>value.startsWith("repos/"))??args.at(-1)??"";
const read=(name)=>{try{return readFileSync(new URL(name,import.meta.url),"utf8").trim()}catch{return null}};
const remoteHead=()=>read("./remote-head");
const pullPath=new URL("./pull-request.json",import.meta.url);
const pull=()=>{const value=read("./pull-request.json");return value===null?null:JSON.parse(value)};
const field=(name)=>{for(let index=0;index<args.length-1;index+=1){if((args[index]==="--field"||args[index]==="--raw-field")&&args[index+1]?.startsWith(name+"="))return args[index+1].slice(name.length+1)}return null};
if(endpoint==="user")console.log(JSON.stringify({login:"package-operator",id:9}));
else if(endpoint==="repos/example/app")console.log(JSON.stringify({node_id:"R_package_canary",full_name:"example/app",clone_url:"https://github.com/example/app.git",default_branch:"main",fork:false}));
else if(args.includes("--method")&&endpoint==="repos/example/app/pulls"){
  const value={number:41,node_id:"PR_package_canary",html_url:"https://github.com/example/app/pull/41",state:"open",draft:true,body:field("body")??"",head:{ref:field("head")??"",sha:remoteHead()},base:{ref:field("base")??"main"},merged:false,merge_commit_sha:null,merged_by:null,merged_at:null};
  writeFileSync(pullPath,JSON.stringify(value),{mode:0o600});console.log(JSON.stringify(value));
}
else if(endpoint.includes("/git/ref/heads/main"))console.log(JSON.stringify({object:{sha:execFileSync(${JSON.stringify(gitExecutable)},["rev-parse","main"],{encoding:"utf8"}).trim()}}));
else if(endpoint.includes("/git/ref/heads/")){const head=remoteHead();if(head===null){console.error("HTTP 404");process.exit(1)}console.log(JSON.stringify({object:{sha:head}}))}
else if(endpoint.includes("/pulls?")){const value=pull();console.log(JSON.stringify(value===null?[[]]:[[value]]))}
else if(endpoint.endsWith("/pulls/41")){const value=pull();if(value===null)process.exit(2);console.log(JSON.stringify(value))}
else if(endpoint.includes("/check-runs"))console.log(JSON.stringify([{check_runs:[{name:"validate",status:"completed",conclusion:"success"}]}]));
else if(endpoint.includes("/status?"))console.log(JSON.stringify([{statuses:[]}]))
else if(endpoint.includes("/reviews?"))console.log(JSON.stringify([[]]));
else if(endpoint.includes("/comments?"))console.log(JSON.stringify([[]]));
else process.exit(2);
`,
    { mode: 0o700 },
  );
  await Promise.all([
    chmod(codex, 0o700),
    chmod(docker, 0o700),
    chmod(gh, 0o700),
    chmod(git, 0o700),
  ]);
  const canaryEnvironment = {
    ...process.env,
    MILL_CODEX_PATH: codex,
    MILL_DOCKER_PATH: docker,
    MILL_STATE_HOME: state,
  };
  const sequenceSteps = [];
  let seededFault;
  let reviewed;
  let runId;
  let lastCanaryEnvironment = canaryEnvironment;
  for (const step of [1, 2, 3, 4, 5]) {
    const stepState = path.join(state, `step-${step}`);
    await mkdir(stepState, { recursive: true, mode: 0o700 });
    const stepEnvironment = {
      ...canaryEnvironment,
      MILL_STATE_HOME: stepState,
    };
    lastCanaryEnvironment = stepEnvironment;
    const mill = (args) =>
      JSON.parse(
        command(
          bin,
          ["--json", "--cwd", consumer, ...args],
          consumer,
          stepEnvironment,
        ),
      );
    const task = `product/tasks/canary-${step}.yaml`;
    const baseCommit = command(
      gitExecutable,
      ["rev-parse", "HEAD"],
      consumer,
    ).trim();
    const qualification = mill(["qualify", "--baseline", "--task", task]);
    const started = mill([
      "run",
      "--task",
      task,
      "--approve",
      qualification.data.approvalDigest,
      "--attended",
    ]);
    runId = started.data.run.id;
    mill(["verify", "--task", task, "--run", runId]);
    reviewed = mill(["review", "--task", task, "--run", runId]);
    if (
      reviewed.data.run.status !== "reviewed" ||
      typeof reviewed.data.run.candidateCommit !== "string"
    ) {
      throw new Error(`packed lifecycle step ${step} was not reviewed`);
    }
    const candidateCommit = reviewed.data.run.candidateCommit;
    sequenceSteps.push({
      id: `step-${step}`,
      dependsOn: step === 1 ? [] : [`step-${step - 1}`],
      baseCommit,
      candidateCommit,
      status: "accepted",
      newBehavior: {
        requiredIds: [`PKG-A${step}`],
        passedIds: [`PKG-A${step}`],
      },
      preservation: {
        requiredIds: ["INV-PACKAGE-POSITIVE"],
        passedIds: ["INV-PACKAGE-POSITIVE"],
      },
      scenarioIds: [`SCN-PACKAGE-CANARY-${step}`],
      usage: {
        inputTokens: null,
        outputTokens: null,
        currencyCost: null,
        source: "unavailable",
      },
    });
    if (step < 5) {
      command(gitExecutable, ["merge", "--ff-only", candidateCommit], consumer);
    }

    if (step === 2) {
      command(
        gitExecutable,
        ["switch", "--create", "mill-seeded-fault"],
        consumer,
      );
      await writeFile(
        path.join(consumer, "src", "value.js"),
        "export const value = 0;\n",
      );
      command(gitExecutable, ["add", "src/value.js"], consumer);
      command(
        gitExecutable,
        [
          "-c",
          "user.name=Mill Package Test",
          "-c",
          "user.email=mill-package@example.invalid",
          "commit",
          "--no-gpg-sign",
          "-m",
          "test: seed rejected continuity fault",
        ],
        consumer,
      );
      const faultCommit = command(
        gitExecutable,
        ["rev-parse", "HEAD"],
        consumer,
      ).trim();
      const faultTest = spawnSync(process.execPath, ["--test"], {
        cwd: consumer,
        encoding: "utf8",
        timeout: 30_000,
      });
      if (faultTest.status === 0) {
        throw new Error("seeded continuity fault unexpectedly passed");
      }
      command(gitExecutable, ["switch", "main"], consumer);
      const recovered = command(
        gitExecutable,
        ["rev-parse", "HEAD"],
        consumer,
      ).trim();
      if (recovered !== candidateCommit) {
        throw new Error("seeded fault recovery changed the accepted base");
      }
      seededFault = {
        baseCommit: candidateCommit,
        candidateCommit: faultCommit,
        status: "failed",
        rejected: true,
        recovered: true,
        enteredAcceptedSequence: false,
        reason: "the repository preservation oracle rejected a zero value",
      };
    }
  }
  if (
    reviewed === undefined ||
    runId === undefined ||
    seededFault === undefined
  ) {
    throw new Error("longitudinal package qualification is incomplete");
  }
  const finalCommit = sequenceSteps.at(-1)?.candidateCommit;
  if (finalCommit === undefined) {
    throw new Error("longitudinal package qualification has no final commit");
  }
  const finalTree = command(
    gitExecutable,
    ["rev-parse", `${finalCommit}^{tree}`],
    consumer,
  ).trim();
  const auditCategories = [
    "product",
    "code",
    "ux",
    "accessibility",
    "security",
    "dependencies",
    "architecture",
    "operations",
    "release",
  ];
  const artifactDigest = `sha256:${createHash("sha256")
    .update(await readFile(tarball))
    .digest("hex")}`;
  const longitudinalQualification =
    installedMill.assessPublicAlphaQualification(
      installedMill.contractSchemas.publicAlphaQualification.parse({
        schemaVersion: "1",
        package: {
          name: "@davidahmann/mill",
          version: MILL_VERSION,
          artifactDigest,
          npmIntegrity: packResult.integrity,
        },
        supportTuple: {
          id: "package-fixture",
          status: "qualified",
          testedAt: "2026-09-03T12:00:00.000Z",
          expiresAt: "2027-09-03T12:00:00.000Z",
          host: { os: process.platform, architecture: process.arch },
          runtime: { node: "24.20.0", npm: "11.19.0" },
          container: {
            engine: "fixture",
            version: "1.0.0",
            verifierImage: `node@sha256:${"a".repeat(64)}`,
          },
          worker: {
            adapter: "codex-cli",
            harnessVersion: "package-fixture-1",
            modelIdentity: "provider-mutable",
            authMode: "operator-session",
          },
          forge: {
            gitVersion: "fixture-1",
            ghVersion: "fixture-1",
            host: "github.com",
          },
          recipe: {
            id: "node-typescript-next-web",
            version: "1.0.0",
            digest: `sha256:${"b".repeat(64)}`,
          },
        },
        sequence: { steps: sequenceSteps, seededFault },
        canaries: {
          packedInstall: "passed",
          greenfield: "passed",
          adoption: "passed",
          downstreamWithoutMill: "passed",
          recovery: "passed",
          security: "passed",
        },
        auditCandidate: { commit: finalCommit, tree: finalTree },
        audits: auditCategories.map((category) => ({
          category,
          status: "passed",
          reportDigest: `sha256:${"c".repeat(64)}`,
        })),
        generatedAt: "2026-09-03T12:30:00.000Z",
      }),
      new Date("2026-09-03T13:00:00.000Z"),
    );
  if (!longitudinalQualification.passed) {
    throw new Error(
      `longitudinal package qualification failed: ${longitudinalQualification.blockers.join(", ")}`,
    );
  }
  const proposalEnvironment = {
    ...lastCanaryEnvironment,
    MILL_GH_PATH: gh,
    MILL_GIT_PATH: git,
  };
  const proposalMill = (args) =>
    JSON.parse(
      command(
        bin,
        ["--json", "--cwd", consumer, ...args],
        consumer,
        proposalEnvironment,
      ),
    );
  const proposal = proposalMill([
    "pr",
    "plan",
    "--task",
    "product/tasks/canary-5.yaml",
    "--run",
    runId,
  ]);
  const opened = proposalMill([
    "pr",
    "open",
    "--task",
    "product/tasks/canary-5.yaml",
    "--run",
    runId,
    "--approve",
    proposal.data.delivery.proposalDigest,
    "--attended",
  ]);
  if (opened.data.run.status !== "awaiting_ci") {
    throw new Error("packed lifecycle did not open one draft pull request");
  }
  const observed = proposalMill([
    "pr",
    "observe",
    "--task",
    "product/tasks/canary-5.yaml",
    "--run",
    runId,
  ]);
  if (observed.data.run.status !== "awaiting_human") {
    throw new Error("packed lifecycle did not reach the human merge gate");
  }

  // Fresh, independent fixtures exercise the new packed review contracts without
  // changing the five-step legacy sequence or claiming real provider behavior.
  for (const scenario of [
    { id: "p2-opt-in", severity: "P2", optIn: true, passes: true },
    { id: "p1-opt-in", severity: "P1", optIn: true, passes: false },
    { id: "p2-legacy", severity: "P2", optIn: false, passes: false },
    {
      id: "provider-gate",
      severity: "P1",
      optIn: true,
      passes: false,
      injectGate: true,
    },
  ]) {
    const fixture = path.join(temporary, `review-${scenario.id}`);
    command(
      gitExecutable,
      ["clone", "--quiet", "--no-hardlinks", consumer, fixture],
      temporary,
    );
    command(
      gitExecutable,
      ["remote", "set-url", "origin", "https://github.com/example/app.git"],
      fixture,
    );
    if (scenario.optIn) {
      const configPath = path.join(fixture, "mill.yaml");
      const config = await readFile(configPath, "utf8");
      await writeFile(configPath, `${config}review:\n  blocking: p0_p1\n`);
      command(gitExecutable, ["add", "mill.yaml"], fixture);
      command(
        gitExecutable,
        [
          "-c",
          "user.name=Mill Package Test",
          "-c",
          "user.email=mill-package@example.invalid",
          "commit",
          "--no-gpg-sign",
          "-m",
          "test: approve packed review policy",
        ],
        fixture,
      );
    }
    await writeFile(
      path.join(tools, "review-scenario.json"),
      JSON.stringify(scenario),
      { mode: 0o600 },
    );
    const environment = {
      ...canaryEnvironment,
      MILL_STATE_HOME: path.join(state, `review-${scenario.id}`),
      MILL_GH_PATH: gh,
      MILL_GIT_PATH: git,
    };
    const mill = (args) =>
      JSON.parse(
        command(
          bin,
          ["--json", "--cwd", fixture, ...args],
          fixture,
          environment,
        ),
      );
    const task = "product/tasks/canary-1.yaml";
    const qualification = mill(["qualify", "--baseline", "--task", task]);
    const started = mill([
      "run",
      "--task",
      task,
      "--approve",
      qualification.data.approvalDigest,
      "--attended",
    ]);
    const scenarioRun = started.data.run.id;
    mill(["verify", "--task", task, "--run", scenarioRun]);
    const reviewProcess = spawnSync(
      bin,
      [
        "--json",
        "--cwd",
        fixture,
        "review",
        "--task",
        task,
        "--run",
        scenarioRun,
      ],
      { cwd: fixture, env: environment, encoding: "utf8", timeout: 120_000 },
    );
    const review = JSON.parse(reviewProcess.stdout);
    const status = mill(["status", "--run", scenarioRun]).data.run;
    if (
      (scenario.passes
        ? reviewProcess.status !== 0
        : reviewProcess.status === 0) ||
      status.status !== (scenario.passes ? "reviewed" : "blocked") ||
      status.repairCount !== 0
    ) {
      throw new Error(`packed ${scenario.id} review admission failed`);
    }
    if (scenario.injectGate) {
      if (
        review.reasons?.[0]?.code !== "INVALID_REVIEW_RESULT" ||
        status.blockCode !== "INVALID_REVIEW_RESULT"
      ) {
        throw new Error("packed reviewer supplied a controller-owned receipt");
      }
    } else {
      const evidence = review.data.review;
      const ids = scenario.passes ? "advisoryFindingIds" : "blockingFindingIds";
      if (
        evidence.findings.length !== 1 ||
        evidence.findings[0]?.severity !== scenario.severity ||
        (scenario.optIn
          ? evidence.gate?.[ids]?.[0] !== "PACKED-F1" ||
            evidence.gate?.configDigest !== status.configDigest
          : evidence.gate !== undefined) ||
        (!scenario.passes && status.blockCode !== "REVIEW_FINDINGS")
      ) {
        throw new Error(`packed ${scenario.id} findings were not preserved`);
      }
      const outcome = mill(["outcome", "--run", scenarioRun]);
      if (
        outcome.data.review.status !==
          (scenario.passes ? "advisories" : "findings") ||
        outcome.data.review.findingCounts[scenario.severity] !== 1
      ) {
        throw new Error(`packed ${scenario.id} outcome classification failed`);
      }
      if (scenario.passes) {
        const plan = mill(["pr", "plan", "--task", task, "--run", scenarioRun]);
        if (plan.data.delivery.reviewBlocking !== "p0_p1") {
          throw new Error("packed draft plan lost the frozen review policy");
        }
      }
    }
  }
  process.stdout.write(
    "package review-policy canary passed: opt-in P2 advisory, opt-in P1 block, legacy P2 block, provider receipt rejection (fixture adapters)\n",
  );
  // Exercise public recovery commands from the installed tarball. The fake
  // daemon fails before command execution; no model or registry is contacted.
  await rm(path.join(tools, "review-scenario.json"), { force: true });
  const recoveryFixture = path.join(temporary, "verification-recovery");
  command(
    gitExecutable,
    ["clone", "--quiet", "--no-hardlinks", consumer, recoveryFixture],
    temporary,
  );
  await writeFile(
    path.join(recoveryFixture, "mill.lock"),
    `schemaVersion: "1"
mill:
  package: "@davidahmann/mill"
  version: "${MILL_VERSION}"
`,
  );
  command(gitExecutable, ["add", "mill.lock"], recoveryFixture);
  command(
    gitExecutable,
    [
      "-c",
      "user.name=Mill Package Test",
      "-c",
      "user.email=mill-package@example.invalid",
      "commit",
      "--no-gpg-sign",
      "-m",
      "test: pin candidate recovery controller",
    ],
    recoveryFixture,
  );
  const recoveryTaskFile = path.join(
    recoveryFixture,
    "product/tasks/canary-1.yaml",
  );
  await writeFile(
    recoveryTaskFile,
    (await readFile(recoveryTaskFile, "utf8")).replace(
      "deadlineSeconds: 60",
      "deadlineSeconds: 20",
    ),
  );
  command(
    gitExecutable,
    ["add", "product/tasks/canary-1.yaml"],
    recoveryFixture,
  );
  command(
    gitExecutable,
    [
      "-c",
      "user.name=Mill Package Test",
      "-c",
      "user.email=mill-package@example.invalid",
      "commit",
      "--no-gpg-sign",
      "-m",
      "test: bound packed recovery deadline",
    ],
    recoveryFixture,
  );
  const pinnedSource = await readFile(
    path.join(recoveryFixture, "mill.lock"),
    "utf8",
  );
  await writeFile(
    path.join(recoveryFixture, "mill.lock"),
    pinnedSource.replace(MILL_VERSION, "0.8.0"),
  );
  const deniedState = path.join(state, "denied-controller");
  const deniedController = spawnSync(
    bin,
    [
      "--json",
      "--cwd",
      recoveryFixture,
      "verify",
      "--task",
      "product/tasks/canary-1.yaml",
      "--run",
      "11111111-1111-4111-8111-111111111111",
    ],
    {
      cwd: recoveryFixture,
      env: { ...canaryEnvironment, MILL_STATE_HOME: deniedState },
      encoding: "utf8",
      timeout: 120_000,
    },
  );
  if (deniedController.status === 0 || existsSync(deniedState)) {
    throw new Error("unapproved controller created state before pin rejection");
  }
  await writeFile(path.join(recoveryFixture, "mill.lock"), pinnedSource);
  const recoveryEnvironment = {
    ...canaryEnvironment,
    MILL_STATE_HOME: path.join(state, "verification-recovery"),
  };
  const recoveryCall = (args, succeeds = true) => {
    const result = spawnSync(
      bin,
      ["--json", "--cwd", recoveryFixture, ...args],
      {
        cwd: recoveryFixture,
        env: recoveryEnvironment,
        encoding: "utf8",
        timeout: 120_000,
      },
    );
    if ((result.status === 0) !== succeeds) {
      throw new Error(
        `packed recovery command unexpected status: ${result.stdout}\n${result.stderr}`,
      );
    }
    return JSON.parse(result.stdout);
  };
  const recoveryTask = "product/tasks/canary-1.yaml";
  const recoveryBase = recoveryCall([
    "qualify",
    "--baseline",
    "--task",
    recoveryTask,
  ]);
  const recoveryStarted = recoveryCall([
    "run",
    "--task",
    recoveryTask,
    "--approve",
    recoveryBase.data.approvalDigest,
    "--attended",
  ]);
  const recoveryRun = recoveryStarted.data.run;
  const recoveryArgs = ["--task", recoveryTask, "--run", recoveryRun.id];
  await writeFile(path.join(tools, "image-unavailable"), "missing image\n");
  const infraFailure = recoveryCall(["verify", ...recoveryArgs], false);
  if (infraFailure.reasons?.[0]?.code !== "VERIFIER_IMAGE_UNAVAILABLE") {
    throw new Error(
      "packed recovery did not preserve pre-command image failure",
    );
  }
  recoveryCall(["verify", ...recoveryArgs], false);
  const stillBlocked = recoveryCall(["status", "--run", recoveryRun.id]).data
    .run;
  if (stillBlocked.blockCode !== "VERIFIER_IMAGE_UNAVAILABLE") {
    throw new Error(
      "rejected verify replaced the original infrastructure blocker",
    );
  }
  await rm(path.join(tools, "image-unavailable"));
  // A fresh allowance must never overlap the original worker authority.
  await delay(
    Math.max(0, Date.parse(recoveryRun.deadlineAt) - Date.now() + 50),
  );
  const recoveryExpiry = new Date(Date.now() + 19_000).toISOString();
  const recoveryProposal = recoveryCall([
    "verification-recovery",
    "plan",
    ...recoveryArgs,
    "--expires-at",
    recoveryExpiry,
  ]);
  recoveryCall(
    [
      "verification-recovery",
      "apply",
      ...recoveryArgs,
      "--expires-at",
      recoveryExpiry,
      "--approve",
      recoveryProposal.data.approvalDigest,
    ],
    false,
  );
  recoveryCall([
    "verification-recovery",
    "apply",
    ...recoveryArgs,
    "--expires-at",
    recoveryExpiry,
    "--approve",
    recoveryProposal.data.approvalDigest,
    "--attended",
  ]);
  recoveryCall(["verify", ...recoveryArgs]);
  recoveryCall(["review", ...recoveryArgs]);
  const recovered = recoveryCall(["status", "--run", recoveryRun.id]).data.run;
  if (
    recovered.status !== "reviewed" ||
    recovered.candidateCommit !== recoveryRun.candidateCommit ||
    recovered.candidateTree !== recoveryRun.candidateTree ||
    recovered.deadlineAt !== recoveryRun.deadlineAt ||
    recovered.attemptCount !== 1 ||
    recovered.repairCount !== 0
  ) {
    throw new Error(
      "packed recovery changed original authority or failed exact review",
    );
  }
  recoveryCall(
    [
      "verification-recovery",
      "plan",
      ...recoveryArgs,
      "--expires-at",
      recoveryExpiry,
    ],
    false,
  );
  process.stdout.write(
    "package candidate-recovery canary passed: preserved blocker, exact approval, attendance, unchanged candidate/deadline/attempts, verification and review, repeat denial (fixture adapters)\n",
  );

  process.stdout.write(
    `package draft-PR lifecycle canary passed: ${packResult.filename}\n`,
  );
} finally {
  await rm(temporary, { force: true, recursive: true });
}
