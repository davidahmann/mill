import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { promisify } from "node:util";

const execute = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const baseImage =
  "node:24-bookworm@sha256:f22d6a1f082c02f292e86929b5b0442ac2e5eaf438a5dea9b1566601c3e05940";
const imageTag = "local/mill-pnpm-oci-canary:node24-pnpm10-23";
const workspace = await mkdtemp(path.join(tmpdir(), "mill-pnpm-oci-"));
const state = await mkdtemp(path.join(tmpdir(), "mill-pnpm-oci-state-"));

try {
  await execute("docker", ["pull", baseImage], { cwd: root });
  const [
    { millConfigSchema },
    { prepareDependencySnapshot },
    { verifyDeclaredCommands },
  ] = await Promise.all([
    import("../dist/contracts/schemas.js"),
    import("../dist/runtime/dependencies.js"),
    import("../dist/runtime/verifier.js"),
  ]);
  await mkdir(path.join(workspace, "packages", "service"), {
    recursive: true,
  });
  await mkdir(path.join(workspace, "packages", "cli"), { recursive: true });
  await writeFile(
    path.join(workspace, "Dockerfile.verifier"),
    [
      `FROM ${baseImage}`,
      "ENV COREPACK_HOME=/opt/corepack",
      'RUN corepack enable pnpm && corepack install --global pnpm@10.23.0 && test "$(/usr/local/bin/pnpm --version)" = 10.23.0 && chmod -R a+rX /opt/corepack',
      "USER node",
    ].join("\n"),
  );
  await Promise.all([
    writeFile(
      path.join(workspace, "package.json"),
      `${JSON.stringify(
        {
          name: "mill-pnpm-oci-canary",
          private: true,
          type: "module",
          packageManager: "pnpm@10.23.0",
        },
        null,
        2,
      )}\n`,
    ),
    writeFile(
      path.join(workspace, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n",
    ),
    writeFile(
      path.join(workspace, "pnpm-lock.yaml"),
      [
        "lockfileVersion: '9.0'",
        "settings:",
        "  autoInstallPeers: true",
        "importers:",
        "  .: {}",
        "  packages/cli:",
        "    dependencies:",
        "      '@mill-pnpm/service':",
        "        specifier: workspace:*",
        "        version: link:../service",
        "  packages/service: {}",
        "packages: {}",
        "",
      ].join("\n"),
    ),
    writeFile(
      path.join(workspace, "packages", "service", "package.json"),
      `${JSON.stringify(
        {
          name: "@mill-pnpm/service",
          version: "1.0.0",
          type: "module",
          exports: "./index.mjs",
        },
        null,
        2,
      )}\n`,
    ),
    writeFile(
      path.join(workspace, "packages", "service", "index.mjs"),
      "export const ownerFor = (configuration) => configuration === 'custom' ? 'finance' : 'sales';\n",
    ),
    writeFile(
      path.join(workspace, "packages", "cli", "package.json"),
      `${JSON.stringify(
        {
          name: "@mill-pnpm/cli",
          version: "1.0.0",
          type: "module",
          dependencies: { "@mill-pnpm/service": "workspace:*" },
          bin: { "mill-pnpm-cli": "./index.mjs" },
        },
        null,
        2,
      )}\n`,
    ),
    writeFile(
      path.join(workspace, "packages", "cli", "index.mjs"),
      [
        "import assert from 'node:assert/strict';",
        "import { mkdir, writeFile } from 'node:fs/promises';",
        "import http from 'node:http';",
        "import { DatabaseSync } from 'node:sqlite';",
        "import { ownerFor } from '@mill-pnpm/service';",
        "const owner = ownerFor(process.env.MILL_PNPM_CONFIGURATION ?? 'custom');",
        "assert.equal(owner, 'finance');",
        "const database = new DatabaseSync('scratch/check.sqlite');",
        "database.exec('CREATE TABLE checks (owner TEXT NOT NULL)');",
        "database.prepare('INSERT INTO checks(owner) VALUES (?)').run(owner);",
        "database.close();",
        "const server = http.createServer((_request, response) => response.end(owner));",
        "await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));",
        "const address = server.address();",
        "if (address === null || typeof address === 'string') throw new Error('server did not bind');",
        "const body = await new Promise((resolve, reject) => {",
        "  http.get({ host: '127.0.0.1', port: address.port }, (response) => {",
        "    let value = ''; response.setEncoding('utf8'); response.on('data', (chunk) => { value += chunk; });",
        "    response.on('end', () => resolve(value));",
        "  }).on('error', reject);",
        "});",
        "server.close();",
        "assert.equal(body, owner);",
        "const artifactRoot = process.env.MILL_ARTIFACTS_DIR;",
        "if (artifactRoot === undefined) throw new Error('artifact output is unavailable');",
        "await mkdir(`${artifactRoot}/reports`, { recursive: true });",
        "await writeFile(`${artifactRoot}/reports/pnpm-oci.json`, JSON.stringify({ owner, body }) + '\\n');",
        "await writeFile(`${artifactRoot}/reports/owner's.json`, 'ok');",
      ].join("\n"),
    ),
  ]);
  await execute(
    "docker",
    [
      "build",
      "--pull=false",
      "--file",
      path.join(workspace, "Dockerfile.verifier"),
      "--tag",
      imageTag,
      workspace,
    ],
    { cwd: root },
  );
  const inspected = JSON.parse(
    (
      await execute("docker", ["image", "inspect", imageTag], {
        cwd: root,
      })
    ).stdout,
  );
  const image = inspected[0]?.RepoDigests?.find(
    (candidate) =>
      typeof candidate === "string" &&
      candidate.startsWith("local/mill-pnpm-oci-canary@sha256:"),
  );
  if (typeof image !== "string") {
    throw new Error(
      "pnpm OCI canary image is not locally addressable by digest",
    );
  }
  const config = millConfigSchema.parse({
    schemaVersion: "1",
    repositoryId: "8e4a811a-c1fa-4aa7-8d21-94d50b2bc770",
    trustCeiling: "build",
    sensitivePaths: [],
    verifier: {
      image,
      network: "none",
      dependencies: {
        manager: "pnpm",
        version: "10.23.0",
        registry: "https://registry.npmjs.org",
        targetPath: "node_modules",
        lockPaths: ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"],
        workspacePaths: ["packages/*"],
      },
    },
    commands: {
      pnpm_oci: {
        argv: ["/usr/local/bin/node", "packages/cli/index.mjs"],
        cwd: ".",
        controlPaths: [
          "package.json",
          "pnpm-lock.yaml",
          "pnpm-workspace.yaml",
          "packages/**",
        ],
        capability: "test",
        required: true,
        timeoutSeconds: 60,
        execution: "oci",
        writablePaths: ["scratch"],
        retainedArtifacts: {
          paths: ["reports/pnpm-oci.json", "reports/owner's.json"],
          required: true,
          maxFiles: 2,
          maxFileBytes: 4096,
          maxTotalBytes: 4096,
        },
      },
      expected_failure: {
        argv: ["/usr/local/bin/node", "-e", "process.exit(7)"],
        cwd: ".",
        controlPaths: ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"],
        capability: "test",
        required: false,
        timeoutSeconds: 30,
        execution: "oci",
      },
      expected_timeout: {
        argv: ["/usr/local/bin/node", "-e", "setInterval(() => {}, 1_000)"],
        cwd: ".",
        controlPaths: ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"],
        capability: "test",
        required: false,
        timeoutSeconds: 1,
        execution: "oci",
      },
      expected_cancellation: {
        argv: ["/usr/local/bin/node", "-e", "setInterval(() => {}, 1_000)"],
        cwd: ".",
        controlPaths: ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"],
        capability: "test",
        required: false,
        timeoutSeconds: 30,
        execution: "oci",
      },
    },
  });
  const prepared = await prepareDependencySnapshot({
    root: workspace,
    stateDirectory: state,
    config,
    attended: true,
  });
  const evidence = await verifyDeclaredCommands({
    root: workspace,
    dependencyRoot: prepared.directory,
    artifactDirectory: path.join(state, "artifacts"),
    candidateCommit: "a".repeat(40),
    config,
    task: { commandIds: ["pnpm_oci"] },
    deadlineMs: Date.now() + 90_000,
    maxOutputBytes: 1024 * 1024,
  });
  if (!evidence.passed) {
    throw new Error(
      `pnpm OCI canary did not pass: ${JSON.stringify(
        evidence.commands.map((command) => ({
          commandId: command.commandId,
          status: command.status,
          exitCode: command.exitCode,
          reason: command.reason ?? null,
          outputDigest: command.outputDigest,
        })),
      )}`,
    );
  }
  const artifact = evidence.commands[0]?.artifacts?.find(
    (candidate) => candidate.path === "reports/pnpm-oci.json",
  );
  if (artifact?.path !== "reports/pnpm-oci.json") {
    throw new Error(
      "pnpm OCI canary did not retain its declared scenario report",
    );
  }
  const report = await readFile(
    path.join(
      state,
      "artifacts",
      createHash("sha256").update("pnpm_oci").digest("hex"),
      artifact.path,
    ),
    "utf8",
  );
  if (JSON.parse(report).owner !== "finance") {
    throw new Error("pnpm OCI canary retained an unexpected scenario report");
  }
  const apostropheArtifact = evidence.commands[0]?.artifacts?.find(
    (candidate) => candidate.path === "reports/owner's.json",
  );
  if (apostropheArtifact?.bytes !== 2) {
    throw new Error(
      "pnpm OCI canary did not retain the apostrophe-path scenario report",
    );
  }
  const assertNoVerifierContainers = async () => {
    const result = await execute(
      "docker",
      ["ps", "--all", "--quiet", "--filter", "label=dev.mill.owner=verifier"],
      { cwd: root },
    );
    if (result.stdout.trim() !== "") {
      throw new Error("pnpm OCI canary left a verifier container behind");
    }
  };
  const negativeControl = async (commandId, expectedReason, extra = {}) => {
    const result = await verifyDeclaredCommands({
      root: workspace,
      dependencyRoot: prepared.directory,
      artifactDirectory: path.join(state, "artifacts-negative", commandId),
      candidateCommit: "a".repeat(40),
      config,
      task: { commandIds: [commandId] },
      deadlineMs: Date.now() + 10_000,
      maxOutputBytes: 1024 * 1024,
      ...extra,
    });
    const command = result.commands[0];
    if (command?.status !== "failed" || command.reason !== expectedReason) {
      throw new Error(
        `pnpm OCI ${commandId} control did not produce ${expectedReason}: ${JSON.stringify(command)}`,
      );
    }
    await assertNoVerifierContainers();
    return { commandId, reason: command.reason };
  };
  const failure = await negativeControl("expected_failure", "NONZERO_EXIT");
  const timeout = await negativeControl(
    "expected_timeout",
    "DEADLINE_EXCEEDED",
  );
  const controller = new globalThis.AbortController();
  const cancellationTimer = setTimeout(() => controller.abort(), 1_000);
  let cancellation;
  try {
    cancellation = await negativeControl("expected_cancellation", "CANCELLED", {
      signal: controller.signal,
    });
  } finally {
    clearTimeout(cancellationTimer);
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: "1",
        status: "passed",
        image,
        pnpm: "10.23.0",
        artifact,
        dependencySnapshotReused: prepared.reused,
        negativeControls: [failure, timeout, cancellation],
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await Promise.all([
    rm(workspace, { recursive: true, force: true }),
    rm(state, { recursive: true, force: true }),
  ]);
}
