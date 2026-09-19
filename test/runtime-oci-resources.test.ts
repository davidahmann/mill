import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdir,
  readFile,
  readdir,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  acquireOciResourceLease,
  assertOciResourcesSettled,
  hasPendingOciResources,
  reconcileOciResources,
} from "../src/runtime/oci-resources.js";
import { runProcess } from "../src/runtime/process.js";
import {
  purgeRepositoryState,
  repositoryStateDirectory,
  restoreStateBackup,
  StateStore,
} from "../src/runtime/state.js";
import { trackFakeDocker } from "./fake-oci.js";
import { temporaryDirectory } from "./helpers.js";

const originalDocker = process.env.MILL_DOCKER_PATH;
const originalStateHome = process.env.MILL_STATE_HOME;
afterEach(() => {
  if (originalDocker === undefined) delete process.env.MILL_DOCKER_PATH;
  else process.env.MILL_DOCKER_PATH = originalDocker;
  if (originalStateHome === undefined) delete process.env.MILL_STATE_HOME;
  else process.env.MILL_STATE_HOME = originalStateHome;
});

async function fixture(body = "process.exit(0)") {
  const temporary = await temporaryDirectory("mill-oci-recovery-");
  const root = path.join(temporary.path, "repository");
  await mkdir(root);
  const docker = path.join(temporary.path, "docker");
  await writeFile(docker, `#!${process.execPath}\n${body}\n`, { mode: 0o755 });
  await trackFakeDocker(docker);
  process.env.MILL_DOCKER_PATH = docker;
  return {
    ...temporary,
    docker,
    root,
    stateDirectory: path.join(temporary.path, "state"),
    async run(resource: {
      name: string;
      labels: string[];
      onBeforeSpawn: () => void;
    }) {
      return runProcess({
        executable: docker,
        args: ["run", "--name", resource.name, ...resource.labels, "image"],
        cwd: temporary.path,
        env: {},
        deadlineMs: Date.now() + 5000,
        maxOutputBytes: 1024,
        onBeforeSpawn: resource.onBeforeSpawn,
      });
    },
  };
}

