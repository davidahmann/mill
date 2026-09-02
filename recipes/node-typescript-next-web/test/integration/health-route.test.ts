import { describe, expect, it } from "vitest";

import { GET } from "../../app/api/health/route";

describe("GET /api/health", () => {
  it("returns the public health contract", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });
});
