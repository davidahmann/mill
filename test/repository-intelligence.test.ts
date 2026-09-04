import { execFile } from "node:child_process";
import { access, mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  assessDiscoveryFreshness,
  discoverRepository,
} from "../src/repository/intelligence.js";
import { runCli } from "../src/cli-program.js";
import type { MillError } from "../src/errors.js";
import {
  assessImpactManifest,
  loadImpactPlanningInputs,
} from "../src/planning/impact.js";
import { temporaryDirectory } from "./helpers.js";

const execFileAsync = promisify(execFile);

async function git(root: string, args: readonly string[]): Promise<void> {
  await execFileAsync("git", ["-C", root, ...args], { encoding: "utf8" });
}

async function repositoryFixture(): Promise<{
  path: string;
  cleanup: () => Promise<void>;
}> {
  const fixture = await temporaryDirectory("mill-intelligence-");
  await mkdir(path.join(fixture.path, "src", "nested"), { recursive: true });
  await writeFile(
    path.join(fixture.path, "package.json"),
    JSON.stringify(
      {
        name: "fixture",
        scripts: {
          test: "vitest run src/*.test.ts",
          lint: "eslint .",
        },
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(fixture.path, "src", "math.ts"),
    "export const add = (a: number, b: number) => a + b;\n",
  );
  await writeFile(
    path.join(fixture.path, "src", "service.ts"),
    [
      'import { add } from "./math.js";',
      'export type { Result } from "./types.js";',
      "export const total = add(1, 2);",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(fixture.path, "src", "types.ts"),
    "export interface Result { value: number; }\n",
  );
  await writeFile(
    path.join(fixture.path, "src", "service.test.ts"),
    'import { total } from "./service.js";\nvoid total;\n',
  );
  await writeFile(
    path.join(fixture.path, "src", "nested", "adapter.test.ts"),
    'import { total } from "../service.js";\nvoid total;\n',
  );
  await writeFile(
    path.join(fixture.path, "src", "unresolved.ts"),
    'import { missing } from "./missing.js";\nvoid missing;\n',
  );
  await git(fixture.path, ["init", "--quiet"]);
  await git(fixture.path, ["add", "."]);
  await git(fixture.path, [
    "-c",
    "user.name=Mill fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  ]);
  return fixture;
}

describe("repository intelligence", () => {
  it("keeps the bounded brownfield contract and impact closure independently assessable", async () => {
    const inputs = await loadImpactPlanningInputs({
      root: process.cwd(),
      productPath: "product/brownfield-contract.yaml",
      scenarioPath: "quality/brownfield-scenarios.yaml",
      impactPath: "product/impacts/BROWNFIELD_DISCOVERY.yaml",
    });
    expect(assessImpactManifest(inputs)).toMatchObject({
      approved: true,
      blockers: [],
    });
  });

  it("exposes the same read-only report through the public CLI", async () => {
    const fixture = await repositoryFixture();
    const stdout: string[] = [];
    const stderr: string[] = [];
    try {
      const exitCode = await runCli(
        [
          "--json",
          "--cwd",
          fixture.path,
          "discover",
          ".",
          "--changed",
          "src/math.ts",
        ],
        {
          stdout: { write: (value) => void stdout.push(value) },
          stderr: { write: (value) => void stderr.push(value) },
        },
      );
      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);
      expect(JSON.parse(stdout.join(""))).toMatchObject({
        schemaVersion: "1",
        command: "discover",
        ok: true,
        data: {
          authority: "derived_read_only",
          changeImpact: [{ changedPath: "src/math.ts" }],
        },
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("derives deterministic source-linked imports, bounded test selection, and impact leads", async () => {
    const fixture = await repositoryFixture();
    const marker = path.join(fixture.path, "executed-marker");
    try {
      const first = await discoverRepository({
        root: fixture.path,
        changedPaths: ["src/math.ts"],
      });
      const second = await discoverRepository({
        root: fixture.path,
        changedPaths: ["src/math.ts"],
      });

      expect(second).toEqual(first);
      expect(first.authority).toBe("derived_read_only");
      expect(first.source.commit).toMatch(/^[a-f0-9]{40}$/u);
      expect(
        first.modules.find((module) => module.path === "src/service.ts"),
      ).toMatchObject({
        imports: [
          {
            kind: "static",
            specifier: "./math.js",
            resolution: "resolved_local",
            targetPath: "src/math.ts",
            location: { path: "src/service.ts", line: 1, column: 21 },
          },
          {
            kind: "type",
            specifier: "./types.js",
            resolution: "resolved_local",
            targetPath: "src/types.ts",
          },
        ],
      });
      expect(
        first.modules.find((module) => module.path === "src/unresolved.ts"),
      ).toMatchObject({
        imports: [
          {
            specifier: "./missing.js",
            resolution: "unresolved",
          },
        ],
      });
      expect(first.tests.inventory.map((entry) => entry.path)).toEqual([
        "src/nested/adapter.test.ts",
        "src/service.test.ts",
      ]);
      expect(first.tests.declaredSelection).toEqual([
        {
          script: "test",
          command: "vitest run src/*.test.ts",
          selector: "src/*.test.ts",
          matchedInventory: ["src/service.test.ts"],
          status: "observed",
        },
      ]);
      expect(first.tests.executedCoverage).toBe("unknown");
      expect(first.changeImpact).toEqual([
        {
          changedPath: "src/math.ts",
          leads: [
            { path: "src/math.ts", relationship: "changed" },
            {
              path: "src/service.ts",
              relationship: "direct_importer",
              via: "src/math.ts",
            },
            {
              path: "src/nested/adapter.test.ts",
              relationship: "transitive_importer",
              via: "src/service.ts",
            },
            {
              path: "src/service.test.ts",
              relationship: "transitive_importer",
              via: "src/service.ts",
            },
          ],
          unknowns: [],
        },
      ]);
      await expect(access(marker)).rejects.toThrow();
    } finally {
      await fixture.cleanup();
    }
  });

  it("marks changed extractor or source identities stale and refuses an unobserved path to prove unaffectedness", async () => {
    const fixture = await repositoryFixture();
    try {
      const report = await discoverRepository({
        root: fixture.path,
        changedPaths: ["src/not-observed.ts"],
      });
      expect(report.changeImpact).toEqual([
        {
          changedPath: "src/not-observed.ts",
          leads: [],
          unknowns: ["changed_path_not_observed_no_unaffectedness_claim"],
        },
      ]);
      expect(assessDiscoveryFreshness(report, report)).toEqual({
        fresh: true,
        reasons: [],
      });
      expect(
        assessDiscoveryFreshness(report, {
          ...report,
          source: { ...report.source, tree: "b".repeat(40) },
        }),
      ).toEqual({ fresh: false, reasons: ["source_tree_changed"] });
      expect(
        assessDiscoveryFreshness(report, {
          ...report,
          extractor: {
            ...report.extractor,
            digest: `sha256:${"a".repeat(64)}`,
          },
        }),
      ).toEqual({ fresh: false, reasons: ["extractor_identity_changed"] });
    } finally {
      await fixture.cleanup();
    }
  });

  it("records dynamic and require edges, static-selector uncertainty, syntax errors, and Git-root boundaries", async () => {
    const fixture = await repositoryFixture();
    const nonRepository = await temporaryDirectory("mill-intelligence-no-git-");
    try {
      await writeFile(
        path.join(fixture.path, "src", "edge.ts"),
        [
          'void import("./math.js");',
          'void require("./types.js");',
          "const = ;",
          "",
        ].join("\n"),
      );
      await writeFile(
        path.join(fixture.path, "package.json"),
        JSON.stringify({ scripts: { test: "vitest run" } }),
      );
      await git(fixture.path, ["add", "."]);
      await git(fixture.path, [
        "-c",
        "user.name=Mill fixture",
        "-c",
        "user.email=fixture@example.test",
        "commit",
        "--quiet",
        "-m",
        "edge fixture",
      ]);

      const report = await discoverRepository({ root: fixture.path });
      expect(
        report.modules.find((module) => module.path === "src/edge.ts"),
      ).toMatchObject({
        imports: [
          { kind: "dynamic", targetPath: "src/math.ts" },
          { kind: "require", targetPath: "src/types.ts" },
        ],
      });
      expect(
        report.modules.find((module) => module.path === "src/edge.ts")
          ?.parseDiagnostics,
      ).not.toEqual([]);
      expect(report.tests.declaredSelection).toEqual([
        {
          script: "test",
          command: "vitest run",
          selector: "static_selection_unknown",
          matchedInventory: [],
          status: "unknown",
        },
      ]);
      await expect(
        discoverRepository({
          root: fixture.path,
          changedPaths: ["../outside.ts"],
        }),
      ).rejects.toMatchObject({
        code: "INVALID_CHANGED_PATH",
      } satisfies Partial<MillError>);
      await expect(
        discoverRepository({ root: path.join(fixture.path, "src") }),
      ).rejects.toMatchObject({
        code: "DISCOVERY_ROOT_NOT_GIT_ROOT",
      } satisfies Partial<MillError>);
      await writeFile(
        path.join(nonRepository.path, "value.ts"),
        "export {};\n",
      );
      await expect(
        discoverRepository({ root: nonRepository.path }),
      ).rejects.toMatchObject({
        code: "GIT_IDENTITY_UNAVAILABLE",
      } satisfies Partial<MillError>);
    } finally {
      await Promise.all([fixture.cleanup(), nonRepository.cleanup()]);
    }
  });

  it("fails closed for dirty sources, sensitive paths, unsafe Git configuration, and path escape", async () => {
    const fixture = await repositoryFixture();
    try {
      await writeFile(path.join(fixture.path, "dirty.ts"), "export {};\n");
      await expect(
        discoverRepository({ root: fixture.path }),
      ).rejects.toMatchObject({
        code: "DISCOVERY_DIRTY_SOURCE",
      } satisfies Partial<MillError>);
      await git(fixture.path, ["add", "."]);
      await git(fixture.path, [
        "-c",
        "user.name=Mill fixture",
        "-c",
        "user.email=fixture@example.test",
        "commit",
        "--quiet",
        "-m",
        "dirty fixture",
      ]);

      await writeFile(path.join(fixture.path, ".env"), "not-a-real-secret\n");
      await expect(
        discoverRepository({ root: fixture.path }),
      ).rejects.toMatchObject({
        code: "DISCOVERY_SENSITIVE_PATH",
      } satisfies Partial<MillError>);
      await git(fixture.path, ["add", ".env"]);
      await git(fixture.path, [
        "-c",
        "user.name=Mill fixture",
        "-c",
        "user.email=fixture@example.test",
        "commit",
        "--quiet",
        "-m",
        "sensitive fixture",
      ]);
      await expect(
        discoverRepository({ root: fixture.path }),
      ).rejects.toMatchObject({
        code: "DISCOVERY_SENSITIVE_PATH",
      } satisfies Partial<MillError>);

      await writeFile(
        path.join(fixture.path, ".git", "config"),
        "[core]\n  hooksPath = hooks\n",
      );
      await expect(
        discoverRepository({ root: fixture.path }),
      ).rejects.toMatchObject({
        code: "UNSAFE_GIT_CONFIGURATION",
      } satisfies Partial<MillError>);
      await expect(
        discoverRepository({
          root: fixture.path,
          changedPaths: ["../outside.ts"],
        }),
      ).rejects.toMatchObject({
        code: "UNSAFE_GIT_CONFIGURATION",
      } satisfies Partial<MillError>);
    } finally {
      await fixture.cleanup();
    }
  });

  it("refuses symbolic links without dereferencing them", async () => {
    const fixture = await repositoryFixture();
    try {
      await symlink("src/math.ts", path.join(fixture.path, "linked.ts"));
      await expect(
        discoverRepository({ root: fixture.path }),
      ).rejects.toMatchObject({
        code: "DISCOVERY_INCOMPLETE_SOURCE",
      } satisfies Partial<MillError>);
      await git(fixture.path, ["add", "linked.ts"]);
      await git(fixture.path, [
        "-c",
        "user.name=Mill fixture",
        "-c",
        "user.email=fixture@example.test",
        "commit",
        "--quiet",
        "-m",
        "link fixture",
      ]);
      await expect(
        discoverRepository({ root: fixture.path }),
      ).rejects.toMatchObject({
        code: "DISCOVERY_INCOMPLETE_SOURCE",
      } satisfies Partial<MillError>);
    } finally {
      await fixture.cleanup();
    }
  });
});