describe("durable OCI ownership and recovery", () => {
  it("clears an unlaunched intent without contacting a daemon", async () => {
    const value = await fixture();
    const lease = await acquireOciResourceLease(value);
    try {
      await lease.create("verifier");
      await lease.release();
      process.env.MILL_DOCKER_PATH = path.join(value.path, "absent");
      await reconcileOciResources(value);
      expect(await hasPendingOciResources(value.stateDirectory)).toBe(false);
    } finally {
      await lease.release();
      await value.cleanup();
    }
  });
  it.each(["verifier", "dependency-preparation"] as const)(
    "persists %s ownership before execution and removes by observed ID",
    async (kind) => {
      const value = await fixture();
      const lease = await acquireOciResourceLease(value);
      try {
        const resource = await lease.create(kind);
        const journal = path.join(
          value.stateDirectory,
          "oci-resources",
          `${resource.id}.json`,
        );
        expect((await stat(journal)).mode & 0o777).toBe(0o600);
        const intent = JSON.parse(await readFile(journal, "utf8")) as {
          kind: string;
          nonce: string;
        };
        expect(intent.kind).toBe(kind);
        expect(intent.nonce).toMatch(/^[a-f0-9]{64}$/u);
        await expect(
          assertOciResourcesSettled(value.stateDirectory),
        ).rejects.toMatchObject({ code: "OCI_RECONCILIATION_REQUIRED" });
        expect((await value.run(resource)).exitCode).toBe(0);
        await lease.remove(resource);
        await expect(
          assertOciResourcesSettled(value.stateDirectory),
        ).resolves.toBeUndefined();
        expect(
          JSON.parse(await readFile(`${value.docker}.containers.json`, "utf8")),
        ).toEqual([]);
      } finally {
        await lease.release();
        await value.cleanup();
      }
    },
  );

  it("never steals a live controller's kernel lease and recovers after SIGKILL", async () => {
    const value = await fixture();
    const lease = await acquireOciResourceLease(value);
    const resource = await lease.create("verifier");
    await value.run(resource);
    await lease.release();
    const child = spawn(
      process.execPath,
      [
        "-e",
        `const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1]);db.exec('BEGIN EXCLUSIVE');process.stdout.write('ready');setInterval(()=>{},1000)`,
        `${value.stateDirectory}.oci-lease.sqlite3`,
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    try {
      await once(child.stdout, "data");
      await expect(reconcileOciResources(value)).rejects.toMatchObject({
        code: "OCI_CONTROLLER_ACTIVE",
      });
      expect(await hasPendingOciResources(value.stateDirectory)).toBe(true);
      child.kill("SIGKILL");
      await once(child, "close");
      await reconcileOciResources(value);
      expect(await hasPendingOciResources(value.stateDirectory)).toBe(false);
    } finally {
      child.kill("SIGKILL");
      await value.cleanup();
    }
  });

  it("preserves ambiguous absent launches instead of claiming cleanup", async () => {
    const value = await fixture();
    const lease = await acquireOciResourceLease(value);
    try {
      (await lease.create("dependency-preparation")).onBeforeSpawn();
      await lease.release();
      await expect(reconcileOciResources(value)).rejects.toMatchObject({
        code: "OCI_RECONCILIATION_REQUIRED",
      });
      expect(await hasPendingOciResources(value.stateDirectory)).toBe(true);
    } finally {
      await lease.release();
      await value.cleanup();
    }
  });

  it("will not remove a same-name resource with a foreign nonce", async () => {
    const value = await fixture();
    const lease = await acquireOciResourceLease(value);
    try {
      const resource = await lease.create("verifier");
      await value.run(resource);
      const filename = `${value.docker}.containers.json`;
      const containers = JSON.parse(await readFile(filename, "utf8")) as {
        labels: Record<string, string>;
      }[];
      const first = containers[0];
      if (first === undefined) throw new Error("fixture container missing");
      first.labels["dev.mill.nonce"] = "f".repeat(64);
      await writeFile(filename, JSON.stringify(containers));
      await lease.release();
      await expect(reconcileOciResources(value)).rejects.toMatchObject({
        code: "OCI_RESOURCE_OWNERSHIP_MISMATCH",
      });
      expect(JSON.parse(await readFile(filename, "utf8"))).toEqual(containers);
      expect(await hasPendingOciResources(value.stateDirectory)).toBe(true);
    } finally {
      await lease.release();
      await value.cleanup();
    }
  });

  it("retains uncertain cleanup without exposing Docker output or the nonce", async () => {
    const value = await fixture(
      "if(process.argv[2]==='rm'){console.error('PRIVATE_DAEMON_ERROR');process.exit(1)}",
    );
    const lease = await acquireOciResourceLease(value);
    try {
      const resource = await lease.create("verifier");
      await value.run(resource);
      const nonce = resource.labels
        .find((value) => value.startsWith("dev.mill.nonce="))
        ?.split("=")[1];
      await lease
        .remove(resource)
        .then(() => {
          throw new Error("expected failure");
        })
        .catch((error: unknown) => {
          expect(error).toMatchObject({
            code: "OCI_RECONCILIATION_REQUIRED",
            details: {},
          });
          expect(JSON.stringify(error)).not.toContain("PRIVATE_DAEMON_ERROR");
          expect(JSON.stringify(error)).not.toContain(nonce);
        });
      expect(await hasPendingOciResources(value.stateDirectory)).toBe(true);
    } finally {
      await lease.release();
      await value.cleanup();
    }
  });

  it("recovers a recorded removal after controller death and rejects a changed daemon", async () => {
    const value = await fixture("if(process.argv[2]==='rm')process.exit(1)");
    const lease = await acquireOciResourceLease(value);
    try {
      const resource = await lease.create("verifier");
      await value.run(resource);
      await expect(lease.remove(resource)).rejects.toMatchObject({
        code: "OCI_RECONCILIATION_REQUIRED",
      });
      const recorded = JSON.parse(
        await readFile(
          path.join(
            value.stateDirectory,
            "oci-resources",
            `${resource.id}.json`,
          ),
          "utf8",
        ),
      ) as { observed?: { id: string; daemonId: string } };
      expect(recorded.observed?.id).toMatch(/^[a-f0-9]{64}$/u);
      expect(recorded.observed?.daemonId).toBe("fake-daemon");
      await lease.release();
      // The original daemon removed the known ID while its controller died.
      await writeFile(`${value.docker}.containers.json`, "[]");
      await writeFile(`${value.docker}.daemon-id`, "other-daemon");
      await expect(reconcileOciResources(value)).rejects.toMatchObject({
        code: "OCI_RECONCILIATION_REQUIRED",
      });
      expect(await hasPendingOciResources(value.stateDirectory)).toBe(true);
      await writeFile(`${value.docker}.daemon-id`, "fake-daemon");
      await reconcileOciResources(value);
      expect(await hasPendingOciResources(value.stateDirectory)).toBe(false);
    } finally {
      await lease.release();
      await value.cleanup();
    }
  });

  it("settles a lost removal response only after independent daemon readback", async () => {
    const value = await fixture(
      "if(process.argv[2]==='rm'){require('node:fs').writeFileSync(process.argv[1].replace('.implementation.cjs','.containers.json'),'[]');process.exit(9)}",
    );
    const lease = await acquireOciResourceLease(value);
    try {
      const resource = await lease.create("dependency-preparation");
      await value.run(resource);
      await lease.remove(resource);
      expect(await hasPendingOciResources(value.stateDirectory)).toBe(false);
    } finally {
      await lease.release();
      await value.cleanup();
    }
  });

  it("does not accept absence if the daemon changes during removal", async () => {
    const value = await fixture(
      "if(process.argv[2]==='rm'){require('node:fs').writeFileSync(process.argv[1].replace('.implementation.cjs','.daemon-id'),'other-daemon')}",
    );
    const lease = await acquireOciResourceLease(value);
    try {
      const resource = await lease.create("verifier");
      await value.run(resource);
      await expect(lease.remove(resource)).rejects.toMatchObject({
        code: "OCI_RECONCILIATION_REQUIRED",
      });
      expect(await hasPendingOciResources(value.stateDirectory)).toBe(true);
      await lease.release();
      await writeFile(`${value.docker}.daemon-id`, "fake-daemon");
      await reconcileOciResources(value);
      expect(await hasPendingOciResources(value.stateDirectory)).toBe(false);
    } finally {
      await lease.release();
      await value.cleanup();
    }
  });

  it("blocks low-level restore and purge while live or unresolved OCI ownership exists", async () => {
    const value = await fixture();
    process.env.MILL_STATE_HOME = value.path;
    const repositoryId = "11111111-1111-4111-8111-111111111111";
    const store = await StateStore.open(repositoryId, value.root);
    const backup = await store.backup();
    const directory = repositoryStateDirectory(repositoryId, value.root);
    store.close();
    const lease = await acquireOciResourceLease({
      ...value,
      stateDirectory: directory,
    });
    try {
      await expect(
        purgeRepositoryState(repositoryId, value.root),
      ).rejects.toMatchObject({ code: "OCI_CONTROLLER_ACTIVE" });
      await expect(
        restoreStateBackup(repositoryId, value.root, backup),
      ).rejects.toMatchObject({ code: "OCI_CONTROLLER_ACTIVE" });
      await lease.create("dependency-preparation");
      await lease.release();
      await expect(
        purgeRepositoryState(repositoryId, value.root),
      ).rejects.toMatchObject({ code: "OCI_RECONCILIATION_REQUIRED" });
      await expect(
        restoreStateBackup(repositoryId, value.root, backup),
      ).rejects.toMatchObject({ code: "OCI_RECONCILIATION_REQUIRED" });
      expect(
        (await readdir(path.join(directory, "oci-resources"))).length,
      ).toBe(1);
    } finally {
      await lease.release();
      await value.cleanup();
    }
  });

  it("treats malformed and symlinked journals as unresolved", async () => {
    const value = await fixture();
    const lease = await acquireOciResourceLease(value);
    try {
      const resource = await lease.create("verifier");
      await lease.release();
      const filename = path.join(
        value.stateDirectory,
        "oci-resources",
        `${resource.id}.json`,
      );
      await writeFile(filename, '{"schemaVersion":"wrong"}');
      expect(await hasPendingOciResources(value.stateDirectory)).toBe(true);
      await expect(reconcileOciResources(value)).rejects.toMatchObject({
        code: "OCI_RECONCILIATION_REQUIRED",
      });
      await symlink(
        filename,
        path.join(value.stateDirectory, "oci-resources", "foreign.json"),
      );
      expect(await hasPendingOciResources(value.stateDirectory)).toBe(true);
    } finally {
      await lease.release();
      await value.cleanup();
    }
  });
});
