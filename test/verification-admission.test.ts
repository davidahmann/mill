import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  verifyRun,
  reviewRun,
  planVerificationRecovery,
  recoverVerification,
} from "../src/runtime/lifecycle.js";
import { commonGitDirectory } from "../src/runtime/repository.js";
import { repositoryStateDirectory, StateStore } from "../src/runtime/state.js";
import { runtimeFixture } from "./runtime-fixture.js";
const original = process.env.MILL_STATE_HOME;
const originalDocker = process.env.MILL_DOCKER_PATH;
afterEach(() => {
  if (originalDocker === undefined) delete process.env.MILL_DOCKER_PATH;
  else process.env.MILL_DOCKER_PATH = originalDocker;
  if (original === undefined) delete process.env.MILL_STATE_HOME;
  else process.env.MILL_STATE_HOME = original;
});
const operations = [
  verifyRun,
  reviewRun,
  (input: { root: string; taskPath: string; runId: string }) =>
    planVerificationRecovery({
      ...input,
      expiresAt: new Date(Date.now() + 30000).toISOString(),
    }),
  (input: { root: string; taskPath: string; runId: string }) =>
    recoverVerification({
      ...input,
      expiresAt: new Date(Date.now() + 30000).toISOString(),
      approvalDigest: "sha256:" + "0".repeat(64),
      attended: true,
    }),
];
async function fixture() {
  const result = await runtimeFixture();
  process.env.MILL_STATE_HOME = result.stateHome;
  await writeFile(
    path.join(result.root, "mill.lock"),
    'schemaVersion: "1"\nmill:\n  package: "@davidahmann/mill"\n  version: "0.8.0"\n',
  );
  return result;
}
describe("read-only verification controller admission", () => {
  it("rejects every recovery/version exception on absent state without creating its directory", async () => {
    const f = await fixture();
    try {
      const directory = repositoryStateDirectory(
        "11111111-1111-4111-8111-111111111111",
        await commonGitDirectory(f.root),
      );
      for (const operation of operations) {
        await expect(
          operation({ root: f.root, taskPath: f.taskPath, runId: "missing" }),
        ).rejects.toThrow();
        await expect(readdir(directory)).rejects.toMatchObject({
          code: "ENOENT",
        });
      }
    } finally {
      await f.cleanup();
    }
  });
  it("does not migrate a real legacy SQLite database on rejected admission", async () => {
    const f = await fixture();
    try {
      const directory = repositoryStateDirectory(
        "11111111-1111-4111-8111-111111111111",
        await commonGitDirectory(f.root),
      );
      await mkdir(directory, { recursive: true });
      const filename = path.join(directory, "state.sqlite3");
      const db = new DatabaseSync(filename);
      db.exec(`CREATE TABLE metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;
CREATE TABLE runs (id TEXT PRIMARY KEY,repository_id TEXT NOT NULL,task_id TEXT NOT NULL,task_digest TEXT NOT NULL,config_digest TEXT NOT NULL,status TEXT NOT NULL,base_commit TEXT NOT NULL,worktree_path TEXT,context_digest TEXT,context_json TEXT,control_json TEXT,candidate_commit TEXT,candidate_tree TEXT,deadline_at TEXT NOT NULL,active_pid INTEGER,cancel_requested INTEGER NOT NULL DEFAULT 0,repair_count INTEGER NOT NULL DEFAULT 0,attempt_count INTEGER NOT NULL DEFAULT 0,block_code TEXT,validation_json TEXT,review_json TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL) STRICT;
CREATE TABLE run_events (sequence INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL REFERENCES runs(id),occurred_at TEXT NOT NULL,type TEXT NOT NULL,data_json TEXT NOT NULL) STRICT;
CREATE TABLE baseline_qualifications (approval_digest TEXT PRIMARY KEY,repository_id TEXT NOT NULL,task_digest TEXT NOT NULL,config_digest TEXT NOT NULL,base_commit TEXT NOT NULL,evidence_digest TEXT NOT NULL,created_at TEXT NOT NULL) STRICT;
INSERT INTO metadata VALUES ('schema_version','1');`);
      db.close();
      const before = await readFile(filename);
      const entries = await readdir(directory);
      for (const operation of operations) {
        await expect(
          operation({ root: f.root, taskPath: f.taskPath, runId: "missing" }),
        ).rejects.toMatchObject({ code: "STATE_UPGRADE_REQUIRED" });
        expect(await readFile(filename)).toEqual(before);
        expect(await readdir(directory)).toEqual(entries);
      }
    } finally {
      await f.cleanup();
    }
  });
  it("does not inspect or remove a pending OCI resource before denying wrong-version admission", async () => {
    const f = await fixture();
    try {
      const store = await StateStore.open(
        "11111111-1111-4111-8111-111111111111",
        await commonGitDirectory(f.root),
      );
      const directory = store.directory;
      const run = store.createRun({
        repositoryId: "11111111-1111-4111-8111-111111111111",
        taskId: "test",
        taskDigest: "x",
        configDigest: "y",
        baseCommit: "a".repeat(40),
        deadlineAt: new Date(Date.now() + 30000).toISOString(),
      });
      store.close();
      await mkdir(path.join(directory, "oci-resources"), { recursive: true });
      const id = randomUUID();
      const journal = path.join(directory, "oci-resources", id + ".json");
      const intent = JSON.stringify({
        schemaVersion: "1",
        id,
        namespace: createHash("sha256")
          .update(path.resolve(directory))
          .digest("hex"),
        nonce: "a".repeat(64),
        kind: "verifier",
        name: "mill-" + id,
        controllerPid: 999999999,
        createdAt: new Date().toISOString(),
        launchStarted: false,
      });
      await writeFile(journal, intent);
      const sentinel = path.join(f.stateHome, "docker-called");
      await writeFile(
        f.dockerPath,
        `#!${process.execPath}\nrequire("node:fs").writeFileSync(${JSON.stringify(sentinel)},"called");process.exit(1);\n`,
      );
      await chmod(f.dockerPath, 0o755);
      process.env.MILL_DOCKER_PATH = f.dockerPath;
      const before = await readFile(path.join(directory, "state.sqlite3"));
      const entries = await readdir(directory);
      for (const operation of operations) {
        await expect(
          operation({ root: f.root, taskPath: f.taskPath, runId: run.id }),
        ).rejects.toThrow();
        expect(await readFile(journal, "utf8")).toBe(intent);
        expect(await readFile(path.join(directory, "state.sqlite3"))).toEqual(
          before,
        );
        expect(
          (await readdir(directory)).filter(
            (name) => !name.endsWith("-wal") && !name.endsWith("-shm"),
          ),
        ).toEqual(entries);
        await expect(readFile(sentinel)).rejects.toMatchObject({
          code: "ENOENT",
        });
      }
    } finally {
      await f.cleanup();
    }
  });
});
