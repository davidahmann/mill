import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export async function temporaryDirectory(prefix: string): Promise<{
  path: string;
  cleanup: () => Promise<void>;
}> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  return {
    path: directory,
    cleanup: async () => rm(directory, { force: true, recursive: true }),
  };
}
