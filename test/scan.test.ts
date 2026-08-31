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
      expect(scan.gitConfigHazards).toContain("core.hookspath");
      expect(scan.executableBaseline).toBe("unverified");
      await expect(access(marker)).rejects.toThrow();
    } finally {
      await temporary.cleanup();
    }
  });

  it("classifies executable Git config and binds it into the report digest", async () => {
    const temporary = await temporaryDirectory("mill-scan-config-");
    try {
      await mkdir(path.join(temporary.path, ".git"));
      await writeFile(path.join(temporary.path, "package.json"), "{}\n");
      await writeFile(path.join(temporary.path, ".git", "config"), "[core]\n");
      const clean = await scanRepository(temporary.path);
      await writeFile(
        path.join(temporary.path, ".git", "config"),
        '[diff "unsafe"]\n  external = /tmp/untrusted-helper\n',
      );
      const hazardous = await scanRepository(temporary.path);
      expect(hazardous.gitConfigHazards).toContain("diff.external");
      expect(hazardous.digest).not.toBe(clean.digest);
    } finally {
      await temporary.cleanup();
    }
  });

  it("recognizes the supported executable Git configuration families", async () => {
    const temporary = await temporaryDirectory("mill-scan-config-families-");
    try {
      await mkdir(path.join(temporary.path, ".git"));
      await writeFile(
        path.join(temporary.path, ".git", "config"),
        [
          "# every value is inert fixture text; Mill never executes it",
          "[include]",
          "  path = fixture",
          '[includeIf "gitdir:fixture"]',
          "  path = fixture",
          "[core]",
          "  askpass = fixture",
          "  editor = fixture",
          "  fsmonitor = fixture",
          "  gitProxy = fixture",
          "  hooksPath = fixture",
          "  pager = fixture",
          "  sshCommand = fixture",
          "[credential]",
          "  helper = fixture",
          '[diff "fixture"]',
          "  external = fixture",
          "  textconv = fixture",
          '[filter "fixture"]',
          "  clean = fixture",
          "  process = fixture",
          "  smudge = fixture",
          '[merge "fixture"]',
          "  driver = fixture",
          "[gpg]",
          "  program = fixture",
          '[pager "fixture"]',
          "  log = fixture",
          "[interactive]",
          "  diffFilter = fixture",
          "[sequence]",
          "  editor = fixture",
          '[difftool "fixture"]',
          "  cmd = fixture",
          '[mergetool "fixture"]',
          "  cmd = fixture",
          '[remote "fixture"]',
          "  receivepack = fixture",
          "  uploadpack = fixture",
          '[submodule "fixture"]',
          "  update = fixture",
          '[alias "fixture"]',
          "  run = !fixture",
          "",
        ].join("\n"),
      );
      const scan = await scanRepository(temporary.path);
      expect(scan.gitConfigHazards).toEqual([
        "alias.run",
        "core.askpass",
        "core.editor",
        "core.fsmonitor",
        "core.gitproxy",
        "core.hookspath",
        "core.pager",
        "core.sshcommand",
        "credential.helper",
        "diff.external",
        "diff.textconv",
        "difftool.cmd",
        "filter.clean",
        "filter.process",
        "filter.smudge",
        "gpg.program",
        "include.path",
        "includeif.path",
        "interactive.difffilter",
        "merge.driver",
        "mergetool.cmd",
        "pager.log",
        "remote.receivepack",
        "remote.uploadpack",
        "sequence.editor",
        "submodule.update",
      ]);
    } finally {
      await temporary.cleanup();
    }
  });

  it("allows ordinary repository identity config and blocks unknown keys", async () => {
    const temporary = await temporaryDirectory(
      "mill-scan-config-default-deny-",
    );
    try {
      await mkdir(path.join(temporary.path, ".git"));
      await writeFile(
        path.join(temporary.path, ".git", "config"),
        [
          "[core]",
          "  repositoryFormatVersion = 0",
          "  fileMode = true",
          '[remote "origin"]',
          "  url = https://github.com/example/repository.git",
          "  fetch = +refs/heads/*:refs/remotes/origin/*",
          '[branch "main"]',
          "  remote = origin",
          "  merge = refs/heads/main",
          "",
        ].join("\n"),
      );
      await expect(scanRepository(temporary.path)).resolves.toMatchObject({
        gitConfigHazards: [],
      });
      await writeFile(
        path.join(temporary.path, ".git", "config"),
        "[core]\n  unknownFutureKey = fixture\n",
      );
      const unknown = await scanRepository(temporary.path);
      expect(unknown.gitConfigHazards).toEqual([
        "unclassified_git_config:core.unknownfuturekey",
      ]);
    } finally {
      await temporary.cleanup();
    }
  });

  it("counts directories against the entry budget", async () => {
    const temporary = await temporaryDirectory("mill-scan-budget-");
    try {
      await mkdir(path.join(temporary.path, "one"));
      await mkdir(path.join(temporary.path, "two"));
      await expect(
        scanRepository(temporary.path, { maxEntries: 1 }),
      ).rejects.toMatchObject({ code: "SCAN_BUDGET_EXCEEDED" });
    } finally {
      await temporary.cleanup();
    }
  });

  it("reports rather than hides depth truncation", async () => {
    const temporary = await temporaryDirectory("mill-scan-depth-");
    try {
      await mkdir(path.join(temporary.path, "one", "two"), {
        recursive: true,
      });
      await writeFile(
        path.join(temporary.path, "one", "two", "package.json"),
        "{}\n",
      );
      const scan = await scanRepository(temporary.path, { maxDepth: 0 });
      expect(scan.truncatedDirectories).toEqual(["one"]);
      expect(scan.observations).toContainEqual({
        kind: "conflicting",
        subject: "static_scan_incomplete_at_depth_limit",
        sources: ["one"],
        confidence: "high",
      });
    } finally {
      await temporary.cleanup();
    }
  });
});
