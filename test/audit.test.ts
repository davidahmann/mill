import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import { auditRepository } from "../src/audit/repository.js";
import { canonicalDigest, type JsonValue } from "../src/contracts/canonical.js";
import { temporaryDirectory } from "./helpers.js";

function git(root: string, arguments_: readonly string[]): void {
  execFileSync(
    "/usr/bin/git",
    [
      "-c",
      "user.name=Mill Audit Test",
      "-c",
      "user.email=mill-audit@example.invalid",
      ...arguments_,
    ],
    { cwd: root, stdio: "ignore" },
  );
}

async function write(root: string, relative: string, content: string) {
  const destination = path.join(root, relative);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, content);
}

async function auditFixture() {
  const temporary = await temporaryDirectory("mill-audit-");
  const productSource = `schemaVersion: "1"
id: audit-fixture
title: Audit fixture
primaryUser: Maintainer
jobToBeDone: Prove the bounded audit.
outcomes:
  - id: OUT-AUDITED
    statement: The repository is audited.
nonGoals: []
assumptions: []
unknowns: []
sourceRefs: [SRC-PRD]
acceptance:
  - id: ACC-AUDITED
    kind: quality
    statement: Required audit categories pass.
    sourceRefs: [SRC-PRD]
invariants:
  - id: INV-AUDITED
    statement: Audit evidence remains explicit.
    owner: repository
    criticality: high
    surfaceRefs: [docs]
    verification: { mode: command, ref: check }
    sourceRefs: [SRC-PRD]
    unknowns: []
decisions: []
`;
  const digest = canonicalDigest(parseYaml(productSource) as JsonValue);
  await Promise.all([
    write(temporary.path, "product/PRD.md", "# Product\n"),
    write(temporary.path, "product/contract.yaml", productSource),
    write(
      temporary.path,
      "quality/scenarios.yaml",
      `schemaVersion: "1"
productContractDigest: ${digest}
scenarios:
  - id: SCN-AUDIT
    kind: normal
    given: [a repository]
    when: [the audit runs]
    then: [the result is explicit]
    oracleOwner: repository
    acceptanceRefs: [ACC-AUDITED]
    invariantRefs: [INV-AUDITED]
    coverage: both
    visibility: builder_visible
    executionRef: check
    forbidden: []
`,
    ),
    write(
      temporary.path,
      "recipes/node-typescript-next-web/recipe.yaml",
      `schemaVersion: "1"
id: node-typescript-next-web
version: 1.0.0
status: supported
observedAt: "2026-09-03T10:00:00.000Z"
runtime: { node: 24.18.1, npm: 11.16.0 }
stack:
  next: 16.3.4
  react: 19.2.8
  reactDom: 19.2.8
  typescript: 6.0.3
  eslint: 9.39.5
  prettier: 3.9.6
  vitest: 4.1.11
  playwright: 1.62.1
verifierImage: image@sha256:${"b".repeat(64)}
registry: https://registry.npmjs.org
licensePolicy:
  allowed: [MIT]
  reviewedPackages: [{ name: next, license: MIT }]
commands:
  required: [check]
  native: [test:browser, check]
oracles:
  - id: web
    commandId: test:browser
    evidencePaths: [app/page.tsx]
    proves: [the page is delivered]
writablePaths: [.next]
sources: [https://example.com]
`,
    ),
    write(
      temporary.path,
      "package.json",
      `${JSON.stringify(
        {
          name: "@davidahmann/mill",
          version: "0.1.0",
          dependencies: { yaml: "2.9.0" },
          publishConfig: { access: "public", provenance: true },
        },
        undefined,
        2,
      )}\n`,
    ),
    write(
      temporary.path,
      "package-lock.json",
      `${JSON.stringify({ lockfileVersion: 3, packages: { "": {} } })}\n`,
    ),
    write(
      temporary.path,
      "README.md",
      "# Mill\n\n## Why Mill\n\nValue.\n\n## Quick start\n\nRun `millctl start`.\n",
    ),
    write(
      temporary.path,
      "AGENTS.md",
      "# Agents\n\n## Operating Mill\n\n## Authority hierarchy\n\n## Recovery\n\n## Stop conditions\n",
    ),
    write(
      temporary.path,
      "architecture/ARCHITECTURE.md",
      "TypeScript modular monolith; there is no daemon.\n",
    ),
    write(
      temporary.path,
      "WORKFLOW.md",
      "Mill uses five vertical waves. Factory skills are optional.\n",
    ),
    write(
      temporary.path,
      "docs/development.md",
      "## Testing matrix\n\nAccessibility uses `test:browser`.\n\n## Review convergence\n",
    ),
    write(
      temporary.path,
      "SECURITY.md",
      "Use private vulnerability reporting. Mill does not store credentials.\n",
    ),
    write(
      temporary.path,
      "SUPPORT.md",
      "Use GitHub Issues. Support is best-effort.\n",
    ),
    write(
      temporary.path,
      "docs/release.md",
      "## Genesis release\n\n## Withdrawal\n",
    ),
    write(
      temporary.path,
      ".github/workflows/release.yml",
      '# compare-release-artifacts.mjs\n# npm publish "$artifact"\n',
    ),
    write(temporary.path, "src/index.ts", "export {};\n"),
  ]);
  git(temporary.path, ["init", "--initial-branch=main"]);
  git(temporary.path, ["add", "."]);
  git(temporary.path, ["commit", "--no-gpg-sign", "-m", "test: seed audit"]);
  return temporary;
}

describe("bounded repository audit", () => {
  it("reports every required category against a clean exact candidate", async () => {
    const fixture = await auditFixture();
    try {
      const report = await auditRepository({
        root: fixture.path,
        now: new Date("2026-09-03T12:00:00.000Z"),
      });
      expect(report.status).toBe("passed");
      expect(new Set(report.checks.map((check) => check.category))).toEqual(
        new Set([
          "product",
          "code",
          "ux",
          "accessibility",
          "security",
          "dependencies",
          "architecture",
          "operations",
          "release",
        ]),
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("returns a blocked proposal instead of hiding a missing operator path", async () => {
    const fixture = await auditFixture();
    try {
      await write(fixture.path, "README.md", "# Mill\n");
      git(fixture.path, ["add", "README.md"]);
      git(fixture.path, ["commit", "--no-gpg-sign", "-m", "test: break docs"]);
      const report = await auditRepository({ root: fixture.path });
      expect(report.status).toBe("blocked");
      expect(
        report.checks.find((check) => check.category === "ux")?.status,
      ).toBe("blocked");
    } finally {
      await fixture.cleanup();
    }
  });
});
