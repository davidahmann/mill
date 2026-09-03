import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";

import { parse as parseYaml } from "yaml";
import { format } from "prettier";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/cli-program.js";
import { canonicalDigest, type JsonValue } from "../src/contracts/canonical.js";
import {
  millConfigSchema,
  productContractSchema,
  scenarioSetSchema,
  sourceManifestSchema,
  specificationProposalSchema,
  taskPacketV1Schema,
} from "../src/contracts/schemas.js";
import {
  loadNodeWebRecipe,
  renderNodeWebRecipe,
} from "../src/recipes/node-typescript-next-web.js";
import {
  applyAdoptionIntegration,
  applyGreenfieldIntegration,
  planAdoptionIntegration,
  planDetach,
  planGreenfieldIntegration,
} from "../src/repository/integration.js";
import {
  dependencySnapshotDirectory,
  prepareDependencySnapshot,
} from "../src/runtime/dependencies.js";
import { textDigest } from "../src/runtime/inputs.js";
import { repositoryStateDirectory } from "../src/runtime/state.js";
import { verifyDeclaredCommands } from "../src/runtime/verifier.js";
import { temporaryDirectory } from "./helpers.js";

const execFileAsync = promisify(execFile);
const originalDocker = process.env.MILL_DOCKER_PATH;
const originalGit = process.env.MILL_GIT_PATH;
const originalStateHome = process.env.MILL_STATE_HOME;

function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: { write: (value: string) => void stdout.push(value) },
      stderr: { write: (value: string) => void stderr.push(value) },
    },
    stdout,
    stderr,
  };
}

afterEach(() => {
  if (originalDocker === undefined) delete process.env.MILL_DOCKER_PATH;
  else process.env.MILL_DOCKER_PATH = originalDocker;
  if (originalGit === undefined) delete process.env.MILL_GIT_PATH;
  else process.env.MILL_GIT_PATH = originalGit;
  if (originalStateHome === undefined) delete process.env.MILL_STATE_HOME;
  else process.env.MILL_STATE_HOME = originalStateHome;
});

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

async function fakeDocker(
  directory: string,
  failVerifier = false,
  createDependencies = true,
  createTargetBeforeVerifier?: string,
  blockDependencyPreparation = false,
): Promise<{ executable: string; log: string }> {
  const executable = path.join(directory, "docker");
  const log = path.join(directory, "docker.log");
  await writeFile(
    executable,
    `#!${process.execPath}
const {appendFileSync,chmodSync,mkdirSync,symlinkSync,writeFileSync}=require("node:fs");
const path=require("node:path");
const args=process.argv.slice(2);
const createTarget=${JSON.stringify(createTargetBeforeVerifier ?? "")};
const blockDependencyPreparation=${JSON.stringify(blockDependencyPreparation)};
appendFileSync(path.join(__dirname,"docker.log"),JSON.stringify(args)+"\\n");
if(args[0]==="image"||args[0]==="rm")process.exit(0);
if(args[0]!=="run")process.exit(2);
if(args.includes("dev.mill.owner=dependency-preparation")&&${createDependencies ? "true" : "false"}){
  const mount=args.find((value)=>value.startsWith("type=bind,")&&value.endsWith("target=/workspace"));
  const prefix="type=bind,source=";
  const suffix=",target=/workspace";
  if(mount===undefined||!mount.startsWith(prefix)||!mount.endsWith(suffix))process.exit(3);
  const modules=path.join(mount.slice(prefix.length,-suffix.length),"node_modules");
  const bin=path.join(modules,"example","bin");
  mkdirSync(bin,{recursive:true});
  const executable=path.join(bin,"tool.js");
  writeFileSync(executable,"export default 1;\\n");
  chmodSync(executable,0o755);
  symlinkSync("example/bin/tool.js",path.join(modules,"example-tool"));
  if(blockDependencyPreparation)setInterval(()=>{},1000);
  else process.exit(0);
}
if(args.includes("dev.mill.owner=verifier")){
  if(createTarget!=="")mkdirSync(createTarget);
  process.exit(${failVerifier ? 9 : 0});
}
if(!blockDependencyPreparation)process.exit(0);
`,
    { mode: 0o755 },
  );
  await chmod(executable, 0o755);
  return { executable, log };
}

async function cancellingGit(directory: string): Promise<string> {
  const executable = path.join(directory, "git");
  await writeFile(
    executable,
    `#!${process.execPath}
const {spawnSync}=require("node:child_process");
const args=process.argv.slice(2);
const result=spawnSync("/usr/bin/git",args,{env:process.env,stdio:"inherit"});
if(result.status===0&&args.includes("commit"))process.kill(process.ppid,"SIGINT");
process.exit(result.status??1);
`,
    { mode: 0o755 },
  );
  await chmod(executable, 0o755);
  return executable;
}

async function authorityFixture(root: string): Promise<{
  productApprovalDigest: string;
  options: {
    sourceRoot: string;
    prdPath: string;
    sourceManifestPath: string;
    proposalPath: string;
    productApprovalDigest: string;
    repositoryId: string;
    approvedBy: string;
    approvedAt: string;
    authorName: string;
    authorEmail: string;
  };
}> {
  const prd = "# Acme Status\n\nShow a healthy product surface.\n";
  const sources = sourceManifestSchema.parse({
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
        uri: "PRD.md",
        revision: textDigest(prd),
        observedAt: "2026-09-02T14:15:00.000Z",
        freshness: "current",
        authority: "constraint",
        claims: ["The product exposes a healthy web surface."],
      },
    ],
  });
  const product = productContractSchema.parse({
    schemaVersion: "1",
    id: "acme-status",
    title: "Acme Status",
    primaryUser: "Founder",
    jobToBeDone:
      "Start from a qualified, independently operable product while preserving its native repository checks.",
    outcomes: [
      {
        id: "OUT-HEALTHY-WEB",
        statement: "A healthy web product is ready for iteration.",
        acceptanceIds: ["ACC-HEALTHY-WEB"],
      },
    ],
    nonGoals: ["Automatic merge"],
    assumptions: [],
    unknowns: [],
    sourceRefs: ["SRC-PRD"],
    acceptance: [
      {
        id: "ACC-HEALTHY-WEB",
        kind: "functional",
        statement: "The complete native repository gate passes.",
        sourceRefs: ["SRC-PRD"],
      },
    ],
    invariants: [
      {
        id: "INV-NATIVE-CHECK",
        statement: "The repository remains independently testable.",
        owner: "repository",
        criticality: "low",
        surfaceRefs: ["package.json"],
        verification: { mode: "command", ref: "check" },
        sourceRefs: ["SRC-PRD"],
        unknowns: [],
      },
    ],
    decisions: [],
  });
  const productDigest = canonicalDigest(product as unknown as JsonValue);
  const scenarios = scenarioSetSchema.parse({
    schemaVersion: "1",
    productContractDigest: productDigest,
    scenarios: [
      {
        id: "SCN-NATIVE-CHECK",
        kind: "normal",
        given: ["the approved generated or adopted repository"],
        when: ["the native check command runs"],
        then: ["all declared product gates pass"],
        oracleOwner: "repository",
        acceptanceRefs: ["ACC-HEALTHY-WEB"],
        invariantRefs: ["INV-NATIVE-CHECK"],
        coverage: "both",
        visibility: "builder_visible",
        executionRef: "test:browser",
        recipeOracle: "web-title-and-health",
        forbidden: [],
      },
    ],
  });
  const proposal = specificationProposalSchema.parse({
    schemaVersion: "1",
    prd: { path: "PRD.md", digest: textDigest(prd) },
    sourceManifestDigest: canonicalDigest(sources as unknown as JsonValue),
    productContract: product,
    blueprints: [
      {
        schemaVersion: "1",
        id: "node-typescript-next-web",
        productContractDigest: productDigest,
        recipe: "node-typescript-next-web",
        recipeVersion: "1.0.0",
        runtime: "node-24.18.1-npm-11.16.0",
        architecture: ["modular monolith", "Next.js App Router"],
        risks: [],
      },
    ],
    scenarioSet: scenarios,
    assumptions: [],
    contradictions: [],
    questions: [],
    status: "proposed",
  });
  await Promise.all([
    writeFile(path.join(root, "PRD.md"), prd),
    writeFile(path.join(root, "sources.json"), `${JSON.stringify(sources)}\n`),
    writeFile(
      path.join(root, "proposal.json"),
      `${JSON.stringify(proposal)}\n`,
    ),
  ]);
  const productApprovalDigest = canonicalDigest(
    proposal as unknown as JsonValue,
  );
  return {
    productApprovalDigest,
    options: {
      sourceRoot: root,
      prdPath: "PRD.md",
      sourceManifestPath: "sources.json",
      proposalPath: "proposal.json",
      productApprovalDigest,
      repositoryId: "123e4567-e89b-42d3-a456-426614174000",
      approvedBy: "David Ahmann",
      approvedAt: "2026-09-02T14:15:00.000Z",
      authorName: "David Ahmann",
      authorEmail: "david@example.invalid",
    },
  };
}

