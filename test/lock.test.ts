import { mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  enforceExactVersion,
  exactInvocation,
  findRepositoryRoot,
  readLockStatus,
} from "../src/config/lock.js";
import { safeReadText } from "../src/security/safe-path.js";
import { temporaryDirectory } from "./helpers.js";

describe("exact version and safe path contracts", () => {
  it("accepts an unmanaged repository and finds a parent marker", async () => {
    const temporary = await temporaryDirectory("mill-root-");
    try {
      expect(await readLockStatus(temporary.path)).toEqual({
        found: false,
        compatible: true,
      });
      await mkdir(path.join(temporary.path, ".git"));
      await mkdir(path.join(temporary.path, "nested", "path"), {
        recursive: true,
      });
      expect(
        await findRepositoryRoot(path.join(temporary.path, "nested", "path")),
      ).toBe(temporary.path);
      expect(exactInvocation("1.0.0")).toBe(
        "npx --yes @davidahmann/mill@1.0.0",
      );
    } finally {
      await temporary.cleanup();
    }
  });

  it("uses the enclosing Git boundary instead of a nested lock", async () => {
    const temporary = await temporaryDirectory("mill-root-authority-");
    try {
      const nested = path.join(temporary.path, "nested");
      await mkdir(path.join(temporary.path, ".git"));
      await mkdir(nested);
      await writeFile(
        path.join(temporary.path, "mill.lock"),
        'schemaVersion: "1"\nmill:\n  package: "@davidahmann/mill"\n  version: "9.9.9"\n',
      );
      await writeFile(
        path.join(nested, "mill.lock"),
        'schemaVersion: "1"\nmill:\n  package: "@davidahmann/mill"\n  version: "0.1.0"\n',
      );

      const root = await findRepositoryRoot(nested);
      expect(root).toBe(temporary.path);
      await expect(enforceExactVersion(root)).rejects.toMatchObject({
        code: "MILL_VERSION_MISMATCH",
      });
    } finally {
      await temporary.cleanup();
    }
  });

  it("rejects a nested lock when Git-root discovery exhausts its budget", async () => {
    const temporary = await temporaryDirectory("mill-root-depth-");
    try {
      await mkdir(path.join(temporary.path, ".git"));
      let nested = temporary.path;
      for (let depth = 0; depth < 129; depth += 1) {
        nested = path.join(nested, "d");
        await mkdir(nested);
      }
      await writeFile(
        path.join(nested, "mill.lock"),
        'schemaVersion: "1"\nmill:\n  package: "@davidahmann/mill"\n  version: "0.1.0"\n',
      );

      await expect(findRepositoryRoot(nested)).rejects.toMatchObject({
        code: "REPOSITORY_ROOT_DEPTH_EXCEEDED",
        exitCode: 78,
      });
    } finally {
      await temporary.cleanup();
    }
  });

  it("accepts the running version and rejects malformed lock data", async () => {
    const temporary = await temporaryDirectory("mill-valid-lock-");
    try {
      await writeFile(
        path.join(temporary.path, "mill.lock"),
        'schemaVersion: "1"\nmill:\n  package: "@davidahmann/mill"\n  version: "0.1.2"\n',
      );
      await expect(
        enforceExactVersion(temporary.path),
      ).resolves.toBeUndefined();
      await writeFile(
        path.join(temporary.path, "mill.lock"),
        "schemaVersion: [\n",
      );
      await expect(readLockStatus(temporary.path)).rejects.toMatchObject({
        code: "INVALID_MILL_LOCK",
      });
      await writeFile(
        path.join(temporary.path, "mill.lock"),
        'schemaVersion: "99"\n',
      );
      await expect(readLockStatus(temporary.path)).rejects.toMatchObject({
        code: "INVALID_MILL_LOCK",
      });
    } finally {
      await temporary.cleanup();
    }
  });

  it("fails closed when a mill.lock marker is a dangling symlink", async () => {
    const temporary = await temporaryDirectory("mill-dangling-lock-");
    try {
      await symlink("missing-lock", path.join(temporary.path, "mill.lock"));
      await expect(readLockStatus(temporary.path)).rejects.toMatchObject({
        code: "INVALID_MILL_LOCK",
        exitCode: 78,
      });
    } finally {
      await temporary.cleanup();
    }
  });

  it("refuses a mismatched mill.lock with an exact invocation", async () => {
    const temporary = await temporaryDirectory("mill-lock-");
    try {
      await writeFile(
        path.join(temporary.path, "mill.lock"),
        'schemaVersion: "1"\nmill:\n  package: "@davidahmann/mill"\n  version: "9.9.9"\n',
      );
      const status = await readLockStatus(temporary.path);
      expect(status).toMatchObject({
        found: true,
        compatible: false,
        requiredVersion: "9.9.9",
        invocation: "npx --yes @davidahmann/mill@9.9.9",
      });
      await expect(enforceExactVersion(temporary.path)).rejects.toMatchObject({
        code: "MILL_VERSION_MISMATCH",
        exitCode: 78,
      });
    } finally {
      await temporary.cleanup();
    }
  });

  it("does not follow a symlink outside the approved root", async () => {
    const root = await temporaryDirectory("mill-safe-root-");
    const outside = await temporaryDirectory("mill-safe-outside-");
    try {
      await mkdir(path.join(root.path, "docs"));
      await writeFile(path.join(outside.path, "secret.txt"), "not-for-mill");
      await symlink(
        path.join(outside.path, "secret.txt"),
        path.join(root.path, "docs", "prd.md"),
      );
      await expect(
        safeReadText(root.path, "docs/prd.md"),
      ).rejects.toMatchObject({
        code: "UNSAFE_FILE_TYPE",
      });
    } finally {
      await Promise.all([root.cleanup(), outside.cleanup()]);
    }
  });

  it("allows ordinary in-root names that begin with two dots", async () => {
    const temporary = await temporaryDirectory("mill-safe-dotdot-name-");
    try {
      await writeFile(path.join(temporary.path, "..prd.md"), "# Product\n");
      await expect(safeReadText(temporary.path, "..prd.md")).resolves.toBe(
        "# Product\n",
      );
    } finally {
      await temporary.cleanup();
    }
  });

  it("rejects lexical escape and files above the inspection budget", async () => {
    const root = await temporaryDirectory("mill-safe-budget-");
    const outside = await temporaryDirectory("mill-safe-escape-");
    try {
      await writeFile(path.join(outside.path, "outside.md"), "outside");
      await writeFile(path.join(root.path, "large.md"), "12345");
      await expect(
        safeReadText(
          root.path,
          path.join("..", path.basename(outside.path), "outside.md"),
        ),
      ).rejects.toMatchObject({
        code: "PATH_OUTSIDE_ROOT",
      });
      await expect(
        safeReadText(root.path, "large.md", 4),
      ).rejects.toMatchObject({
        code: "FILE_TOO_LARGE",
      });
    } finally {
      await Promise.all([root.cleanup(), outside.cleanup()]);
    }
  });

  it("rejects malformed UTF-8 instead of hashing replacement text", async () => {
    const temporary = await temporaryDirectory("mill-safe-utf8-");
    try {
      await writeFile(
        path.join(temporary.path, "invalid.md"),
        Buffer.from([0x80]),
      );
      await expect(
        safeReadText(temporary.path, "invalid.md"),
      ).rejects.toMatchObject({ code: "INVALID_UTF8" });
    } finally {
      await temporary.cleanup();
    }
  });
});
