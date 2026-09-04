import { lstat, readdir, rm } from "node:fs/promises";

const outputs = ["dist", "coverage"].map(
  (name) => new URL(`../${name}/`, import.meta.url),
);

// Validate both roots before clearing either. Never follow an output symlink.
const present = await Promise.all(
  outputs.map(async (directory) => {
    let information;
    try {
      information = await lstat(new URL(directory.href.replace(/\/$/u, "")));
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
    if (!information.isDirectory() || information.isSymbolicLink()) {
      throw new Error(
        `Generated output must be a real directory: ${directory}`,
      );
    }
    return true;
  }),
);

await Promise.all(
  outputs.map(async (directory, index) => {
    if (!present[index]) return;
    for (const name of await readdir(directory)) {
      await rm(new URL(encodeURIComponent(name), directory), {
        force: true,
        recursive: true,
      });
    }
  }),
);
