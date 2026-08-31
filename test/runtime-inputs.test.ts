import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadMillConfig, loadRuntimeInputs } from "../src/runtime/inputs.js";
import { runtimeFixture } from "./runtime-fixture.js";

describe("runtime input contracts", () => {
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
