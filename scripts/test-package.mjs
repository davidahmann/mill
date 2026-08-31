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

const root = path.resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(path.join(tmpdir(), "mill-package-"));
const npmCli = process.env.npm_execpath;

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
    "README.md",
    "LICENSE",
    "schemas/context-manifest.schema.json",
    "schemas/review-result.schema.json",
    "schemas/task-packet.schema.json",
    "schemas/validation-evidence.schema.json",
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
  if (version.status !== 0 || version.stdout.trim() !== "0.0.0-development") {
    throw new Error(
      `packed millctl version smoke failed: ${version.stdout}${version.stderr}`,
    );
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
  const schemaImport = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      'await import("@davidahmann/mill/schemas/mill-lock.schema.json", { with: { type: "json" } })',
    ],
    {
      cwd: temporary,
      encoding: "utf8",
      timeout: 10_000,
    },
  );
  if (schemaImport.status !== 0) {
    throw new Error(
      `packed schema import failed: ${schemaImport.stdout}${schemaImport.stderr}`,
    );
  }
  for (const command of [
    "auth",
    "qualify",
    "run",
    "status",
    "verify",
    "review",
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

  await Promise.all([
    mkdir(path.join(consumer, "product", "tasks"), { recursive: true }),
    mkdir(path.join(consumer, "quality"), { recursive: true }),
    mkdir(path.join(consumer, "src"), { recursive: true }),
    mkdir(path.join(consumer, "test"), { recursive: true }),
  ]);
  const product =
    'schemaVersion: "1"\nid: package-canary\ntitle: Package canary\n';
  const scenarios = 'schemaVersion: "1"\nscenarios: [positive-value]\n';
  const policy = "# Package canary policy\n\nOnly src/value.js may change.\n";
  await Promise.all([
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
trustCeiling: build
sensitivePaths: [.env]
verifier:
  image: "node@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e"
  network: none
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
    writeFile(
      path.join(consumer, "product", "tasks", "canary.yaml"),
      `schemaVersion: "1"
id: package-canary
title: Exercise the packed local lifecycle
objective: Change src/value.js to export the value two.
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
contextPaths: [WORKFLOW.md, test/value.test.js]
allowedPaths: [src/value.js]
commandIds: [test]
acceptance:
  - id: PKG-A1
    statement: The packed CLI produces an exact reviewed candidate.
commit:
  message: "feat: pass package canary"
  authorName: "Mill Package Test"
  authorEmail: "mill-package@example.invalid"
budget:
  deadlineSeconds: 60
  maxOutputBytes: 1048576
  retryCount: 1
`,
    ),
  ]);
  command("/usr/bin/git", ["init", "--initial-branch=main"], consumer);
  command("/usr/bin/git", ["add", "."], consumer);
  command(
    "/usr/bin/git",
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

  const tools = path.join(temporary, "tools");
  const state = path.join(temporary, "state");
  await Promise.all([
    mkdir(tools, { mode: 0o700 }),
    mkdir(state, { mode: 0o700 }),
  ]);
  const codex = path.join(tools, "codex");
  const docker = path.join(tools, "docker");
  await writeFile(
    codex,
    `#!${process.execPath}
import {writeFile} from "node:fs/promises";
import path from "node:path";
import {execFileSync} from "node:child_process";
const args=process.argv.slice(2);
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
  const candidate=execFileSync("/usr/bin/git",["rev-parse","HEAD"],{cwd,encoding:"utf8"}).trim();
  const text=JSON.stringify({schemaVersion:"1",candidateCommit:candidate,summary:"clean",findings:[]});
  console.log(JSON.stringify({type:"item.completed",item:{type:"agent_message",text}}));
}else{
  await writeFile(path.join(cwd,"src/value.js"),"export const value = 2;\\n");
  console.log(JSON.stringify({type:"turn.completed",usage:{input_tokens:2,output_tokens:1}}));
}
`,
    { mode: 0o700 },
  );
  await writeFile(
    docker,
    `#!${process.execPath}
import {readFile} from "node:fs/promises";
import path from "node:path";
const args=process.argv.slice(2);
if(args[0]==="image"&&args[1]==="inspect"){process.exit(0)}
if(args[0]==="rm"){process.exit(0)}
const mount=args[args.indexOf("--mount")+1]??"";
const source=/source=([^,]+)/u.exec(mount)?.[1];
if(!source||!mount.includes("readonly"))process.exit(2);
const value=await readFile(path.join(source,"src/value.js"),"utf8");
process.exit(/value = [1-9]/u.test(value)?0:1);
`,
    { mode: 0o700 },
  );
  await Promise.all([chmod(codex, 0o700), chmod(docker, 0o700)]);
  const canaryEnvironment = {
    ...process.env,
    MILL_CODEX_PATH: codex,
    MILL_DOCKER_PATH: docker,
    MILL_STATE_HOME: state,
  };
  const mill = (args) =>
    JSON.parse(
      command(
        bin,
        ["--json", "--cwd", consumer, ...args],
        consumer,
        canaryEnvironment,
      ),
    );
  const qualification = mill([
    "qualify",
    "--baseline",
    "--task",
    "product/tasks/canary.yaml",
  ]);
  const started = mill([
    "run",
    "--task",
    "product/tasks/canary.yaml",
    "--approve",
    qualification.data.approvalDigest,
    "--attended",
  ]);
  const runId = started.data.run.id;
  mill(["verify", "--task", "product/tasks/canary.yaml", "--run", runId]);
  const reviewed = mill([
    "review",
    "--task",
    "product/tasks/canary.yaml",
    "--run",
    runId,
  ]);
  if (reviewed.data.run.status !== "reviewed") {
    throw new Error("packed lifecycle did not reach reviewed state");
  }
  process.stdout.write(
    `package lifecycle canary passed: ${packResult.filename}\n`,
  );
} finally {
  await rm(temporary, { force: true, recursive: true });
}
