import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadMillConfig, loadRuntimeInputs } from "../src/runtime/inputs.js";
import { runtimeFixture, rewriteFixtureAuthority } from "./runtime-fixture.js";

describe("runtime input contracts", () => {
  it("rejects an exact expert packet that undercovers its declared outcome", async () => {
    const fixture = await runtimeFixture();
    try {
      await rewriteFixtureAuthority(fixture, ({ product }) => {
        product.acceptance.push({
          id: "ACC-SECOND",
          kind: "functional",
          statement: "A second required behavior is preserved.",
          sourceRefs: ["SRC-PRD"],
        });
        const outcome = product.outcomes[0];
        if (outcome === undefined) throw new Error("missing outcome");
        outcome.acceptanceIds = ["ACC-POSITIVE", "ACC-SECOND"];
      });
      await expect(
        loadRuntimeInputs(fixture.root, fixture.taskPath),
      ).rejects.toMatchObject({
        code: "CONTINUITY_AUTHORITY_BLOCKED",
        details: {
          blockers: [
            "impact acceptance must equal the declared outcome acceptance: OUT-POSITIVE-VALUE",
          ],
        },
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("fails closed for escaping paths, invalid YAML, and invalid schemas", async () => {
    const fixture = await runtimeFixture();
    try {
      await expect(
        loadRuntimeInputs(fixture.root, "../task.yaml"),
      ).rejects.toMatchObject({ code: "INVALID_RUNTIME_PATH" });

      await writeFile(path.join(fixture.root, "mill.yaml"), "invalid: [\n");
      await expect(loadMillConfig(fixture.root)).rejects.toMatchObject({
        code: "INVALID_RUNTIME_CONTRACT",
      });

      await writeFile(
        path.join(fixture.root, "mill.yaml"),
        "schemaVersion: '1'\n",
      );
      await expect(loadMillConfig(fixture.root)).rejects.toMatchObject({
        code: "INVALID_RUNTIME_CONTRACT",
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects unknown command identities and runtime paths", async () => {
    const fixture = await runtimeFixture();
    try {
      const taskFile = path.join(fixture.root, fixture.taskPath);
      const task = await readFile(taskFile, "utf8");
      await writeFile(
        taskFile,
        task.replace("commandIds:\n  - test", "commandIds:\n  - missing"),
      );
      await expect(
        loadRuntimeInputs(fixture.root, fixture.taskPath),
      ).rejects.toMatchObject({ code: "UNKNOWN_COMMAND_ID" });

      await writeFile(
        taskFile,
        task.replace("  - WORKFLOW.md", "  - ../WORKFLOW.md"),
      );
      await expect(
        loadRuntimeInputs(fixture.root, fixture.taskPath),
      ).rejects.toMatchObject({ code: "INVALID_RUNTIME_PATH" });
    } finally {
      await fixture.cleanup();
    }
  });
});
