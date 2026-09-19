import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  openSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { findTrustedExecutable } from "../doctor.js";
import { ExitCode, MillError } from "../errors.js";
import { acquireExclusiveLease } from "./lease.js";
import { runProcess } from "./process.js";

const intentSchema = z
  .object({
    schemaVersion: z.literal("1"),
    id: z.uuid(),
    namespace: z.string().regex(/^[a-f0-9]{64}$/u),
    nonce: z.string().regex(/^[a-f0-9]{64}$/u),
    kind: z.enum(["verifier", "dependency-preparation"]),
    name: z.string(),
    controllerPid: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    launchStarted: z.boolean(),
    observed: z
      .object({
        id: z.string().regex(/^[a-f0-9]{64}$/u),
        daemonId: z.string().min(1).max(200),
      })
      .strict()
      .optional(),
  })
  .strict();

type OciIntent = z.infer<typeof intentSchema>;
export type OciResource = Pick<OciIntent, "id" | "name"> & {
  labels: string[];
  onBeforeSpawn: () => void;
};

function blocked(code = "OCI_RECONCILIATION_REQUIRED"): MillError {
  return new MillError(
    code,
    "Mill could not prove that its OCI resources are stopped and removed. Preserve state and retry recovery with the same Docker daemon.",
    ExitCode.temporary,
  );
}

function namespace(stateDirectory: string): string {
  return createHash("sha256")
    .update(path.resolve(stateDirectory))
    .digest("hex");
}

function journalDirectory(stateDirectory: string): string {
  return path.join(stateDirectory, "oci-resources");
}

function labels(intent: OciIntent): Record<string, string> {
  return {
    "dev.mill.owner": intent.kind,
    "dev.mill.namespace": intent.namespace,
    "dev.mill.intent": intent.id,
    "dev.mill.nonce": intent.nonce,
  };
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function intents(stateDirectory: string): Promise<OciIntent[]> {
  const directory = journalDirectory(stateDirectory);
  const information = await lstat(directory).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return undefined;
    throw error;
  });
  if (information === undefined) return [];
  if (!information.isDirectory() || information.isSymbolicLink())
    throw blocked();
  const entries = await readdir(directory);
  if (entries.length > 1024) throw blocked();
  const result: OciIntent[] = [];
  for (const entry of entries) {
    // A crash while persisting an intent cannot have launched its container.
    // The temporary file is deliberately retained until an attended purge.
    if (/^\.[a-f0-9-]+\.tmp$/u.test(entry)) continue;
    if (!/^[a-f0-9-]+\.json$/u.test(entry)) throw blocked();
    const filename = path.join(directory, entry);
    const info = await lstat(filename);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 4096)
      throw blocked();
    let intent: OciIntent;
    try {
      intent = intentSchema.parse(JSON.parse(await readFile(filename, "utf8")));
    } catch {
      throw blocked();
    }
    if (
      entry !== `${intent.id}.json` ||
      intent.namespace !== namespace(stateDirectory) ||
      intent.name !== `mill-${intent.id}`
    )
      throw blocked();
    result.push(intent);
  }
  return result;
}

/** Read-only guard. An absent host PID is never evidence of daemon cleanup. */
export async function assertOciResourcesSettled(
  stateDirectory: string,
): Promise<void> {
  if ((await intents(stateDirectory)).length > 0) throw blocked();
}

export async function hasPendingOciResources(
  stateDirectory: string,
): Promise<boolean> {
  try {
    await assertOciResourcesSettled(stateDirectory);
    return false;
  } catch {
    return true;
  }
}

export interface OciResourceLease {
  readonly stateDirectory: string;
  create(kind: OciIntent["kind"]): Promise<OciResource>;
  remove(resource: OciResource): Promise<void>;
  release(): Promise<void>;
}

const activeLeases = new WeakSet<OciResourceLease>();

export function assertOciLease(
  lease: OciResourceLease,
  stateDirectory: string,
): void {
  if (
    !activeLeases.has(lease) ||
    lease.stateDirectory !== path.resolve(stateDirectory)
  )
    throw blocked();
}

