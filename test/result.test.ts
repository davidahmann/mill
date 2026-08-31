import { describe, expect, it } from "vitest";

import { asMillError, ExitCode, MillError } from "../src/errors.js";
import { commandResult, formatHuman } from "../src/result.js";

describe("result and error envelopes", () => {
  it("formats success and blocked results", () => {
    expect(
      formatHuman(
        commandResult({ command: "demo", ok: true, data: { value: 1 } }),
      ),
    ).toContain("OK: demo");
    expect(
      formatHuman(
        commandResult({
          command: "demo",
          ok: false,
          data: {},
          reasons: [{ code: "BLOCK", message: "blocked" }],
        }),
      ),
    ).toContain("BLOCK: blocked");
  });

  it("preserves Mill errors and normalizes unknown failures", () => {
    const millError = new MillError("KNOWN", "known", ExitCode.data);
    expect(asMillError(millError)).toBe(millError);
    expect(asMillError(new Error("boom"))).toMatchObject({
      code: "INTERNAL_ERROR",
      message: "boom",
    });
    expect(asMillError("bad")).toMatchObject({
      code: "INTERNAL_ERROR",
      message: "bad",
    });
  });
});
