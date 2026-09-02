import { chmod, mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  doctor,
  doctorReady,
  isSupportedNodeVersion,
  type DoctorReport,
} from "../src/doctor.js";
import { temporaryDirectory } from "./helpers.js";

describe("doctor", () => {
  it("reports inspect, build, and propose requirements without repository execution", async () => {
    const temporary = await temporaryDirectory("mill-doctor-");
    try {
      await mkdir(path.join(temporary.path, ".git"));
      const inspect = await doctor(temporary.path, "inspect");
      expect(inspect.runtime).toMatchObject({
        name: "node",
        required: true,
        available: true,
      });
      expect(inspect.tools.find((tool) => tool.name === "git")).toMatchObject({
        required: true,
        available: true,
      });
      expect(
        inspect.tools.find((tool) => tool.name === "codex")?.required,
      ).toBe(false);
      expect(inspect.tools.find((tool) => tool.name === "gh")?.required).toBe(
        false,
      );
      expect(doctorReady(inspect)).toBe(true);

      const build = await doctor(temporary.path, "build");
      expect(build.tools.find((tool) => tool.name === "codex")?.required).toBe(
        true,
      );
      const propose = await doctor(temporary.path, "propose");
      expect(propose.tools.find((tool) => tool.name === "gh")?.required).toBe(
        true,
      );
      expect(
        propose.tools.find((tool) => tool.name === "codex")?.required,
      ).toBe(false);
    } finally {
      await temporary.cleanup();
    }
  });

  it("fails readiness when a required tool, runtime, or lock is unavailable", () => {
    const blocked: DoctorReport = {
      mode: "inspect",
      root: ".",
      runtime: { name: "node", required: true, available: false },
      tools: [{ name: "git", required: true, available: false }],
      lock: { found: true, compatible: false },
    };
    expect(doctorReady(blocked)).toBe(false);
  });

  it("enforces the complete supported Node range", () => {
    expect(isSupportedNodeVersion("24.19.9")).toBe(false);
    expect(isSupportedNodeVersion("24.20.0")).toBe(true);
    expect(isSupportedNodeVersion("24.21.0")).toBe(true);
    expect(isSupportedNodeVersion("25.0.0")).toBe(false);
    expect(isSupportedNodeVersion("not-a-version")).toBe(false);
  });

  it("accepts an explicit non-repository Codex executable", async () => {
    const repository = await temporaryDirectory("mill-doctor-repo-");
    const tools = await temporaryDirectory("mill-doctor-tools-");
    const previous = process.env.MILL_CODEX_PATH;
    try {
      await mkdir(path.join(repository.path, ".git"));
      const codex = path.join(tools.path, "codex");
      await writeFile(codex, "#!/bin/sh\nprintf 'codex-cli fixture\\n'\n");
      await chmod(codex, 0o755);
      process.env.MILL_CODEX_PATH = codex;
      const report = await doctor(repository.path, "build");
      expect(report.tools.find((tool) => tool.name === "codex")).toMatchObject({
        available: true,
        executable: await realpath(codex),
        required: true,
      });
    } finally {
      if (previous === undefined) {
        delete process.env.MILL_CODEX_PATH;
      } else {
        process.env.MILL_CODEX_PATH = previous;
      }
      await Promise.all([repository.cleanup(), tools.cleanup()]);
    }
  });

  it("fails closed on a relative explicit tool override", async () => {
    const repository = await temporaryDirectory("mill-doctor-relative-repo-");
    const tools = await temporaryDirectory("mill-doctor-relative-tools-");
    const previous = process.env.MILL_GIT_PATH;
    try {
      await mkdir(path.join(repository.path, ".git"));
      const git = path.join(tools.path, "git");
      await writeFile(git, "#!/bin/sh\nprintf 'fixture git\\n'\n");
      await chmod(git, 0o755);
      process.env.MILL_GIT_PATH = path.relative(process.cwd(), git);

      const report = await doctor(repository.path, "inspect");
      expect(report.tools.find((tool) => tool.name === "git")).toMatchObject({
        available: false,
        required: true,
      });
      expect(doctorReady(report)).toBe(false);
    } finally {
      if (previous === undefined) {
        delete process.env.MILL_GIT_PATH;
      } else {
        process.env.MILL_GIT_PATH = previous;
      }
      await Promise.all([repository.cleanup(), tools.cleanup()]);
    }
  });
});
