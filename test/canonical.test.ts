import { describe, expect, it } from "vitest";

import { canonicalDigest, canonicalJson } from "../src/contracts/canonical.js";

describe("canonical JSON", () => {
  it("sorts object keys recursively without changing array order", () => {
    const first = { z: [3, { b: true, a: null }], a: "value" };
    const second = { a: "value", z: [3, { a: null, b: true }] };

    expect(canonicalJson(first)).toBe(
      '{"a":"value","z":[3,{"a":null,"b":true}]}',
    );
    expect(canonicalDigest(first)).toBe(canonicalDigest(second));
  });

  it("normalizes negative zero and rejects non-finite numbers", () => {
    expect(canonicalJson(-0)).toBe("0");
    expect(() => canonicalJson(Number.NaN)).toThrow(/non-finite/u);
  });
});
