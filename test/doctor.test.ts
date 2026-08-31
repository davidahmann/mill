import { mkdir } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { doctor, doctorReady, type DoctorReport } from "../src/doctor.js";
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
});
