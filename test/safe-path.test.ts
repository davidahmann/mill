import path from "node:path";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { isWithin } from "../src/security/safe-path.js";

describe("repository path boundary", () => {
  const root = path.join(path.sep, "approved", "repository");
  const segment = fc
    .stringMatching(/^[a-zA-Z0-9_-]{1,20}$/u)
    .filter((value) => value !== "." && value !== "..");

  it("accepts arbitrary nested paths below the approved root", () => {
    fc.assert(
      fc.property(
        fc.array(segment, { minLength: 1, maxLength: 8 }),
        (parts) => {
          expect(isWithin(root, path.join(root, ...parts))).toBe(true);
        },
      ),
    );
  });

  it("rejects arbitrary siblings reached through a parent traversal", () => {
    fc.assert(
      fc.property(segment, (sibling) => {
        expect(isWithin(root, path.resolve(root, "..", sibling))).toBe(false);
      }),
    );
  });
});
