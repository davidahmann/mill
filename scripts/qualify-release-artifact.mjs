import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { format } from "prettier";

const [artifactArgument, ...flags] = process.argv.slice(2);
if (artifactArgument === undefined) {
  throw new Error(
    "usage: qualify-release-artifact.mjs <artifact.tgz> [--full-canary] [--sbom-output <path>] [--report-output <path>]",
  );
}

let fullCanary = false;
let sbomOutput;
let reportOutput = path.join(process.cwd(), "release-canary.json");
let reportOutputSpecified = false;
for (let index = 0; index < flags.length; index += 1) {
  const flag = flags[index];
  if (flag === "--full-canary") {
    if (fullCanary) {
      throw new Error("--full-canary may be specified only once");
    }
    fullCanary = true;
    continue;
  }
  if (flag === "--sbom-output" || flag === "--report-output") {
    const value = flags[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${flag} requires a path`);
    }
    if (flag === "--sbom-output") {
      if (sbomOutput !== undefined) {
        throw new Error("--sbom-output may be specified only once");
      }
      sbomOutput = path.resolve(value);
    } else {
      if (reportOutputSpecified) {
        throw new Error("--report-output may be specified only once");
      }
      reportOutput = path.resolve(value);
      reportOutputSpecified = true;
    }
    index += 1;
    continue;
  }
  throw new Error(`unsupported argument: ${flag}`);
}
const artifact = path.resolve(artifactArgument);
const npmCli = process.env.npm_execpath;

function run(executable, args, cwd, options = {}) {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    env: options.env ?? process.env,
    timeout: options.timeout ?? 20 * 60_000,
  });
  if (result.status !== 0) {
    throw new Error(
      `${executable} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout.trim();
}

function npm(args, cwd, timeout) {
  return run(
    npmCli === undefined ? "npm" : process.execPath,
    npmCli === undefined ? args : [npmCli, ...args],
    cwd,
    {
      timeout,
      env: {
        ...process.env,
        npm_config_audit: "false",
        npm_config_fund: "false",
      },
    },
  );
}

async function write(root, relative, content) {
  const destination = path.join(root, relative);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, content);
}

function git(root, args) {
  return run(
    "/usr/bin/git",
    [
      "-c",
      "user.name=Mill Release Canary",
      "-c",
      "user.email=mill-release@example.invalid",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    root,
  );
}

async function authorityFixture(mill, root, repositoryId) {
  const prd = "# Release canary\n\nExpose a healthy product surface.\n";
  const observedAt = new Date(Date.now() - 60_000).toISOString();
  const sources = mill.contractSchemas.sourceManifest.parse({
    schemaVersion: "1",
    trigger: "bootstrap",
    providers: [
      {
        id: "operator",
        name: "Operator supplied evidence",
        queries: [],
        networkDisclosure: "No planning-time network access",
      },
    ],
    sources: [
      {
        id: "SRC-PRD",
        class: "user_evidence",
        uri: "product/PRD.md",
        revision: `sha256:${(await import("node:crypto")).createHash("sha256").update(prd).digest("hex")}`,
        observedAt,
        freshness: "current",
        authority: "constraint",
        claims: ["The product exposes a healthy web surface."],
      },
    ],
  });
  const product = mill.contractSchemas.productContract.parse({
    schemaVersion: "1",
    id: "release-canary",
    title: "Release Canary",
    primaryUser: "Release verifier",
    jobToBeDone:
      "Prove the installed package can create and adopt a repository.",
    outcomes: [
      {
        id: "OUT-HEALTHY-WEB",
        statement: "A healthy web surface is independently operable.",
        acceptanceIds: ["ACC-HEALTHY-WEB"],
      },
    ],
    nonGoals: ["Deployment"],
    assumptions: [],
    unknowns: [],
    sourceRefs: ["SRC-PRD"],
    acceptance: [
      {
        id: "ACC-HEALTHY-WEB",
        kind: "functional",
        statement: "The browser and health checks pass.",
        sourceRefs: ["SRC-PRD"],
      },
    ],
    invariants: [
      {
        id: "INV-NATIVE-CHECK",
        statement: "The repository remains independently testable.",
        owner: "repository",
        criticality: "high",
        surfaceRefs: ["package.json"],
        verification: { mode: "command", ref: "check" },
        sourceRefs: ["SRC-PRD"],
        unknowns: [],
      },
    ],
    decisions: [],
  });
  const productDigest = mill.canonicalDigest(product);
  const scenarioSet = mill.contractSchemas.scenarioSet.parse({
    schemaVersion: "1",
    productContractDigest: productDigest,
    scenarios: [
      {
        id: "SCN-NATIVE-WEB",
        kind: "normal",
        given: ["the installed release recipe"],
        when: ["the browser check exercises the generated product"],
        then: ["the title and health behavior pass"],
        oracleOwner: "repository",
        acceptanceRefs: ["ACC-HEALTHY-WEB"],
        invariantRefs: ["INV-NATIVE-CHECK"],
        coverage: "both",
        visibility: "builder_visible",
        executionRef: "test:browser",
        recipeOracle: "web-title-and-health",
        forbidden: [],
      },
      {
        id: "SCN-NATIVE-WEB-FAULT",
        kind: "adversarial",
        given: ["the generated product returns an unhealthy response"],
        when: ["the browser oracle exercises the generated product"],
        then: ["the native repository check rejects the candidate"],
        oracleOwner: "repository",
        acceptanceRefs: ["ACC-HEALTHY-WEB"],
        invariantRefs: ["INV-NATIVE-CHECK"],
        coverage: "preservation",
        visibility: "reviewer_owned",
        executionRef: "test:browser",
        recipeOracle: "web-title-and-health",
        forbidden: ["accepting an unhealthy response"],
      },
    ],
  });
  const proposal = mill.contractSchemas.specificationProposal.parse({
    schemaVersion: "1",
    prd: {
      path: "product/PRD.md",
      digest: sources.sources[0].revision,
    },
    sourceManifestDigest: mill.canonicalDigest(sources),
    productContract: product,
    blueprints: [
      {
        schemaVersion: "1",
        id: "node-typescript-next-web",
        productContractDigest: productDigest,
        recipe: "node-typescript-next-web",
        recipeVersion: "1.0.0",
        runtime: "node-24.18.1-npm-11.16.0",
        architecture: ["TypeScript modular monolith", "Next.js App Router"],
        risks: [],
      },
    ],
    scenarioSet,
    assumptions: [],
    contradictions: [],
    questions: [],
    status: "proposed",
  });
  const [sourcesJson, proposalJson] = await Promise.all(
    [sources, proposal].map((value) =>
      format(JSON.stringify(value), { parser: "json" }),
    ),
  );
  await Promise.all([
    write(root, "product/PRD.md", prd),
    write(root, "product/sources.json", sourcesJson),
    write(root, "product/proposal.json", proposalJson),
  ]);
  return {
    sourceRoot: root,
    prdPath: "product/PRD.md",
    sourceManifestPath: "product/sources.json",
    proposalPath: "product/proposal.json",
    productApprovalDigest: mill.canonicalDigest(proposal),
    repositoryId,
    approvedBy: "release-verifier",
    approvedAt: observedAt,
    authorName: "Mill Release Canary",
    authorEmail: "mill-release@example.invalid",
  };
}

async function runNativeRepositoryCheck(root, verifierImage) {
  const docker = process.env.MILL_DOCKER_PATH ?? "docker";
  const lockPath = path.join(root, "package-lock.json");
  const lockBefore = await readFile(lockPath);
  run(
    docker,
    [
      "run",
      "--rm",
      "--pull",
      "never",
      "--workdir",
      "/workspace",
      "--mount",
      `type=bind,source=${root},target=/workspace`,
      verifierImage,
      "npm",
      "ci",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ],
    root,
    { timeout: 10 * 60_000 },
  );
  const lockAfter = await readFile(lockPath);
  if (!lockBefore.equals(lockAfter)) {
    throw new Error(
      "container dependency preparation changed package-lock.json",
    );
  }
  run(
    docker,
    [
      "run",
      "--rm",
      "--pull",
      "never",
      "--network",
      "none",
      "--workdir",
      "/workspace",
      "--mount",
      `type=bind,source=${root},target=/workspace`,
      verifierImage,
      "npm",
      "run",
      "check",
    ],
    root,
    { timeout: 10 * 60_000 },
  );
  git(root, ["clean", "-dffx"]);
}

const temporary = await mkdtemp(path.join(tmpdir(), "mill-release-artifact-"));
try {
  await write(
    temporary,
    "package.json",
    `${JSON.stringify(
      {
        name: "mill-release-artifact-smoke",
        version: "0.0.0",
        private: true,
        type: "module",
      },
      undefined,
      2,
    )}\n`,
  );
  npm(["install", "--ignore-scripts", artifact], temporary);
  if (sbomOutput !== undefined) {
    const sbom = npm(["sbom", "--sbom-format", "cyclonedx"], temporary);
    await writeFile(sbomOutput, `${sbom}\n`, {
      flag: "wx",
      mode: 0o644,
    });
  }
  const packageRoot = path.join(
    temporary,
    "node_modules",
    "@davidahmann",
    "mill",
  );
  const manifest = JSON.parse(
    await readFile(path.join(packageRoot, "package.json"), "utf8"),
  );
  if (
    manifest.name !== "@davidahmann/mill" ||
    manifest.scripts?.postinstall !== undefined ||
    manifest.publishConfig?.access !== "public" ||
    manifest.publishConfig?.provenance !== true
  ) {
    throw new Error(
      "installed artifact has an unsafe or unexpected package manifest",
    );
  }
  const bin = path.join(temporary, "node_modules", ".bin", "millctl");
  const version = run(bin, ["--version"], temporary);
  if (version !== manifest.version) {
    throw new Error(
      `installed CLI version ${version} does not match ${manifest.version}`,
    );
  }
  for (const command of ["audit", "qualify", "new", "adopt", "start", "ship"]) {
    run(bin, [command, "--help"], temporary);
  }
  const mill = await import(
    pathToFileURL(path.join(packageRoot, "dist", "index.js")).href
  );
  const recipe = await mill.loadNodeWebRecipe(packageRoot);
  if (recipe.manifest.status !== "supported") {
    throw new Error("installed artifact does not contain the supported recipe");
  }

  const canaries = {
    packedInstall: "passed",
    greenfield: fullCanary ? "blocked" : "skipped",
    adoption: fullCanary ? "blocked" : "skipped",
    downstreamWithoutMill: fullCanary ? "blocked" : "skipped",
    recovery: fullCanary ? "blocked" : "skipped",
    security: fullCanary ? "blocked" : "skipped",
  };
  if (fullCanary) {
    const sourceRoot = path.join(temporary, "source");
    await mkdir(sourceRoot, { recursive: true });
    const greenfieldAuthority = await authorityFixture(
      mill,
      sourceRoot,
      "11111111-1111-4111-8111-111111111111",
    );
    const planned = await mill.planGreenfieldIntegration({
      ...greenfieldAuthority,
      targetDirectory: "greenfield-app",
    });
    const applied = await mill.applyGreenfieldIntegration({
      ...greenfieldAuthority,
      targetDirectory: "greenfield-app",
      planApprovalDigest: planned.approvalDigest,
      attended: true,
    });
    const greenfield = path.join(sourceRoot, applied.repository);
    await runNativeRepositoryCheck(greenfield, recipe.manifest.verifierImage);
    canaries.greenfield = "passed";
    canaries.downstreamWithoutMill = "passed";
    const detach = await mill.planDetach(greenfield);
    if (
      detach.mode !== "manual" ||
      detach.changed.length !== 0 ||
      !detach.remove.includes("mill.lock") ||
      !detach.remove.includes("mill.yaml") ||
      !detach.retain.includes("package.json")
    ) {
      throw new Error("installed package did not produce a safe detach plan");
    }
    canaries.recovery = "passed";

    const adoption = path.join(temporary, "adoption-app");
    await mkdir(adoption, { recursive: true });
    const adoptionAuthority = await authorityFixture(
      mill,
      adoption,
      "22222222-2222-4222-8222-222222222222",
    );
    const rendered = await mill.renderNodeWebRecipe({
      projectName: "adoption-app",
      productTitle: "Release Canary",
    });
    for (const file of rendered) await write(adoption, file.path, file.content);
    git(adoption, ["init", "--initial-branch=main"]);
    git(adoption, ["add", "."]);
    git(adoption, [
      "commit",
      "--no-gpg-sign",
      "-m",
      "test: seed compatible adoption",
    ]);
    const adoptionPlan = await mill.planAdoptionIntegration({
      ...adoptionAuthority,
      repositoryRoot: adoption,
    });
    const adopted = await mill.applyAdoptionIntegration({
      ...adoptionAuthority,
      repositoryRoot: adoption,
      planApprovalDigest: adoptionPlan.approvalDigest,
      attended: true,
    });
    const adoptedWorktree = path.join(temporary, "adopted-result");
    git(adoption, [
      "worktree",
      "add",
      "--detach",
      adoptedWorktree,
      adopted.commit,
    ]);
    await runNativeRepositoryCheck(
      adoptedWorktree,
      recipe.manifest.verifierImage,
    );
    git(adoption, ["worktree", "remove", "--force", adoptedWorktree]);
    canaries.adoption = "passed";

    let escaped = false;
    try {
      await mill.planGreenfieldIntegration({
        ...greenfieldAuthority,
        targetDirectory: "../escape",
      });
    } catch {
      escaped = true;
    }
    if (!escaped)
      throw new Error("installed package accepted a target-path escape");
    canaries.security = "passed";
  }

  const report = {
    schemaVersion: "1",
    package: { name: manifest.name, version: manifest.version },
    recipe: {
      id: recipe.manifest.id,
      version: recipe.manifest.version,
      digest: recipe.digest,
      verifierImage: recipe.manifest.verifierImage,
    },
    canaries,
    generatedAt: new Date().toISOString(),
  };
  await writeFile(reportOutput, `${JSON.stringify(report, undefined, 2)}\n`, {
    flag: "wx",
    mode: 0o644,
  });
  process.stdout.write(
    `release artifact qualification passed (${fullCanary ? "full" : "offline"}): ${manifest.name}@${manifest.version}\n`,
  );
} finally {
  await rm(temporary, { force: true, recursive: true });
}
