import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  canonicalDigest,
  canonicalJson,
  type JsonValue,
} from "../src/contracts/canonical.js";

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

  it("is stable across JSON round trips and object insertion order", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const canonical = canonicalJson(value as unknown as JsonValue);
        expect(canonicalJson(JSON.parse(canonical) as JsonValue)).toBe(
          canonical,
        );
      }),
    );
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.string({ minLength: 1, maxLength: 12 }),
          fc.jsonValue(),
        ),
        (value) => {
          const reverseInsertion = Object.fromEntries(
            Object.entries(value).reverse(),
          );
          expect(canonicalDigest(reverseInsertion as JsonValue)).toBe(
            canonicalDigest(value as JsonValue),
          );
        },
      ),
    );
  });
});
