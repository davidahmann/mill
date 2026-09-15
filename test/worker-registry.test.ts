import { describe, expect, it } from "vitest";

import { codexWorkerAdapters } from "../src/runtime/codex.js";

describe("worker adapter registry", () => {
  it("exposes only the registered Codex adapter and rejects unknown adapters", () => {
    expect(codexWorkerAdapters.ids()).toEqual(["codex-cli"]);
    expect(codexWorkerAdapters.require("codex-cli").id).toBe("codex-cli");
    expect(() => codexWorkerAdapters.require("other-cli")).toThrow(
      /not registered/u,
    );
  });
});
