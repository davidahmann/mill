import { readFile } from "node:fs/promises";
import path from "node:path";

import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { contractSchemas } from "../src/contracts/schemas.js";

const digest = `sha256:${"a".repeat(64)}`;
const samples = {
  managedRepository: {
    schemaVersion: "1",
    id: "123e4567-e89b-12d3-a456-426614174000",
    forgeHost: "github.com",
    owner: "example",
    repository: "app",
    canonicalBranch: "main",
    remoteName: "origin",
    remoteUrl: "https://github.com/example/app.git",
    trustCeiling: "inspect",
  },
  productContract: {
    schemaVersion: "1",
    id: "product",
    title: "Product",
    primaryUser: "Founder",
    jobToBeDone: "Ship an outcome",
    outcomes: ["Reviewed PR"],
    nonGoals: [],
    assumptions: [],
    unknowns: [],
    sourceRefs: ["product/PRD.md"],
  },
  blueprint: {
    schemaVersion: "1",
    id: "blueprint",
    productContractDigest: digest,
    recipe: "node-cli",
    recipeVersion: "1.0.0",
    runtime: "node-24",
    architecture: ["modular monolith"],
    risks: [],
  },
  scenarioSet: {
    schemaVersion: "1",
    productContractDigest: digest,
    scenarios: [
      {
        id: "normal",
        kind: "normal",
        given: ["approved input"],
        when: ["run"],
        then: ["reviewed candidate"],
        oracleOwner: "repository",
      },
    ],
  },
  outcomePlan: {
    schemaVersion: "1",
    productContractDigest: digest,
    outcomes: [
      {
        id: "o1",
        title: "Outcome",
        acceptance: ["works"],
        dependsOn: [],
        status: "approved",
      },
    ],
  },
  millConfig: {
    schemaVersion: "1",
    repositoryId: "123e4567-e89b-12d3-a456-426614174000",
    trustCeiling: "inspect",
    commands: {
      test: { argv: ["npm", "test"], cwd: ".", capability: "test" },
    },
  },
  millLock: {
    schemaVersion: "1",
    mill: { package: "@davidahmann/mill", version: "0.0.0-development" },
    schemaDigests: {},
  },
} as const;

const schemaFiles = {
  managedRepository: "managed-repository.schema.json",
  productContract: "product-contract.schema.json",
  blueprint: "blueprint.schema.json",
  scenarioSet: "scenario-set.schema.json",
  outcomePlan: "outcome-plan.schema.json",
  millConfig: "mill-config.schema.json",
  millLock: "mill-lock.schema.json",
} as const;

describe("compact schemas", () => {
  it("keeps executable JSON Schemas aligned with runtime validators", async () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    ajv.addFormat(
      "uuid",
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
    );
    ajv.addFormat("uri", (value) => {
      try {
        void new URL(value);
        return true;
      } catch {
        return false;
      }
    });
    for (const kind of Object.keys(
      schemaFiles,
    ) as (keyof typeof schemaFiles)[]) {
      const source = await readFile(
        path.join("schemas", schemaFiles[kind]),
        "utf8",
      );
      const validate = ajv.compile(JSON.parse(source));
      expect(validate(samples[kind]), JSON.stringify(validate.errors)).toBe(
        true,
      );
      expect(contractSchemas[kind].safeParse(samples[kind]).success).toBe(true);
      const withUnknown = { ...samples[kind], unexpected: true };
      expect(validate(withUnknown)).toBe(false);
      expect(contractSchemas[kind].safeParse(withUnknown).success).toBe(false);
    }
  });

  it("rejects mutable or local Mill lock selectors in both validators", async () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const validate = ajv.compile(
      JSON.parse(
        await readFile(path.join("schemas", "mill-lock.schema.json"), "utf8"),
      ),
    );
    for (const version of ["latest", "^1.2.3", "file:../mill.tgz", "01.2.3"]) {
      const candidate = {
        schemaVersion: "1",
        mill: { package: "@davidahmann/mill", version },
      };
      expect(validate(candidate), version).toBe(false);
      expect(
        contractSchemas.millLock.safeParse(candidate).success,
        version,
      ).toBe(false);
    }
  });

  it("keeps map-key constraints aligned between JSON and runtime schemas", async () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    ajv.addFormat(
      "uuid",
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
    );
    const millConfig = ajv.compile(
      JSON.parse(
        await readFile(path.join("schemas", "mill-config.schema.json"), "utf8"),
      ),
    );
    const configWithEmptyKey = {
      ...samples.millConfig,
      commands: {
        "": { argv: ["npm"], cwd: ".", capability: "read" },
      },
    };
    expect(millConfig(configWithEmptyKey)).toBe(false);
    expect(
      contractSchemas.millConfig.safeParse(configWithEmptyKey).success,
    ).toBe(false);

    const millLock = ajv.compile(
      JSON.parse(
        await readFile(path.join("schemas", "mill-lock.schema.json"), "utf8"),
      ),
    );
    const lockWithEmptyKey = {
      ...samples.millLock,
      schemaDigests: { "": `sha256:${"a".repeat(64)}` },
    };
    expect(millLock(lockWithEmptyKey)).toBe(false);
    expect(contractSchemas.millLock.safeParse(lockWithEmptyKey).success).toBe(
      false,
    );
  });
});