/** Kernel-owned, separate from the namespace so purge cannot unlink a live lease. */
export async function acquireOciResourceLease(input: {
  stateDirectory: string;
  root?: string;
  reconcile?: boolean;
}): Promise<OciResourceLease> {
  const stateDirectory = path.resolve(input.stateDirectory);
  await mkdir(path.dirname(stateDirectory), { recursive: true, mode: 0o700 });
  const kernelLease = await acquireExclusiveLease({
    path: `${stateDirectory}.oci-lease.sqlite3`,
    activeCode: "OCI_CONTROLLER_ACTIVE",
    activeMessage:
      "An OCI controller still owns this repository's resource lease.",
    unavailableCode: "OCI_LEASE_UNAVAILABLE",
    unavailableMessage: "The OCI resource lease could not be acquired safely.",
  });
  const root = input.root ?? path.dirname(stateDirectory);
  let docker: string | undefined;
  async function runtime(): Promise<string> {
    docker ??= await findTrustedExecutable("docker", root);
    if (docker === undefined) throw blocked();
    return docker;
  }
  async function invoke(args: string[]) {
    return runProcess({
      executable: await runtime(),
      args,
      cwd: root,
      env: {
        HOME: process.env.HOME,
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin",
        LANG: "C",
        LC_ALL: "C",
      },
      deadlineMs: Date.now() + 15_000,
      maxOutputBytes: 64 * 1024,
    });
  }
  async function inspect(
    reference: string,
  ): Promise<
    { id: string; name: string; labels: Record<string, string> } | undefined
  > {
    const result = await invoke([
      "container",
      "inspect",
      "--format",
      '{"id":{{json .Id}},"name":{{json .Name}},"labels":{{json .Config.Labels}}}',
      reference,
    ]);
    if (result.timedOut || result.cancelled || result.outputExceeded)
      throw blocked();
    if (result.exitCode !== 0) {
      if (/no such (?:container|object)(?::| )/iu.test(result.stderr))
        return undefined;
      throw blocked();
    }
    try {
      return z
        .object({
          id: z.string().regex(/^[a-f0-9]{64}$/u),
          name: z.string(),
          labels: z.record(z.string(), z.string()),
        })
        .strict()
        .parse(JSON.parse(result.stdout));
    } catch {
      throw blocked();
    }
  }
  async function removeIntent(intent: OciIntent): Promise<void> {
    async function settled() {
      await rm(
        path.join(journalDirectory(stateDirectory), `${intent.id}.json`),
      );
      await syncDirectory(journalDirectory(stateDirectory));
    }
    if (!intent.launchStarted) {
      await settled();
      return;
    }
    const daemon = await invoke(["info", "--format", "{{json .ID}}"]);
    if (
      daemon.exitCode !== 0 ||
      daemon.timedOut ||
      daemon.cancelled ||
      daemon.outputExceeded
    )
      throw blocked();
    let daemonId: string;
    try {
      daemonId = z.string().min(1).max(200).parse(JSON.parse(daemon.stdout));
    } catch {
      throw blocked();
    }
    if (intent.observed !== undefined && intent.observed.daemonId !== daemonId)
      throw blocked();
    async function assertSameDaemon(): Promise<void> {
      const current = await invoke(["info", "--format", "{{json .ID}}"]);
      if (
        current.exitCode !== 0 ||
        current.timedOut ||
        current.cancelled ||
        current.outputExceeded ||
        current.stdout.trim() !== JSON.stringify(daemonId)
      )
        throw blocked();
    }
    const container = await inspect(intent.name);
    // Absence after a lost launch response is ambiguous: the daemon may still
    // create it. Keep the intent; never turn that uncertainty into a clean run.
    if (container === undefined) {
      if (
        intent.observed === undefined ||
        (await inspect(intent.observed.id)) !== undefined
      )
        throw blocked();
      await assertSameDaemon();
      await settled();
      return;
    }
    if (
      container.name !== `/${intent.name}` ||
      (intent.observed !== undefined && intent.observed.id !== container.id) ||
      Object.entries(labels(intent)).some(
        ([key, value]) => container.labels[key] !== value,
      )
    )
      throw blocked("OCI_RESOURCE_OWNERSHIP_MISMATCH");
    if (intent.observed === undefined) {
      const directory = journalDirectory(stateDirectory);
      const temporary = path.join(directory, `.${randomUUID()}.tmp`);
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(
          `${JSON.stringify({ ...intent, observed: { id: container.id, daemonId } })}\n`,
        );
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, path.join(directory, `${intent.id}.json`));
      await syncDirectory(directory);
    }
    // A lost rm response does not erase an independently observed absent ID.
    await invoke(["rm", "--force", "--volumes", container.id]);
    if (
      (await inspect(container.id)) !== undefined ||
      (await inspect(intent.name)) !== undefined
    )
      throw blocked();
    await assertSameDaemon();
    await settled();
  }
  const lease: OciResourceLease = {
    stateDirectory,
    async create(kind) {
      assertOciLease(lease, stateDirectory);
      const id = randomUUID();
      const intent: OciIntent = {
        schemaVersion: "1",
        id,
        namespace: namespace(stateDirectory),
        nonce: randomBytes(32).toString("hex"),
        kind,
        name: `mill-${id}`,
        controllerPid: process.pid,
        createdAt: new Date().toISOString(),
        launchStarted: false,
      };
      const directory = journalDirectory(stateDirectory);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await chmod(directory, 0o700);
      const temporary = path.join(directory, `.${id}.tmp`);
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(intent)}\n`);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, path.join(directory, `${id}.json`));
      await syncDirectory(directory);
      let launched = false;
      return {
        id,
        name: intent.name,
        labels: Object.entries(labels(intent)).flatMap(([key, value]) => [
          "--label",
          `${key}=${value}`,
        ]),
        onBeforeSpawn() {
          assertOciLease(lease, stateDirectory);
          if (launched) throw blocked();
          launched = true;
          // Synchronous durability is required by runProcess's before-spawn seam.
          const file = openSync(temporary, "wx", 0o600);
          try {
            writeFileSync(
              file,
              `${JSON.stringify({ ...intent, launchStarted: true })}\n`,
            );
            fsyncSync(file);
          } finally {
            closeSync(file);
          }
          renameSync(temporary, path.join(directory, `${id}.json`));
          const parent = openSync(directory, "r");
          try {
            fsyncSync(parent);
          } finally {
            closeSync(parent);
          }
        },
      };
    },
    async remove(resource) {
      assertOciLease(lease, stateDirectory);
      const intent = (await intents(stateDirectory)).find(
        (item) => item.id === resource.id && item.name === resource.name,
      );
      if (intent === undefined) throw blocked();
      await removeIntent(intent);
    },
    async release() {
      activeLeases.delete(lease);
      await kernelLease.release();
    },
  };
  activeLeases.add(lease);
  try {
    if (input.reconcile === true) {
      for (const intent of await intents(stateDirectory))
        await removeIntent(intent);
    } else await assertOciResourcesSettled(stateDirectory);
    return lease;
  } catch (error) {
    await lease.release();
    throw error;
  }
}

export async function reconcileOciResources(input: {
  stateDirectory: string;
  root: string;
}): Promise<void> {
  const lease = await acquireOciResourceLease({ ...input, reconcile: true });
  await lease.release();
}