async function exists(candidate: string): Promise<boolean> {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function seedCompatibleRepository(
  root: string,
): Promise<Awaited<ReturnType<typeof authorityFixture>>> {
  const authority = await authorityFixture(root);
  const rendered = await renderNodeWebRecipe({
    projectName: "adopted-app",
    productTitle: "Acme Status",
  });
  for (const file of rendered) {
    const destination = path.join(root, file.path);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, file.content);
  }
  await git(root, ["init", "--initial-branch=main"]);
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "test: seed compatible app"]);
  return authority;
}

describe("qualified repository integration", { concurrent: false }, () => {
  it("binds the supported recipe digest to its exact rendered assets", async () => {
    const recipe = await loadNodeWebRecipe();
    const rendered = await renderNodeWebRecipe({
      projectName: "Acme Web",
      productTitle: "Acme Status",
    });
    expect(recipe).toMatchObject({
      manifest: {
        status: "supported",
        runtime: { node: "24.18.1", npm: "11.16.0" },
        stack: {
          next: "16.3.4",
          react: "19.2.8",
          typescript: "6.0.3",
          eslint: "9.39.5",
        },
      },
    });
    expect(rendered.some((file) => file.path === "recipe.yaml")).toBe(false);
    expect(rendered.some((file) => file.path.startsWith("node_modules/"))).toBe(
      false,
    );
    const packageSource = rendered.find((file) => file.path === "package.json");
    const lockSource = rendered.find(
      (file) => file.path === "package-lock.json",
    );
    const page = rendered.find((file) => file.path === "app/page.tsx");
    expect(JSON.parse(packageSource?.content ?? "{}")).toMatchObject({
      name: "acme-web",
      dependencies: { next: "16.3.4", react: "19.2.8" },
    });
    expect(JSON.parse(lockSource?.content ?? "{}")).toMatchObject({
      name: "acme-web",
      packages: { "": { name: "acme-web" } },
    });
    expect(page?.content).toContain("Acme Status");
    expect(rendered.find((file) => file.path === "README.md")?.content).toMatch(
      /^# Acme Status\n/u,
    );
    const quoted = await renderNodeWebRecipe({
      projectName: "quoted-title",
      productTitle: 'Acme "Portal" </h1> ~~Beta~~ &copy;',
    });
    expect(
      quoted.find((file) => file.path === "app/page.tsx")?.content,
    ).toContain('{"Acme \\"Portal\\" </h1> ~~Beta~~ &copy;"}');
    expect(
      quoted.find((file) => file.path === "app/layout.tsx")?.content,
    ).toContain('title: "Acme \\"Portal\\" </h1> ~~Beta~~ &copy;"');
    expect(quoted.find((file) => file.path === "README.md")?.content).toContain(
      String.raw`# Acme \"Portal\" \<\/h1\> \~\~Beta\~\~ \&copy\;` + "\n",
    );
    const placeholderTitle = 'MILL_PRODUCT_TITLE_MARKDOWN_TOKEN "exact"';
    const placeholderRendered = await renderNodeWebRecipe({
      projectName: "placeholder-title",
      productTitle: placeholderTitle,
    });
    expect(
      placeholderRendered.find((file) => file.path === "app/page.tsx")?.content,
    ).toContain(`{${JSON.stringify(placeholderTitle)}}`);
    expect(
      quoted.find((file) => file.path === ".gitignore")?.content,
    ).toContain("node_modules");
    const fallback = await renderNodeWebRecipe({
      projectName: "✨",
      productTitle: "Fallback",
    });
    const fallbackPackage = JSON.parse(
      fallback.find((file) => file.path === "package.json")?.content ?? "{}",
    ) as { name?: string };
    expect(fallbackPackage.name).toBe("mill-web-product");
  });

  it("fails closed on ambiguous identity, approval, and target authority", async () => {
    const workspace = await temporaryDirectory("mill-greenfield-authority-");
    try {
      const authority = await authorityFixture(workspace.path);
      const targetDirectory = "new-app";
      await expect(
        planGreenfieldIntegration({
          ...authority.options,
          repositoryId: "not-a-uuid",
          targetDirectory,
        }),
      ).rejects.toMatchObject({ code: "INVALID_REPOSITORY_ID" });
      await expect(
        planGreenfieldIntegration({
          ...authority.options,
          authorEmail: "invalid",
          targetDirectory,
        }),
      ).rejects.toMatchObject({ code: "INVALID_AUTHOR_IDENTITY" });
      await expect(
        planGreenfieldIntegration({
          ...authority.options,
          authorEmail: `${"!@".repeat(100_000)}invalid`,
          targetDirectory,
        }),
      ).rejects.toMatchObject({ code: "INVALID_AUTHOR_IDENTITY" });
      await expect(
        planGreenfieldIntegration({
          ...authority.options,
          approvedBy: "",
          targetDirectory,
        }),
      ).rejects.toMatchObject({ code: "INVALID_AUTHOR_IDENTITY" });
      await expect(
        planGreenfieldIntegration({
          ...authority.options,
          approvedAt: "not-a-time",
          targetDirectory,
        }),
      ).rejects.toMatchObject({ code: "INVALID_APPROVAL_TIME" });
      await expect(
        planGreenfieldIntegration({
          ...authority.options,
          approvedAt: "2026-09-02",
          targetDirectory,
        }),
      ).rejects.toMatchObject({ code: "INVALID_APPROVAL_TIME" });
      await expect(
        planGreenfieldIntegration({
          ...authority.options,
          approvedAt: new Date(Date.now() + 60_000).toISOString(),
          targetDirectory,
        }),
      ).rejects.toMatchObject({ code: "INVALID_APPROVAL_TIME" });
      await expect(
        planGreenfieldIntegration({
          ...authority.options,
          productApprovalDigest: `sha256:${"f".repeat(64)}`,
          targetDirectory,
        }),
      ).rejects.toMatchObject({ code: "PLANNING_APPROVAL_MISMATCH" });
      const proposalPath = path.join(
        workspace.path,
        authority.options.proposalPath,
      );
      const originalProposal = JSON.parse(
        await readFile(proposalPath, "utf8"),
      ) as Record<string, unknown>;
      const unsupportedProposal = structuredClone(originalProposal) as {
        blueprints: { recipe: string; recipeVersion: string }[];
      };
      if (unsupportedProposal.blueprints[0] === undefined) {
        throw new Error("expected one blueprint fixture");
      }
      unsupportedProposal.blueprints[0].recipe = "another-recipe";
      await writeFile(proposalPath, `${JSON.stringify(unsupportedProposal)}\n`);
      await expect(
        planGreenfieldIntegration({
          ...authority.options,
          productApprovalDigest: canonicalDigest(
            unsupportedProposal as unknown as JsonValue,
          ),
          targetDirectory,
        }),
      ).rejects.toMatchObject({ code: "APPROVED_RECIPE_UNSUPPORTED" });
      unsupportedProposal.blueprints[0].recipe = "node-typescript-next-web";
      unsupportedProposal.blueprints[0].recipeVersion = "1.0.1";
      await writeFile(proposalPath, `${JSON.stringify(unsupportedProposal)}\n`);
      await expect(
        planGreenfieldIntegration({
          ...authority.options,
          productApprovalDigest: canonicalDigest(
            unsupportedProposal as unknown as JsonValue,
          ),
          targetDirectory,
        }),
      ).rejects.toMatchObject({ code: "APPROVED_RECIPE_UNSUPPORTED" });
      const unboundScenario = structuredClone(originalProposal) as {
        scenarioSet: { scenarios: { recipeOracle?: string }[] };
      };
      delete unboundScenario.scenarioSet.scenarios[0]?.recipeOracle;
      await writeFile(proposalPath, `${JSON.stringify(unboundScenario)}\n`);
      await expect(
        planGreenfieldIntegration({
          ...authority.options,
          productApprovalDigest: canonicalDigest(
            unboundScenario as unknown as JsonValue,
          ),
          targetDirectory,
        }),
      ).rejects.toMatchObject({ code: "RECIPE_SCENARIO_UNSUPPORTED" });
      const humanInvariant = structuredClone(originalProposal) as {
        productContract: {
          invariants: { verification: { mode: string; ref: string } }[];
        };
        blueprints: { productContractDigest: string }[];
        scenarioSet: { productContractDigest: string };
      };
      if (
        humanInvariant.productContract.invariants[0] === undefined ||
        humanInvariant.blueprints[0] === undefined
      ) {
        throw new Error("expected one invariant and blueprint");
      }
      humanInvariant.productContract.invariants[0].verification = {
        mode: "human",
        ref: "operator-attestation",
      };
      const humanProductDigest = canonicalDigest(
        humanInvariant.productContract,
      );
      humanInvariant.blueprints[0].productContractDigest = humanProductDigest;
      humanInvariant.scenarioSet.productContractDigest = humanProductDigest;
      await writeFile(proposalPath, `${JSON.stringify(humanInvariant)}\n`);
      await expect(
        planGreenfieldIntegration({
          ...authority.options,
          productApprovalDigest: canonicalDigest(
            humanInvariant as unknown as JsonValue,
          ),
          targetDirectory,
        }),
      ).rejects.toMatchObject({ code: "RECIPE_INVARIANT_UNSUPPORTED" });

      const crossingScenario = structuredClone(originalProposal) as {
        productContract: {
          acceptance: {
            id: string;
            kind: "functional";
            statement: string;
            sourceRefs: string[];
          }[];
        };
        blueprints: { productContractDigest: string }[];
        scenarioSet: {
          productContractDigest: string;
          scenarios: { acceptanceRefs: string[] }[];
        };
      };
      if (
        crossingScenario.blueprints[0] === undefined ||
        crossingScenario.scenarioSet.scenarios[0] === undefined
      ) {
        throw new Error("expected one scenario and blueprint");
      }
      crossingScenario.productContract.acceptance.push({
        id: "ACC-OTHER",
        kind: "functional",
        statement: "Another outcome remains separate.",
        sourceRefs: ["SRC-PRD"],
      });
      crossingScenario.scenarioSet.scenarios[0].acceptanceRefs.push(
        "ACC-OTHER",
      );
      const crossingProductDigest = canonicalDigest(
        crossingScenario.productContract,
      );
      crossingScenario.blueprints[0].productContractDigest =
        crossingProductDigest;
      crossingScenario.scenarioSet.productContractDigest =
        crossingProductDigest;
      await writeFile(proposalPath, `${JSON.stringify(crossingScenario)}\n`);
      await expect(
        planGreenfieldIntegration({
          ...authority.options,
          productApprovalDigest: canonicalDigest(
            crossingScenario as unknown as JsonValue,
          ),
          targetDirectory,
        }),
      ).rejects.toMatchObject({ code: "OUTCOME_SCENARIO_SCOPE_INVALID" });

      const riskyProposal = structuredClone(originalProposal) as {
        productContract: { invariants: { criticality: string }[] };
        blueprints: { productContractDigest: string }[];
        scenarioSet: { productContractDigest: string };
      };
      if (
        riskyProposal.productContract.invariants[0] === undefined ||
        riskyProposal.blueprints[0] === undefined
      ) {
        throw new Error("expected risk-bound fixture inputs");
      }
      riskyProposal.productContract.invariants[0].criticality = "high";
      const riskyProductDigest = canonicalDigest(riskyProposal.productContract);
      riskyProposal.blueprints[0].productContractDigest = riskyProductDigest;
      riskyProposal.scenarioSet.productContractDigest = riskyProductDigest;
      await writeFile(proposalPath, `${JSON.stringify(riskyProposal)}\n`);
      await expect(
        planGreenfieldIntegration({
          ...authority.options,
          productApprovalDigest: canonicalDigest(
            riskyProposal as unknown as JsonValue,
          ),
          targetDirectory,
        }),
      ).rejects.toMatchObject({ code: "OUTCOME_RISK_EVIDENCE_REQUIRED" });
      await writeFile(proposalPath, `${JSON.stringify(originalProposal)}\n`);
      await mkdir(path.join(workspace.path, targetDirectory));
      await expect(
        planGreenfieldIntegration({
          ...authority.options,
          targetDirectory,
        }),
      ).rejects.toMatchObject({ code: "GREENFIELD_TARGET_EXISTS" });
      await expect(
        planGreenfieldIntegration({
          ...authority.options,
          targetDirectory: "../escape",
        }),
      ).rejects.toMatchObject({ code: "INVALID_INTEGRATION_PATH" });
      await expect(
        planGreenfieldIntegration({
          ...authority.options,
          targetDirectory: "new-parent/nested-app",
        }),
      ).rejects.toMatchObject({ code: "GREENFIELD_TARGET_ANCESTOR_UNSAFE" });
      await mkdir(path.join(workspace.path, "real-parent"));
      await expect(
        planGreenfieldIntegration({
          ...authority.options,
          targetDirectory: "real-parent/nested-app",
        }),
      ).resolves.toMatchObject({
        plan: { target: { directoryName: "real-parent/nested-app" } },
      });
      await writeFile(
        path.join(workspace.path, "file-parent"),
        "not a directory\n",
      );
      await expect(
        planGreenfieldIntegration({
          ...authority.options,
          targetDirectory: "file-parent/escape",
        }),
      ).rejects.toMatchObject({ code: "GREENFIELD_TARGET_ANCESTOR_UNSAFE" });
      await symlink("..", path.join(workspace.path, "linked-parent"), "dir");
      await expect(
        planGreenfieldIntegration({
          ...authority.options,
          targetDirectory: "linked-parent/escape",
        }),
      ).rejects.toMatchObject({ code: "GREENFIELD_TARGET_ANCESTOR_UNSAFE" });
    } finally {
      await workspace.cleanup();
    }
  });

  it("exposes explicit plan and attended-apply CLI boundaries", async () => {
    const workspace = await temporaryDirectory("mill-integration-cli-");
    const adoption = await temporaryDirectory("mill-adoption-cli-");
    try {
      const authority = await authorityFixture(workspace.path);
      const common = [
        "--prd",
        authority.options.prdPath,
        "--sources",
        authority.options.sourceManifestPath,
        "--proposal",
        authority.options.proposalPath,
        "--approve-product",
        authority.options.productApprovalDigest,
        "--repository-id",
        authority.options.repositoryId,
        "--approved-by",
        authority.options.approvedBy,
        "--approved-at",
        authority.options.approvedAt,
        "--author-name",
        authority.options.authorName,
        "--author-email",
        authority.options.authorEmail,
      ];
      const planned = capture();
      expect(
        await runCli(
          [
            "--json",
            "--cwd",
            workspace.path,
            "new",
            "cli-app",
            "--dry-run",
            ...common,
          ],
          planned.io,
        ),
      ).toBe(0);
      const plannedResult = JSON.parse(planned.stdout.join("")) as {
        data: { approvalDigest: string };
      };
      const unattended = capture();
      expect(
        await runCli(
          [
            "--json",
            "--cwd",
            workspace.path,
            "new",
            "cli-app",
            "--apply",
            ...common,
            "--approve-plan",
            plannedResult.data.approvalDigest,
          ],
          unattended.io,
        ),
      ).toBe(78);
      expect(JSON.parse(unattended.stdout.join(""))).toMatchObject({
        reasons: [{ code: "ATTENDANCE_REQUIRED" }],
      });
      const missingPlanApproval = capture();
      expect(
        await runCli(
          [
            "--json",
            "--cwd",
            workspace.path,
            "new",
            "cli-app",
            "--apply",
            "--attended",
            ...common,
          ],
          missingPlanApproval.io,
        ),
      ).toBe(64);
      expect(JSON.parse(missingPlanApproval.stdout.join(""))).toMatchObject({
        reasons: [{ code: "USAGE_ERROR" }],
      });

      const adoptionAuthority = await seedCompatibleRepository(adoption.path);
      const adoptionCommon = [
        "--prd",
        adoptionAuthority.options.prdPath,
        "--sources",
        adoptionAuthority.options.sourceManifestPath,
        "--proposal",
        adoptionAuthority.options.proposalPath,
        "--approve-product",
        adoptionAuthority.options.productApprovalDigest,
        "--repository-id",
        adoptionAuthority.options.repositoryId,
        "--approved-by",
        adoptionAuthority.options.approvedBy,
        "--approved-at",
        adoptionAuthority.options.approvedAt,
        "--author-name",
        adoptionAuthority.options.authorName,
        "--author-email",
        adoptionAuthority.options.authorEmail,
      ];
      const adoptPlan = capture();
      expect(
        await runCli(
          [
            "--json",
            "--cwd",
            adoption.path,
            "adopt",
            "--plan",
            ...adoptionCommon,
          ],
          adoptPlan.io,
        ),
      ).toBe(0);
      const adoptResult = JSON.parse(adoptPlan.stdout.join("")) as {
        data: { approvalDigest: string };
      };
      const adoptUnattended = capture();
      expect(
        await runCli(
          [
            "--json",
            "--cwd",
            adoption.path,
            "adopt",
            "--apply",
            ...adoptionCommon,
            "--approve-plan",
            adoptResult.data.approvalDigest,
          ],
          adoptUnattended.io,
        ),
      ).toBe(78);
      expect(JSON.parse(adoptUnattended.stdout.join(""))).toMatchObject({
        reasons: [{ code: "ATTENDANCE_REQUIRED" }],
      });
      const adoptMissingApproval = capture();
      expect(
        await runCli(
          [
            "--json",
            "--cwd",
            adoption.path,
            "adopt",
            "--apply",
            "--attended",
            ...adoptionCommon,
          ],
          adoptMissingApproval.io,
        ),
      ).toBe(64);
    } finally {
      await Promise.all([workspace.cleanup(), adoption.cleanup()]);
    }
  });

  it("plans deterministically and applies greenfield creation transactionally", async () => {
    const workspace = await temporaryDirectory("mill-greenfield-");
    const alternateWorkspace = await temporaryDirectory("mill-greenfield-alt-");
    const tools = await temporaryDirectory("mill-greenfield-tools-");
    const state = await temporaryDirectory("mill-greenfield-state-");
    try {
      const authority = await authorityFixture(workspace.path);
      const first = await planGreenfieldIntegration({
        ...authority.options,
        targetDirectory: "generated-app",
      });
      const second = await planGreenfieldIntegration({
        ...authority.options,
        targetDirectory: "generated-app",
      });
      expect(second).toEqual(first);
      const alternateAuthority = await authorityFixture(
        alternateWorkspace.path,
      );
      const alternate = await planGreenfieldIntegration({
        ...alternateAuthority.options,
        targetDirectory: "generated-app",
      });
      expect(alternate.plan.target.directoryName).toBe(
        first.plan.target.directoryName,
      );
      expect(alternate.plan.target.canonicalPathDigest).not.toBe(
        first.plan.target.canonicalPathDigest,
      );
      expect(alternate.approvalDigest).not.toBe(first.approvalDigest);
      expect(first.plan).toMatchObject({
        planDigest: first.approvalDigest,
        generator: {
          package: "@davidahmann/mill",
          version: "0.1.4",
        },
        mode: "greenfield",
        baseline: "unverified",
        commandIds: ["check"],
        recipe: { status: "supported" },
      });
      expect(first.plan.target.canonicalPathDigest).toMatch(
        /^sha256:[a-f0-9]{64}$/u,
      );
      expect(first.plan.files.some((file) => file.path === "mill.lock")).toBe(
        true,
      );
      const productContract = first.files.find(
        (file) => file.path === "product/contract.yaml",
      );
      expect(productContract).toBeDefined();
      expect(
        await format(productContract?.content ?? "", { parser: "yaml" }),
      ).toBe(productContract?.content);
      await expect(
        applyGreenfieldIntegration({
          ...authority.options,
          targetDirectory: "generated-app",
          planApprovalDigest: first.approvalDigest,
          attended: false,
        }),
      ).rejects.toMatchObject({ code: "ATTENDANCE_REQUIRED" });
      await expect(
        applyGreenfieldIntegration({
          ...authority.options,
          targetDirectory: "generated-app",
          planApprovalDigest: `sha256:${"f".repeat(64)}`,
          attended: true,
        }),
      ).rejects.toMatchObject({ code: "INTEGRATION_APPROVAL_MISMATCH" });
      expect(await exists(path.join(workspace.path, "generated-app"))).toBe(
        false,
      );

      const docker = await fakeDocker(tools.path);
      process.env.MILL_DOCKER_PATH = docker.executable;
      process.env.MILL_STATE_HOME = state.path;
      const applied = await applyGreenfieldIntegration({
        ...authority.options,
        targetDirectory: "generated-app",
        planApprovalDigest: first.approvalDigest,
        attended: true,
      });
      const target = path.join(workspace.path, "generated-app");
      expect(applied).toMatchObject({
        repository: "generated-app",
        planDigest: first.approvalDigest,
        baseline: "unverified",
      });
      expect(await git(target, ["rev-parse", "HEAD"])).toBe(
        `${applied.commit}\n`,
      );
      expect(await git(target, ["status", "--porcelain"])).toBe("");
      expect(
        await readFile(path.join(target, "product", "sources.yaml"), "utf8"),
      ).toContain("uri: product/PRD.md");
      expect(
        parseYaml(await readFile(path.join(target, "mill.lock"), "utf8")),
      ).toMatchObject({
        integration: { planDigest: first.approvalDigest },
      });
      expect(await git(target, ["log", "-1", "--format=%B"])).toContain(
        "Signed-off-by: David Ahmann <david@example.invalid>",
      );
      const racedPlan = await planGreenfieldIntegration({
        ...authority.options,
        targetDirectory: "raced-app",
      });
      const racedTarget = path.join(workspace.path, "raced-app");
      const racingDocker = await fakeDocker(
        tools.path,
        false,
        true,
        racedTarget,
      );
      process.env.MILL_DOCKER_PATH = racingDocker.executable;
      await expect(
        applyGreenfieldIntegration({
          ...authority.options,
          targetDirectory: "raced-app",
          planApprovalDigest: racedPlan.approvalDigest,
          attended: true,
        }),
      ).rejects.toMatchObject({ code: "GREENFIELD_TARGET_EXISTS" });
      expect(await readdir(racedTarget)).toEqual([]);
      const detach = await planDetach(target);
      expect(detach).toMatchObject({
        mode: "manual",
        changed: [],
      });
      expect(detach.remove).toEqual(
        expect.arrayContaining(["mill.lock", "mill.yaml"]),
      );
      expect(detach.retain).toEqual(
        expect.arrayContaining(["package.json", "app/page.tsx"]),
      );
      await writeFile(path.join(target, "package.json"), "{}\n");
      await unlink(path.join(target, "app", "page.tsx"));
      expect((await planDetach(target)).changed).toEqual(
        expect.arrayContaining(["package.json", "app/page.tsx"]),
      );
      expect(
        (await readdir(workspace.path)).some((entry) =>
          entry.startsWith(".mill-new-"),
        ),
      ).toBe(false);
    } finally {
      await Promise.all([
        workspace.cleanup(),
        alternateWorkspace.cleanup(),
        tools.cleanup(),
        state.cleanup(),
      ]);
    }
  });

  it("does not publish greenfield authority after cancellation during commit", async () => {
    const workspace = await temporaryDirectory("mill-greenfield-cancel-");
    const tools = await temporaryDirectory("mill-greenfield-cancel-tools-");
    const state = await temporaryDirectory("mill-greenfield-cancel-state-");
    try {
      const authority = await authorityFixture(workspace.path);
      const plan = await planGreenfieldIntegration({
        ...authority.options,
        targetDirectory: "cancelled-app",
      });
      const docker = await fakeDocker(tools.path);
      process.env.MILL_DOCKER_PATH = docker.executable;
      process.env.MILL_GIT_PATH = await cancellingGit(tools.path);
      process.env.MILL_STATE_HOME = state.path;
      await expect(
        applyGreenfieldIntegration({
          ...authority.options,
          targetDirectory: "cancelled-app",
          planApprovalDigest: plan.approvalDigest,
          attended: true,
        }),
      ).rejects.toMatchObject({ code: "GREENFIELD_CANCELLED" });
      expect(await exists(path.join(workspace.path, "cancelled-app"))).toBe(
        false,
      );
    } finally {
      await Promise.all([
        workspace.cleanup(),
        tools.cleanup(),
        state.cleanup(),
      ]);
    }
  });

  it("rechecks cancellation at the final greenfield publication boundary", async () => {
    const workspace = await temporaryDirectory(
      "mill-greenfield-publish-cancel-",
    );
    const tools = await temporaryDirectory(
      "mill-greenfield-publish-cancel-tools-",
    );
    const state = await temporaryDirectory(
      "mill-greenfield-publish-cancel-state-",
    );
    let publicationPoll: NodeJS.Timeout | undefined;
    try {
      const authority = await authorityFixture(workspace.path);
      const target = path.join(workspace.path, "cancelled-app");
      const plan = await planGreenfieldIntegration({
        ...authority.options,
        targetDirectory: "cancelled-app",
      });
      const docker = await fakeDocker(tools.path);
      process.env.MILL_DOCKER_PATH = docker.executable;
      process.env.MILL_STATE_HOME = state.path;
      const controller = new AbortController();
      publicationPoll = setInterval(() => {
        void access(target).then(
          () => controller.abort(),
          () => undefined,
        );
      }, 1);
      await expect(
        applyGreenfieldIntegration({
          ...authority.options,
          targetDirectory: "cancelled-app",
          planApprovalDigest: plan.approvalDigest,
          attended: true,
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({ code: "GREENFIELD_CANCELLED" });
      expect(await exists(target)).toBe(false);
    } finally {
      if (publicationPoll !== undefined) clearInterval(publicationPoll);
      await Promise.all([
        workspace.cleanup(),
        tools.cleanup(),
        state.cleanup(),
      ]);
    }
  });

  it("removes staging and state when generated-repository qualification fails", async () => {
    const workspace = await temporaryDirectory("mill-greenfield-fail-");
    const tools = await temporaryDirectory("mill-greenfield-fail-tools-");
    const state = await temporaryDirectory("mill-greenfield-fail-state-");
    try {
      const authority = await authorityFixture(workspace.path);
      const plan = await planGreenfieldIntegration({
        ...authority.options,
        targetDirectory: "failed-app",
      });
      const docker = await fakeDocker(tools.path, true);
      process.env.MILL_DOCKER_PATH = docker.executable;
      process.env.MILL_STATE_HOME = state.path;
      const target = path.join(await realpath(workspace.path), "failed-app");
      const applyLock = path.join(
        workspace.path,
        `.mill-new-${createHash("sha256").update(target).digest("hex").slice(0, 16)}.lock`,
      );
      await mkdir(applyLock);
      await expect(
        applyGreenfieldIntegration({
          ...authority.options,
          targetDirectory: "failed-app",
          planApprovalDigest: plan.approvalDigest,
          attended: true,
        }),
      ).rejects.toMatchObject({ code: "GREENFIELD_APPLY_ACTIVE" });
      await rm(applyLock, { recursive: true });
      const existingState = repositoryStateDirectory(
        authority.options.repositoryId,
        path.join(target, ".git"),
      );
      await mkdir(existingState, { recursive: true });
      await writeFile(path.join(existingState, "sentinel"), "preserve\n");
      await expect(
        applyGreenfieldIntegration({
          ...authority.options,
          targetDirectory: "failed-app",
          planApprovalDigest: plan.approvalDigest,
          attended: true,
        }),
      ).rejects.toMatchObject({ code: "RECIPE_QUALIFICATION_FAILED" });
      expect(await exists(path.join(workspace.path, "failed-app"))).toBe(false);
      expect(await readFile(path.join(existingState, "sentinel"), "utf8")).toBe(
        "preserve\n",
      );
      expect(
        (await readdir(workspace.path)).some((entry) =>
          entry.startsWith(".mill-new-"),
        ),
      ).toBe(false);
      expect(await readdir(existingState)).toContain("sentinel");
    } finally {
      await Promise.all([
        workspace.cleanup(),
        tools.cleanup(),
        state.cleanup(),
      ]);
    }
  });

  it("applies compatible adoption on an isolated branch without touching the checkout", async () => {
    const repository = await temporaryDirectory("mill-adoption-");
    const tools = await temporaryDirectory("mill-adoption-tools-");
    try {
      const authority = await seedCompatibleRepository(repository.path);
      const ignorePath = path.join(repository.path, ".gitignore");
      await writeFile(
        ignorePath,
        `${await readFile(ignorePath, "utf8")}\nmill.*\n`,
      );
      await git(repository.path, ["add", ".gitignore"]);
      await git(repository.path, [
        "commit",
        "--no-gpg-sign",
        "-m",
        "test: ignore generated mill control files",
      ]);
      const base = (await git(repository.path, ["rev-parse", "HEAD"])).trim();
      const planned = await planAdoptionIntegration({
        ...authority.options,
        repositoryRoot: repository.path,
      });
      expect(planned.plan).toMatchObject({
        planDigest: planned.approvalDigest,
        mode: "adoption",
        target: { baseCommit: base },
        baseline: "unverified",
      });
      await expect(
        applyAdoptionIntegration({
          ...authority.options,
          repositoryRoot: repository.path,
          planApprovalDigest: planned.approvalDigest,
          attended: false,
        }),
      ).rejects.toMatchObject({ code: "ATTENDANCE_REQUIRED" });
      const cancelled = new AbortController();
      cancelled.abort();
      await expect(
        applyAdoptionIntegration({
          ...authority.options,
          repositoryRoot: repository.path,
          planApprovalDigest: planned.approvalDigest,
          attended: true,
          signal: cancelled.signal,
        }),
      ).rejects.toMatchObject({ code: "ADOPTION_CANCELLED" });
      await expect(
        git(repository.path, [
          "rev-parse",
          "--verify",
          `refs/heads/mill/adopt-${planned.approvalDigest.slice(7, 19)}`,
        ]),
      ).rejects.toBeDefined();
      process.env.MILL_GIT_PATH = await cancellingGit(tools.path);
      const applied = await applyAdoptionIntegration({
        ...authority.options,
        repositoryRoot: repository.path,
        planApprovalDigest: planned.approvalDigest,
        attended: true,
      });
      expect(applied).toMatchObject({
        planDigest: planned.approvalDigest,
        baseline: "unverified",
      });
      expect(await git(repository.path, ["rev-parse", "HEAD"])).toBe(
        `${base}\n`,
      );
      expect(await git(repository.path, ["status", "--porcelain"])).toBe("");
      if (originalGit === undefined) delete process.env.MILL_GIT_PATH;
      else process.env.MILL_GIT_PATH = originalGit;
      expect(
        await git(repository.path, ["show", `${applied.branch}:mill.yaml`]),
      ).toContain("trustCeiling: build");
      expect(
        await git(repository.path, ["show", `${applied.branch}:mill.yaml`]),
      ).toContain("eslint.config.mjs");
      expect(
        parseYaml(
          await git(repository.path, ["show", `${applied.branch}:mill.lock`]),
        ),
      ).toMatchObject({
        integration: { planDigest: planned.approvalDigest },
      });
      expect(await git(repository.path, ["rev-parse", applied.branch])).toBe(
        `${applied.commit}\n`,
      );

      await writeFile(path.join(repository.path, "local.txt"), "dirty\n");
      const dirtyPlan = await planAdoptionIntegration({
        ...authority.options,
        repositoryRoot: repository.path,
      });
      await expect(
        applyAdoptionIntegration({
          ...authority.options,
          repositoryRoot: repository.path,
          planApprovalDigest: dirtyPlan.approvalDigest,
          attended: true,
        }),
      ).rejects.toMatchObject({ code: "ADOPTION_CHECKOUT_DIRTY" });
    } finally {
      await Promise.all([repository.cleanup(), tools.cleanup()]);
    }
  });

  it("binds adoption compatibility to the exact visible base tree", async () => {
    const ignored = await temporaryDirectory("mill-adoption-ignored-");
    const hidden = await temporaryDirectory("mill-adoption-hidden-");
    const canonical = await temporaryDirectory("mill-adoption-canonical-");
    const malformed = await temporaryDirectory("mill-adoption-malformed-");
    try {
      const ignoredAuthority = await seedCompatibleRepository(ignored.path);
      const ignorePath = path.join(ignored.path, ".gitignore");
      await writeFile(
        ignorePath,
        `${await readFile(ignorePath, "utf8")}\npackage.json\n`,
      );
      await git(ignored.path, ["rm", "--cached", "package.json"]);
      await git(ignored.path, ["add", ".gitignore"]);
      await git(ignored.path, [
        "commit",
        "--no-gpg-sign",
        "-m",
        "test: leave ignored manifest outside the base",
      ]);
      await expect(
        planAdoptionIntegration({
          ...ignoredAuthority.options,
          repositoryRoot: ignored.path,
        }),
      ).rejects.toMatchObject({ code: "ADOPTION_MANIFEST_INVALID" });

      const hiddenAuthority = await seedCompatibleRepository(hidden.path);
      const packagePath = path.join(hidden.path, "package.json");
      const packageSource = await readFile(packagePath, "utf8");
      await git(hidden.path, [
        "update-index",
        "--skip-worktree",
        "package.json",
      ]);
      await writeFile(packagePath, `${packageSource} `);
      await expect(
        planAdoptionIntegration({
          ...hiddenAuthority.options,
          repositoryRoot: hidden.path,
        }),
      ).rejects.toMatchObject({ code: "HIDDEN_GIT_INDEX_STATE" });
      await git(hidden.path, [
        "update-index",
        "--no-skip-worktree",
        "package.json",
      ]);

      const canonicalAuthority = await seedCompatibleRepository(canonical.path);
      const sourcesPath = path.join(canonical.path, "sources.json");
      const proposalPath = path.join(canonical.path, "proposal.json");
      const sources = JSON.parse(await readFile(sourcesPath, "utf8")) as {
        sources: { uri: string }[];
      };
      if (sources.sources[0] === undefined) throw new Error("source required");
      sources.sources[0].uri = "./PRD.md";
      const proposal = JSON.parse(await readFile(proposalPath, "utf8")) as {
        prd: { path: string };
        sourceManifestDigest: string;
      };
      proposal.prd.path = "./PRD.md";
      proposal.sourceManifestDigest = canonicalDigest(sources);
      await Promise.all([
        writeFile(sourcesPath, `${JSON.stringify(sources)}\n`),
        writeFile(proposalPath, `${JSON.stringify(proposal)}\n`),
      ]);
      await git(canonical.path, ["add", "sources.json", "proposal.json"]);
      await git(canonical.path, [
        "commit",
        "--no-gpg-sign",
        "-m",
        "test: use a noncanonical safe PRD spelling",
      ]);
      await expect(
        planAdoptionIntegration({
          ...canonicalAuthority.options,
          prdPath: "./PRD.md",
          productApprovalDigest: canonicalDigest(
            proposal as unknown as JsonValue,
          ),
          repositoryRoot: canonical.path,
        }),
      ).resolves.toMatchObject({ plan: { mode: "adoption" } });

      const malformedAuthority = await seedCompatibleRepository(malformed.path);
      const malformedPackage = path.join(malformed.path, "package.json");
      const packageBytes = await readFile(malformedPackage);
      await writeFile(
        malformedPackage,
        Buffer.concat([
          packageBytes.subarray(0, packageBytes.byteLength - 2),
          Buffer.from(',\n  "description": "', "utf8"),
          Buffer.from([0xff]),
          Buffer.from('"\n}\n', "utf8"),
        ]),
      );
      await git(malformed.path, ["add", "package.json"]);
      await git(malformed.path, [
        "commit",
        "--no-gpg-sign",
        "-m",
        "test: commit malformed UTF-8",
      ]);
      await expect(
        planAdoptionIntegration({
          ...malformedAuthority.options,
          repositoryRoot: malformed.path,
        }),
      ).rejects.toMatchObject({ code: "INTEGRATION_BASE_FILE_UNSAFE" });
    } finally {
      await Promise.all([
        ignored.cleanup(),
        hidden.cleanup(),
        canonical.cleanup(),
        malformed.cleanup(),
      ]);
    }
  });

  it("rejects incompatible, hazardous, already-managed, and conflicting adoption", async () => {
    const repository = await temporaryDirectory("mill-adoption-negative-");
    try {
      const authority = await seedCompatibleRepository(repository.path);
      const packagePath = path.join(repository.path, "package.json");
      const originalPackage = await readFile(packagePath, "utf8");
      const packageJson = JSON.parse(originalPackage) as {
        dependencies: Record<string, string>;
        scripts: Record<string, string>;
      };

      const sourcesPath = path.join(repository.path, "sources.json");
      const proposalPath = path.join(repository.path, "proposal.json");
      const originalSources = await readFile(sourcesPath, "utf8");
      const originalProposal = await readFile(proposalPath, "utf8");
      const prdSource = await readFile(
        path.join(repository.path, "PRD.md"),
        "utf8",
      );
      const nestedPrdPath = path.join(repository.path, "app", "PRD.md");
      await writeFile(nestedPrdPath, prdSource);
      const nestedSources = JSON.parse(originalSources) as {
        sources: { uri: string }[];
      };
      if (nestedSources.sources[0] === undefined) {
        throw new Error("expected one PRD source");
      }
      nestedSources.sources[0].uri = "app/PRD.md";
      await writeFile(sourcesPath, `${JSON.stringify(nestedSources)}\n`);
      const nestedProposal = JSON.parse(originalProposal) as {
        prd: { path: string };
        sourceManifestDigest: string;
      };
      nestedProposal.prd.path = "app/PRD.md";
      nestedProposal.sourceManifestDigest = canonicalDigest(nestedSources);
      await writeFile(proposalPath, `${JSON.stringify(nestedProposal)}\n`);
      await expect(
        planAdoptionIntegration({
          ...authority.options,
          prdPath: "app/PRD.md",
          productApprovalDigest: canonicalDigest(
            nestedProposal as unknown as JsonValue,
          ),
          repositoryRoot: repository.path,
        }),
      ).rejects.toMatchObject({ code: "PRD_BUILDER_SCOPE_OVERLAP" });
      await Promise.all([
        writeFile(sourcesPath, originalSources),
        writeFile(proposalPath, originalProposal),
        unlink(nestedPrdPath),
      ]);

      await writeFile(packagePath, "{not-json\n");
      await expect(
        planAdoptionIntegration({
          ...authority.options,
          repositoryRoot: repository.path,
        }),
      ).rejects.toMatchObject({ code: "ADOPTION_MANIFEST_INVALID" });

      await writeFile(
        packagePath,
        `${JSON.stringify({
          ...packageJson,
          dependencies: { ...packageJson.dependencies, next: "16.3.3" },
        })}\n`,
      );
      await expect(
        planAdoptionIntegration({
          ...authority.options,
          repositoryRoot: repository.path,
        }),
      ).rejects.toMatchObject({ code: "ADOPTION_ORACLE_INCOMPATIBLE" });

      const withoutCheck = { ...packageJson.scripts };
      delete withoutCheck.check;
      await writeFile(
        packagePath,
        `${JSON.stringify({ ...packageJson, scripts: withoutCheck })}\n`,
      );
      await expect(
        planAdoptionIntegration({
          ...authority.options,
          repositoryRoot: repository.path,
        }),
      ).rejects.toMatchObject({ code: "ADOPTION_ORACLE_INCOMPATIBLE" });

      await writeFile(
        packagePath,
        `${JSON.stringify({
          ...packageJson,
          scripts: { ...packageJson.scripts, lint: "eslint src" },
        })}\n`,
      );
      await expect(
        planAdoptionIntegration({
          ...authority.options,
          repositoryRoot: repository.path,
        }),
      ).rejects.toMatchObject({ code: "ADOPTION_ORACLE_INCOMPATIBLE" });

      await writeFile(packagePath, originalPackage);
      const eslintSource = await readFile(
        path.join(repository.path, "eslint.config.mjs"),
        "utf8",
      );
      await unlink(path.join(repository.path, "eslint.config.mjs"));
      await expect(
        planAdoptionIntegration({
          ...authority.options,
          repositoryRoot: repository.path,
        }),
      ).rejects.toMatchObject({ code: "ADOPTION_ORACLE_INCOMPATIBLE" });
      await writeFile(
        path.join(repository.path, "eslint.config.mjs"),
        eslintSource,
      );
      await writeFile(
        path.join(repository.path, "eslint.config.mjs"),
        "export default [];\n",
      );
      await expect(
        planAdoptionIntegration({
          ...authority.options,
          repositoryRoot: repository.path,
        }),
      ).rejects.toMatchObject({ code: "ADOPTION_ORACLE_INCOMPATIBLE" });
      await writeFile(
        path.join(repository.path, "eslint.config.mjs"),
        eslintSource,
      );
      await git(repository.path, [
        "config",
        "--local",
        "core.hooksPath",
        "hooks",
      ]);
      await expect(
        planAdoptionIntegration({
          ...authority.options,
          repositoryRoot: repository.path,
        }),
      ).rejects.toMatchObject({ code: "ADOPTION_SCAN_BLOCKED" });
      await git(repository.path, ["config", "--unset", "core.hooksPath"]);

      await symlink("..", path.join(repository.path, "quality-link"), "dir");
      await expect(
        planAdoptionIntegration({
          ...authority.options,
          repositoryRoot: repository.path,
        }),
      ).rejects.toMatchObject({ code: "ADOPTION_SCAN_BLOCKED" });
      await unlink(path.join(repository.path, "quality-link"));

      await writeFile(
        path.join(repository.path, ".env.production"),
        "TOKEN=x\n",
      );
      await expect(
        planAdoptionIntegration({
          ...authority.options,
          repositoryRoot: repository.path,
        }),
      ).rejects.toMatchObject({ code: "ADOPTION_SCAN_BLOCKED" });
      await unlink(path.join(repository.path, ".env.production"));

      await writeFile(path.join(repository.path, ".npmrc"), "//registry=:x\n");
      await expect(
        planAdoptionIntegration({
          ...authority.options,
          repositoryRoot: repository.path,
        }),
      ).rejects.toMatchObject({ code: "ADOPTION_SCAN_BLOCKED" });
      await unlink(path.join(repository.path, ".npmrc"));

      await mkdir(path.join(repository.path, "product"), { recursive: true });
      await writeFile(
        path.join(repository.path, "product", "contract.yaml"),
        "conflicting: true\n",
      );
      await expect(
        planAdoptionIntegration({
          ...authority.options,
          repositoryRoot: repository.path,
        }),
      ).rejects.toMatchObject({ code: "ADOPTION_AUTHORITY_CONFLICT" });
      await unlink(path.join(repository.path, "product", "contract.yaml"));

      await writeFile(
        path.join(repository.path, "mill.yaml"),
        'schemaVersion: "1"\n',
      );
      await expect(
        planAdoptionIntegration({
          ...authority.options,
          repositoryRoot: repository.path,
        }),
      ).rejects.toMatchObject({ code: "REPOSITORY_ALREADY_MANAGED" });
    } finally {
      await repository.cleanup();
    }
  });

  it("binds dependency snapshots to image and lock bytes and mounts only scratch outputs writable", async () => {
    const repository = await temporaryDirectory("mill-dependency-repo-");
    const state = await temporaryDirectory("mill-dependency,state-");
    const tools = await temporaryDirectory("mill-dependency-tools-");
    try {
      await Promise.all([
        writeFile(
          path.join(repository.path, "package.json"),
          '{"name":"fixture"}\n',
        ),
        writeFile(
          path.join(repository.path, "package-lock.json"),
          '{"lockfileVersion":3,"packages":{}}\n',
        ),
      ]);
      const config = millConfigSchema.parse({
        schemaVersion: "1",
        repositoryId: "123e4567-e89b-42d3-a456-426614174001",
        trustCeiling: "build",
        sensitivePaths: [],
        verifier: {
          image: `node@sha256:${"a".repeat(64)}`,
          network: "none",
          dependencies: {
            manager: "npm",
            registry: "https://registry.npmjs.org",
            targetPath: "node_modules",
            lockPaths: ["package.json", "package-lock.json"],
          },
        },
        commands: {
          check: {
            argv: ["node", "--test"],
            cwd: ".",
            controlPaths: ["package.json", "package-lock.json"],
            capability: "test",
            required: true,
            timeoutSeconds: 30,
            execution: "oci",
            writablePaths: [".mill-output"],
          },
        },
      });
      process.env.MILL_DOCKER_PATH = path.join(tools.path, "missing-docker");
      await expect(
        prepareDependencySnapshot({
          root: repository.path,
          stateDirectory: state.path,
          config,
          attended: true,
        }),
      ).rejects.toMatchObject({ code: "OCI_RUNTIME_UNAVAILABLE" });
      const unavailableDocker = path.join(tools.path, "docker-unavailable");
      await writeFile(
        unavailableDocker,
        `#!${process.execPath}\nprocess.exit(9);\n`,
        { mode: 0o755 },
      );
      await chmod(unavailableDocker, 0o755);
      process.env.MILL_DOCKER_PATH = unavailableDocker;
      await expect(
        prepareDependencySnapshot({
          root: repository.path,
          stateDirectory: state.path,
          config,
          attended: true,
        }),
      ).rejects.toMatchObject({ code: "VERIFIER_IMAGE_UNAVAILABLE" });
      const docker = await fakeDocker(tools.path);
      process.env.MILL_DOCKER_PATH = docker.executable;
      const completeIntegrity = `sha512-${Buffer.alloc(64).toString("base64")}`;
      await mkdir(path.join(repository.path, "nested"));
      await writeFile(
        path.join(repository.path, "nested", "package-lock.json"),
        '{"lockfileVersion":3,"packages":{}}\n',
      );
      const nestedFirstConfig = millConfigSchema.parse({
        ...config,
        verifier: {
          ...config.verifier,
          dependencies: {
            ...config.verifier?.dependencies,
            manager: "npm",
            registry: "https://registry.npmjs.org",
            targetPath: "node_modules",
            lockPaths: [
              "package.json",
              "nested/package-lock.json",
              "package-lock.json",
            ],
          },
        },
      });
      await writeFile(
        path.join(repository.path, "package-lock.json"),
        `${JSON.stringify({
          lockfileVersion: 3,
          packages: {
            "node_modules/untrusted": {
              resolved: "https://example.invalid/untrusted.tgz",
              integrity: completeIntegrity,
            },
          },
        })}\n`,
      );
      await expect(
        prepareDependencySnapshot({
          root: repository.path,
          stateDirectory: state.path,
          config: nestedFirstConfig,
          attended: true,
        }),
      ).rejects.toMatchObject({ code: "NPM_LOCK_SOURCE_UNTRUSTED" });
      const nestedOnlyConfig = millConfigSchema.parse({
        ...nestedFirstConfig,
        verifier: {
          ...nestedFirstConfig.verifier,
          dependencies: {
            ...nestedFirstConfig.verifier?.dependencies,
            manager: "npm",
            registry: "https://registry.npmjs.org",
            targetPath: "node_modules",
            lockPaths: ["package.json", "nested/package-lock.json"],
          },
        },
      });
      await expect(
        prepareDependencySnapshot({
          root: repository.path,
          stateDirectory: state.path,
          config: nestedOnlyConfig,
          attended: true,
        }),
      ).rejects.toMatchObject({ code: "NPM_LOCK_REQUIRED" });
      for (const [source, code] of [
        ["{not-json\n", "NPM_LOCK_INVALID"],
        ["[]\n", "NPM_LOCK_INVALID"],
        ['{"lockfileVersion":3}\n', "NPM_LOCK_INVALID"],
        [
          '{"lockfileVersion":3,"packages":{"node_modules/example":{"resolved":"https://registry.npmjs.org/example/-/example-1.0.0.tgz"}}}\n',
          "NPM_LOCK_SOURCE_UNTRUSTED",
        ],
        [
          '{"lockfileVersion":3,"packages":{"node_modules/example":{"resolved":"https://registry.npmjs.org/example/-/example-1.0.0.tgz","integrity":"sha512-deadbeef"}}}\n',
          "NPM_LOCK_SOURCE_UNTRUSTED",
        ],
        [
          '{"lockfileVersion":3,"packages":{"node_modules/example":{"integrity":"sha512-deadbeef"}}}\n',
          "NPM_LOCK_SOURCE_UNTRUSTED",
        ],
        [
          '{"lockfileVersion":3,"packages":{"node_modules/example":{"link":true,"resolved":"file:../example","integrity":"sha512-deadbeef"}}}\n',
          "NPM_LOCK_SOURCE_UNTRUSTED",
        ],
        [
          '{"lockfileVersion":3,"packages":{"node_modules/example":{"resolved":"not-a-url","integrity":"sha512-deadbeef"}}}\n',
          "NPM_LOCK_SOURCE_UNTRUSTED",
        ],
        [
          `{"lockfileVersion":3,"packages":{"node_modules/example":{"resolved":"https://user:password@registry.npmjs.org/example/-/example-1.0.0.tgz","integrity":"${completeIntegrity}"}}}\n`,
          "NPM_LOCK_SOURCE_UNTRUSTED",
        ],
        [
          `{"lockfileVersion":3,"packages":{"node_modules/example":{"resolved":"https://registry.npmjs.org/example/-/example-1.0.0.tgz?token=x","integrity":"${completeIntegrity}"}}}\n`,
          "NPM_LOCK_SOURCE_UNTRUSTED",
        ],
      ] as const) {
        await writeFile(
          path.join(repository.path, "package-lock.json"),
          source,
        );
        await expect(
          prepareDependencySnapshot({
            root: repository.path,
            stateDirectory: state.path,
            config,
            attended: true,
          }),
        ).rejects.toMatchObject({ code });
      }
      await writeFile(
        path.join(repository.path, "package-lock.json"),
        `${JSON.stringify({
          lockfileVersion: 3,
          packages: {
            "node_modules/untrusted": {
              resolved: "https://example.invalid/untrusted.tgz",
              integrity: "sha512-deadbeef",
            },
          },
        })}\n`,
      );
      await expect(
        prepareDependencySnapshot({
          root: repository.path,
          stateDirectory: state.path,
          config,
          attended: true,
        }),
      ).rejects.toMatchObject({ code: "NPM_LOCK_SOURCE_UNTRUSTED" });
      await writeFile(
        path.join(repository.path, "package-lock.json"),
        '{"lockfileVersion":3,"packages":{}}\n',
      );
      const noModulesDirectory = path.join(tools.path, "no-modules");
      await mkdir(noModulesDirectory);
      const emptyDocker = await fakeDocker(noModulesDirectory, false, false);
      process.env.MILL_DOCKER_PATH = emptyDocker.executable;
      await expect(
        prepareDependencySnapshot({
          root: repository.path,
          stateDirectory: state.path,
          config,
          attended: true,
        }),
      ).rejects.toMatchObject({ code: "DEPENDENCY_OUTPUT_INVALID" });
      const cancellationTools = path.join(tools.path, "cancellation");
      await mkdir(cancellationTools);
      const blockingDocker = await fakeDocker(
        cancellationTools,
        false,
        true,
        undefined,
        true,
      );
      process.env.MILL_DOCKER_PATH = blockingDocker.executable;
      const controller = new AbortController();
      const cancellation = prepareDependencySnapshot({
        root: repository.path,
        stateDirectory: state.path,
        config,
        attended: true,
        signal: controller.signal,
      });
      let installerStarted = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const log = await readFile(blockingDocker.log, "utf8").catch(() => "");
        if (log.includes("dev.mill.owner=dependency-preparation")) {
          installerStarted = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(installerStarted).toBe(true);
      controller.abort();
      await expect(cancellation).rejects.toMatchObject({
        code: "DEPENDENCY_PREPARATION_FAILED",
      });
      expect(
        (await readFile(blockingDocker.log, "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as string[])
          .some((args) => args[0] === "rm" && args.includes("--force")),
      ).toBe(true);
      process.env.MILL_DOCKER_PATH = docker.executable;
      await expect(
        prepareDependencySnapshot({
          root: repository.path,
          stateDirectory: state.path,
          config: millConfigSchema.parse({
            schemaVersion: "1",
            repositoryId: "123e4567-e89b-42d3-a456-426614174001",
            trustCeiling: "inspect",
            commands: {},
          }),
          attended: true,
        }),
      ).rejects.toMatchObject({
        code: "BUILD_NOT_AUTHORIZED",
      });
      await expect(
        prepareDependencySnapshot({
          root: repository.path,
          stateDirectory: state.path,
          config: millConfigSchema.parse({
            schemaVersion: "1",
            repositoryId: "123e4567-e89b-42d3-a456-426614174001",
            trustCeiling: "build",
            commands: {},
          }),
          attended: true,
        }),
      ).rejects.toMatchObject({
        code: "VERIFIER_DEPENDENCIES_NOT_CONFIGURED",
      });
      await expect(
        prepareDependencySnapshot({
          root: repository.path,
          stateDirectory: state.path,
          config,
          attended: false,
        }),
      ).rejects.toMatchObject({ code: "ATTENDANCE_REQUIRED" });
      expect(
        await dependencySnapshotDirectory({
          root: repository.path,
          stateDirectory: state.path,
          config: millConfigSchema.parse({
            schemaVersion: "1",
            repositoryId: "123e4567-e89b-42d3-a456-426614174001",
            trustCeiling: "inspect",
            commands: {},
          }),
        }),
      ).toBeUndefined();
      const prepared = await prepareDependencySnapshot({
        root: repository.path,
        stateDirectory: state.path,
        config,
        attended: true,
      });
      expect(prepared.reused).toBe(false);
      const markerPath = path.join(prepared.directory, "marker.json");
      const markerSource = await readFile(markerPath, "utf8");
      await writeFile(markerPath, "{}\n");
      const preparationLease = new DatabaseSync(
        `${prepared.directory}.lease.sqlite3`,
        { timeout: 0 },
      );
      preparationLease.exec("BEGIN EXCLUSIVE");
      try {
        await expect(
          prepareDependencySnapshot({
            root: repository.path,
            stateDirectory: state.path,
            config,
            attended: true,
          }),
        ).rejects.toMatchObject({ code: "DEPENDENCY_PREPARATION_ACTIVE" });
      } finally {
        preparationLease.exec("ROLLBACK");
        preparationLease.close();
      }
      await writeFile(markerPath, markerSource);
      expect(
        (
          await prepareDependencySnapshot({
            root: repository.path,
            stateDirectory: state.path,
            config,
            attended: true,
          })
        ).reused,
      ).toBe(true);
      for (const invalidMarker of ["{not-json\n", "{}\n"]) {
        await writeFile(markerPath, invalidMarker);
        await expect(
          dependencySnapshotDirectory({
            root: repository.path,
            stateDirectory: state.path,
            config,
          }),
        ).rejects.toMatchObject({ code: "VERIFIER_DEPENDENCIES_UNAVAILABLE" });
      }
      await writeFile(markerPath, markerSource);
      expect(
        (
          await prepareDependencySnapshot({
            root: repository.path,
            stateDirectory: state.path,
            config,
            attended: true,
          })
        ).reused,
      ).toBe(true);
      await writeFile(
        path.join(prepared.directory, "node_modules", "tampered.js"),
        "export default 'tampered';\n",
      );
      await expect(
        dependencySnapshotDirectory({
          root: repository.path,
          stateDirectory: state.path,
          config,
        }),
      ).rejects.toMatchObject({ code: "VERIFIER_DEPENDENCIES_UNAVAILABLE" });
      const repairedSnapshot = await prepareDependencySnapshot({
        root: repository.path,
        stateDirectory: state.path,
        config,
        attended: true,
      });
      expect(repairedSnapshot).toMatchObject({
        directory: prepared.directory,
        reused: false,
      });
      await expect(
        access(
          path.join(repairedSnapshot.directory, "node_modules", "tampered.js"),
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
      expect(
        await dependencySnapshotDirectory({
          root: repository.path,
          stateDirectory: state.path,
          config,
        }),
      ).toBe(prepared.directory);
      const task = taskPacketV1Schema.parse({
        schemaVersion: "1",
        id: "dependency-fixture",
        title: "Dependency fixture",
        objective: "Verify exact dependency mounting.",
        riskClass: "low",
        baseRef: "HEAD",
        authority: {
          productContract: {
            path: "product.yaml",
            digest: `sha256:${"b".repeat(64)}`,
          },
          scenarioSet: {
            path: "scenarios.yaml",
            digest: `sha256:${"c".repeat(64)}`,
          },
          policy: { path: "WORKFLOW.md", digest: `sha256:${"d".repeat(64)}` },
        },
        contextPaths: ["package.json"],
        allowedPaths: ["src/**"],
        commandIds: ["check"],
        acceptance: [{ id: "ACC-CHECK", statement: "The check passes." }],
        commit: {
          message: "test: dependency fixture",
          authorName: "Mill Test",
          authorEmail: "mill-test@example.invalid",
        },
        budget: { deadlineSeconds: 60, maxOutputBytes: 1048576, retryCount: 0 },
      });
      const evidence = await verifyDeclaredCommands({
        root: repository.path,
        dependencyRoot: prepared.directory,
        candidateCommit: "a".repeat(40),
        config,
        task,
        deadlineMs: Date.now() + 30_000,
        maxOutputBytes: 1024 * 1024,
      });
      expect(evidence.passed).toBe(true);
      const calls = (await readFile(docker.log, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as string[]);
      const verifier = calls.find(
        (args) => args[0] === "run" && args.includes("dev.mill.owner=verifier"),
      );
      const installer = calls.find(
        (args) =>
          args[0] === "run" &&
          args.includes("dev.mill.owner=dependency-preparation"),
      );
      expect(installer).toEqual(expect.arrayContaining(["--pull", "never"]));
      expect(verifier).toEqual(
        expect.arrayContaining([
          "--pull",
          "never",
          expect.stringContaining("target=/workspace/node_modules,readonly"),
          "type=tmpfs,target=/workspace/.mill-output,tmpfs-size=268435456,tmpfs-mode=1777",
        ]),
      );
      expect(
        verifier?.find((value) =>
          value.includes("target=/workspace/node_modules"),
        ),
      ).not.toContain(",state-");

      await writeFile(
        path.join(repository.path, "package-lock.json"),
        '{"lockfileVersion":2}\n',
      );
      await expect(
        dependencySnapshotDirectory({
          root: repository.path,
          stateDirectory: state.path,
          config,
        }),
      ).rejects.toMatchObject({ code: "VERIFIER_DEPENDENCIES_UNAVAILABLE" });
      await expect(
        verifyDeclaredCommands({
          root: repository.path,
          dependencyRoot: prepared.directory,
          candidateCommit: "a".repeat(40),
          config,
          task,
          deadlineMs: Date.now() + 30_000,
          maxOutputBytes: 1024 * 1024,
        }),
      ).rejects.toMatchObject({ code: "VERIFIER_DEPENDENCY_LOCK_DRIFT" });
    } finally {
      await Promise.all([
        repository.cleanup(),
        state.cleanup(),
        tools.cleanup(),
      ]);
    }
  });
});
