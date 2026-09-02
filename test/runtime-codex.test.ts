import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  codexAuthStatus,
  codexPromptTemplate,
  codexWorkerProfile,
  decodeCodexEvents,
  runCodexBuilder,
  runCodexReview,
} from "../src/runtime/codex.js";
import { buildContextManifest } from "../src/runtime/context.js";
import { loadRuntimeInputs, textDigest } from "../src/runtime/inputs.js";
import { runtimeFixture } from "./runtime-fixture.js";
import { temporaryDirectory } from "./helpers.js";

const originalCodex = process.env.MILL_CODEX_PATH;

afterEach(() => {
  if (originalCodex === undefined) delete process.env.MILL_CODEX_PATH;
  else process.env.MILL_CODEX_PATH = originalCodex;
});

async function executableScript(
  directory: string,
  body: string,
): Promise<string> {
  const executable = path.join(directory, "codex-probe");
  await writeFile(executable, `#!${process.execPath}\n${body}\n`, {
    mode: 0o755,
  });
  await chmod(executable, 0o755);
  return executable;
}

describe("Codex adapter boundaries", () => {
  it("binds worker profiles to the actual role prompt template bytes", async () => {
    const fixture = await runtimeFixture();
    process.env.MILL_CODEX_PATH = fixture.codexPath;
    try {
      const builder = await codexWorkerProfile(fixture.root, "builder");
      const reviewer = await codexWorkerProfile(fixture.root, "reviewer");
      expect(builder.promptTemplateDigest).toBe(
        textDigest(codexPromptTemplate("builder")),
      );
      expect(reviewer.promptTemplateDigest).toBe(
        textDigest(codexPromptTemplate("reviewer")),
      );
      expect(builder.promptTemplateDigest).not.toBe(
        reviewer.promptTemplateDigest,
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("requires exactly one terminal settlement and one reviewer result", () => {
    expect(() => decodeCodexEvents("", "builder")).toThrow(
      expect.objectContaining({ code: "WORKER_SETTLEMENT_MISSING" }),
    );
    const terminal = JSON.stringify({ type: "turn.completed" });
    expect(() =>
      decodeCodexEvents(`${terminal}\n${terminal}\n`, "builder"),
    ).toThrow(expect.objectContaining({ code: "WORKER_SETTLEMENT_CONFLICT" }));
    const failed = JSON.stringify({
      type: "turn.failed",
      error: { message: "provider failure" },
    });
    expect(() =>
      decodeCodexEvents(`${failed}\n${terminal}\n`, "builder"),
    ).toThrow(expect.objectContaining({ code: "WORKER_SETTLEMENT_CONFLICT" }));
    const providerError = JSON.stringify({
      type: "error",
      message: JSON.stringify({ error: { code: "provider_failure" } }),
    });
    expect(() =>
      decodeCodexEvents(`${providerError}\n${terminal}\n`, "builder"),
    ).toThrow(expect.objectContaining({ code: "WORKER_SETTLEMENT_CONFLICT" }));
    expect(() => decodeCodexEvents(`${terminal}\n`, "reviewer")).toThrow(
      expect.objectContaining({ code: "WORKER_RESULT_MISSING" }),
    );
    const message = JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: "{}" },
    });
    expect(() =>
      decodeCodexEvents(`${message}\n${message}\n${terminal}\n`, "reviewer"),
    ).toThrow(expect.objectContaining({ code: "WORKER_RESULT_CONFLICT" }));
  });
  it("reports unavailable auth without falling back from an explicit override", async () => {
    const fixture = await runtimeFixture();
    process.env.MILL_CODEX_PATH = path.join(fixture.stateHome, "missing-codex");
    try {
      await expect(codexAuthStatus(fixture.root)).resolves.toEqual({
        available: false,
        authOwner: "operator",
        billingOwner: "operator-declared",
        cost: "unavailable",
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("reports failed operator authentication from an available executable", async () => {
    const fixture = await runtimeFixture();
    const tools = await temporaryDirectory("mill-codex-auth-");
    try {
      process.env.MILL_CODEX_PATH = await executableScript(
        tools.path,
        "process.exit(1);",
      );
      await expect(codexAuthStatus(fixture.root)).resolves.toMatchObject({
        available: false,
        authOwner: "operator",
      });
    } finally {
      await Promise.all([fixture.cleanup(), tools.cleanup()]);
    }
  });

  it("classifies failed builder execution without persisting raw output", async () => {
    const fixture = await runtimeFixture();
    const tools = await temporaryDirectory("mill-codex-fail-");
    try {
      process.env.MILL_CODEX_PATH = await executableScript(
        tools.path,
        'process.stderr.write("provider unavailable");process.exit(7);',
      );
      const inputs = await loadRuntimeInputs(fixture.root, fixture.taskPath);
      const frozen = await buildContextManifest(
        fixture.root,
        "a".repeat(40),
        inputs.task,
        inputs.config,
        inputs.taskDigest,
      );
      await expect(
        runCodexBuilder({
          root: fixture.root,
          task: inputs.task,
          manifest: frozen.manifest,
          deadlineMs: Date.now() + 5_000,
          maxOutputBytes: 1024,
        }),
      ).rejects.toMatchObject({ code: "CODEX_EXECUTION_FAILED" });
    } finally {
      await Promise.all([fixture.cleanup(), tools.cleanup()]);
    }
  });

  it("runs the builder in workspace scope without escalation approval", async () => {
    const fixture = await runtimeFixture();
    const tools = await temporaryDirectory("mill-codex-authority-");
    const argumentsFile = path.join(tools.path, "arguments.json");
    try {
      process.env.MILL_CODEX_PATH = await executableScript(
        tools.path,
        `const {writeFileSync}=require("node:fs");writeFileSync(${JSON.stringify(argumentsFile)},JSON.stringify(process.argv.slice(2)));console.log(JSON.stringify({type:"turn.completed",usage:{input_tokens:1,output_tokens:1}}));`,
      );
      const inputs = await loadRuntimeInputs(fixture.root, fixture.taskPath);
      const frozen = await buildContextManifest(
        fixture.root,
        "a".repeat(40),
        inputs.task,
        inputs.config,
        inputs.taskDigest,
      );
      await runCodexBuilder({
        root: fixture.root,
        task: inputs.task,
        manifest: frozen.manifest,
        deadlineMs: Date.now() + 5_000,
        maxOutputBytes: 1024,
      });
      const args = JSON.parse(
        await readFile(argumentsFile, "utf8"),
      ) as string[];
      expect(args).not.toContain("--approve-for-me");
      expect(
        args.slice(args.indexOf("--sandbox"), args.indexOf("--sandbox") + 2),
      ).toEqual(["--sandbox", "workspace-write"]);
      expect(
        args.some(
          (value, index) =>
            value === "-c" && args[index + 1] === 'approval_policy="never"',
        ),
      ).toBe(true);
    } finally {
      await Promise.all([fixture.cleanup(), tools.cleanup()]);
    }
  });

  it("retains only a safe provider error code from failed JSONL", async () => {
    const fixture = await runtimeFixture();
    const tools = await temporaryDirectory("mill-codex-provider-error-");
    try {
      process.env.MILL_CODEX_PATH = await executableScript(
        tools.path,
        `console.log(JSON.stringify({type:"error",message:JSON.stringify({error:{code:"invalid_json_schema",message:"sensitive prose"}})}));process.exit(1);`,
      );
      const inputs = await loadRuntimeInputs(fixture.root, fixture.taskPath);
      const frozen = await buildContextManifest(
        fixture.root,
        "a".repeat(40),
        inputs.task,
        inputs.config,
        inputs.taskDigest,
      );
      await expect(
        runCodexBuilder({
          root: fixture.root,
          task: inputs.task,
          manifest: frozen.manifest,
          deadlineMs: Date.now() + 5_000,
          maxOutputBytes: 1024,
        }),
      ).rejects.toMatchObject({
        code: "CODEX_EXECUTION_FAILED",
        details: { providerErrorCode: "invalid_json_schema" },
      });
    } finally {
      await Promise.all([fixture.cleanup(), tools.cleanup()]);
    }
  });

  it("classifies unavailable, deadline, output, and cancellation failures", async () => {
    const fixture = await runtimeFixture();
    const tools = await temporaryDirectory("mill-codex-bounds-");
    const inputs = await loadRuntimeInputs(fixture.root, fixture.taskPath);
    const frozen = await buildContextManifest(
      fixture.root,
      "a".repeat(40),
      inputs.task,
      inputs.config,
      inputs.taskDigest,
    );
    const call = (deadlineMs: number, signal?: AbortSignal) =>
      runCodexBuilder({
        root: fixture.root,
        task: inputs.task,
        manifest: frozen.manifest,
        deadlineMs,
        maxOutputBytes: 128,
        ...(signal === undefined ? {} : { signal }),
      });
    try {
      process.env.MILL_CODEX_PATH = path.join(tools.path, "missing-codex");
      await expect(call(Date.now() + 5_000)).rejects.toMatchObject({
        code: "CODEX_UNAVAILABLE",
      });

      process.env.MILL_CODEX_PATH = await executableScript(
        tools.path,
        "setInterval(()=>{},1000);",
      );
      await expect(call(Date.now() + 100)).rejects.toMatchObject({
        code: "CODEX_DEADLINE_EXCEEDED",
      });

      process.env.MILL_CODEX_PATH = await executableScript(
        tools.path,
        'process.stdout.write("x".repeat(10000));setInterval(()=>{},1000);',
      );
      await expect(call(Date.now() + 5_000)).rejects.toMatchObject({
        code: "CODEX_OUTPUT_BUDGET_EXCEEDED",
      });

      process.env.MILL_CODEX_PATH = await executableScript(
        tools.path,
        "setInterval(()=>{},1000);",
      );
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 100).unref();
      await expect(
        call(Date.now() + 5_000, controller.signal),
      ).rejects.toMatchObject({ code: "CODEX_CANCELLED" });
    } finally {
      await Promise.all([fixture.cleanup(), tools.cleanup()]);
    }
  });

  it("preserves source-qualified partial usage and generic thread identities", async () => {
    const fixture = await runtimeFixture();
    const tools = await temporaryDirectory("mill-codex-events-");
    try {
      process.env.MILL_CODEX_PATH = await executableScript(
        tools.path,
        `console.log("null");console.log(JSON.stringify({type:"diagnostic.unknown"}));console.log(JSON.stringify({thread_id:"generic-thread",usage:{input_tokens:7}}));console.log(JSON.stringify({type:"turn.completed"}));`,
      );
      const inputs = await loadRuntimeInputs(fixture.root, fixture.taskPath);
      const frozen = await buildContextManifest(
        fixture.root,
        "a".repeat(40),
        inputs.task,
        inputs.config,
        inputs.taskDigest,
      );
      await expect(
        runCodexBuilder({
          root: fixture.root,
          task: inputs.task,
          manifest: frozen.manifest,
          deadlineMs: Date.now() + 5_000,
          maxOutputBytes: 1024,
        }),
      ).resolves.toEqual({
        threadId: "generic-thread",
        usage: {
          source: "measured",
          inputTokens: 7,
          cost: "unavailable",
        },
      });
    } finally {
      await Promise.all([fixture.cleanup(), tools.cleanup()]);
    }
  });

  it("rejects missing, malformed, mismatched, and invalid structured review results", async () => {
    const fixture = await runtimeFixture();
    const tools = await temporaryDirectory("mill-codex-review-");
    const inputs = await loadRuntimeInputs(fixture.root, fixture.taskPath);
    const candidate = "a".repeat(40);
    const frozen = await buildContextManifest(
      fixture.root,
      candidate,
      inputs.task,
      inputs.config,
      inputs.taskDigest,
    );
    const invokeReview = () =>
      runCodexReview({
        root: fixture.root,
        task: inputs.task,
        manifest: frozen.manifest,
        candidateCommit: candidate,
        deadlineMs: Date.now() + 5_000,
        maxOutputBytes: 1024 * 1024,
      });
    try {
      process.env.MILL_CODEX_PATH = await executableScript(
        tools.path,
        'console.log("not-jsonl");console.log(JSON.stringify({type:"other"}));',
      );
      await expect(invokeReview()).rejects.toMatchObject({
        code: "MALFORMED_WORKER_EVENT",
      });

      process.env.MILL_CODEX_PATH = await executableScript(
        tools.path,
        'console.log(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:"not-json"}}));console.log(JSON.stringify({type:"turn.completed"}));',
      );
      await expect(invokeReview()).rejects.toMatchObject({
        code: "INVALID_REVIEW_RESULT",
      });

      process.env.MILL_CODEX_PATH = await executableScript(
        tools.path,
        `const text=JSON.stringify({schemaVersion:"1",candidateCommit:"${"b".repeat(40)}",summary:"wrong",findings:[]});console.log(JSON.stringify({type:"item.completed",item:{type:"agent_message",text}}));console.log(JSON.stringify({type:"turn.completed"}));`,
      );
      await expect(invokeReview()).rejects.toMatchObject({
        code: "INVALID_REVIEW_RESULT",
      });

      process.env.MILL_CODEX_PATH = await executableScript(
        tools.path,
        'const text=JSON.stringify({schemaVersion:"1",candidateCommit:"short",summary:"invalid",findings:[]});console.log(JSON.stringify({type:"item.completed",item:{type:"agent_message",text}}));console.log(JSON.stringify({type:"turn.completed"}));',
      );
      await expect(invokeReview()).rejects.toMatchObject({
        code: "INVALID_REVIEW_RESULT",
      });
    } finally {
      await Promise.all([fixture.cleanup(), tools.cleanup()]);
    }
  });
});
