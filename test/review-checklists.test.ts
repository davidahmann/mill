import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import {
  captureReviewScope,
  loadReviewChecklistContents,
} from "../src/runtime/repository.js";
import { temporaryDirectory } from "./helpers.js";

const execFileAsync = promisify(execFile);
const gitExecutable = process.env.MILL_GIT_PATH ?? "/usr/bin/git";

async function git(root: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync(
    gitExecutable,
    [
      "-c",
      "user.name=Mill Test",
      "-c",
      "user.email=mill-test@example.invalid",
      ...args,
    ],
    { cwd: root, encoding: "utf8" },
  );
  return result.stdout.trim();
}

describe("review checklists", () => {
  it("selects matching base-owned guidance and binds its digest", async () => {
    const directory = await temporaryDirectory("mill-review-checklist-");
    try {
      await git(directory.path, ["init", "-q"]);
      await mkdir(path.join(directory.path, "policy"));
      await mkdir(path.join(directory.path, "src"));
      await writeFile(
        path.join(directory.path, "policy", "runtime.md"),
        "# Runtime review\n\n- Check state transitions.\n",
      );
      await writeFile(
        path.join(directory.path, "src", "value.ts"),
        "export const value = 1;\n",
      );
      await git(directory.path, ["add", "."]);
      await git(directory.path, ["commit", "-qm", "base"]);
      const base = await git(directory.path, ["rev-parse", "HEAD"]);
      await writeFile(
        path.join(directory.path, "src", "value.ts"),
        "export const value = 2;\n",
      );
      await git(directory.path, ["commit", "-qam", "candidate"]);
      const candidate = await git(directory.path, ["rev-parse", "HEAD"]);
      const scope = await captureReviewScope(directory.path, base, candidate, {
        riskClass: "medium",
        checklists: [
          {
            id: "runtime",
            path: "policy/runtime.md",
            pathPatterns: ["src/**"],
          },
          {
            id: "docs",
            path: "policy/runtime.md",
            pathPatterns: ["docs/**"],
          },
        ],
      });
      expect(scope.checklists).toHaveLength(1);
      expect(scope.checklists?.[0]).toMatchObject({
        id: "runtime",
        path: "policy/runtime.md",
      });
      expect(scope.checklists?.[0]?.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
      const loaded = await loadReviewChecklistContents({
        root: directory.path,
        baseCommit: scope.baseCommit,
        checklists: scope.checklists ?? [],
      });
      expect(loaded).toHaveLength(1);
      expect(loaded[0]?.id).toBe("runtime");
      expect(loaded[0]?.content).toContain("state transitions");
    } finally {
      await directory.cleanup();
    }
  });
});
