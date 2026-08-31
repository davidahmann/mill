import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { MILL_PACKAGE, MILL_VERSION } from "../src/version.js";

describe("package identity", () => {
  it("keeps the runtime identity aligned with package.json", async () => {
    const packageJson = z
      .object({
        name: z.string(),
        version: z.string(),
        bin: z.record(z.string(), z.string()),
        scripts: z.record(z.string(), z.string()),
      })
      .parse(JSON.parse(await readFile("package.json", "utf8")));
    expect(MILL_PACKAGE).toBe(packageJson.name);
    expect(MILL_VERSION).toBe(packageJson.version);
    expect(packageJson.bin).toEqual({ millctl: "dist/cli.js" });
    expect(packageJson.scripts.postinstall).toBeUndefined();
  });
});
