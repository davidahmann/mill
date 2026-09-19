import { rm } from "node:fs/promises";

/** Failed qualification may leave daemon-owned mounts or an uncertain intent. */
export async function cleanupCanaryDirectories(directories, completed) {
  if (!completed) {
    process.stderr.write(
      `Canary failed; preserve these private fixtures for recovery: ${directories.join(", ")}\n`,
    );
    return;
  }
  await Promise.all(
    directories.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
}
