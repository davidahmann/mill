import { describe, expect, it } from "vitest";

import { healthPayload } from "../../src/health";

describe("healthPayload", () => {
  it("reports a stable healthy state", () => {
    expect(healthPayload()).toEqual({ status: "ok" });
  });
});
