import { access, mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { scanRepository } from "../src/repository/scan.js";
import { temporaryDirectory } from "./helpers.js";

describe("static repository scan", () => {
  it("reports a clean missing-manifest baseline without inventing execution evidence", async () => {
    const temporary = await temporaryDirectory("mill-scan-empty-");
    try {
      await writeFile(path.join(temporary.path, "notes.txt"), "notes");
      const scan = await scanRepository(temporary.path);
      expect(scan.gitConfigHazards).toEqual([]);
      expect(scan.observations).toContainEqual({
        kind: "missing",
        subject: "build_manifests",
        sources: [],
        confidence: "high",
      });
      expect(scan.digest).toMatch(/^sha256:/u);
    } finally {
      await temporary.cleanup();
    }
  });

  it("reports manifests, skips symlinks, flags hazardous Git config, and executes nothing", async () => {
    const temporary = await temporaryDirectory("mill-scan-");
    const marker = path.join(temporary.path, "executed-marker");
    try {
      await mkdir(path.join(temporary.path, ".git"));
      await mkdir(path.join(temporary.path, ".github", "workflows"), {
        recursive: true,
      });
      await writeFile(
        path.join(temporary.path, "package.json"),
        '{"scripts":{"test":"touch executed-marker"}}',
      );
      await writeFile(path.join(temporary.path, "README.md"), "# Fixture\n");
      await writeFile(
        path.join(temporary.path, ".github", "workflows", "ci.yml"),
        "name: ci\n",
      );
      await writeFile(
        path.join(temporary.path, ".git", "config"),
        "[core]\n  hooksPath = ./hooks\n",
      );
      await symlink(marker, path.join(temporary.path, "linked-secret"));

      const scan = await scanRepository(temporary.path);
      expect(scan.manifests).toEqual(["package.json"]);
      expect(scan.workflows).toEqual([
        path.join(".github", "workflows", "ci.yml"),
      ]);
      expect(scan.symlinksSkipped).toEqual(["linked-secret"]);
      expect(scan.gitConfigHazards).not.toHaveLength(0);
      expect(scan.executableBaseline).toBe("unverified");
      await expect(access(marker)).rejects.toThrow();
    } finally {
      await temporary.cleanup();
    }
  });
});
