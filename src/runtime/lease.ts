import { chmod } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import { ExitCode, MillError } from "../errors.js";

export interface ExclusiveLease {
  release(): Promise<void>;
}

export async function acquireExclusiveLease(input: {
  path: string;
  activeCode: string;
  activeMessage: string;
  unavailableCode: string;
  unavailableMessage: string;
}): Promise<ExclusiveLease> {
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(input.path, {
      timeout: 0,
      allowExtension: false,
      enableDoubleQuotedStringLiterals: false,
    });
    database.exec(`
      PRAGMA journal_mode = DELETE;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS lease_anchor (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1)
      ) STRICT;
      BEGIN EXCLUSIVE;
    `);
    await chmod(input.path, 0o600);
  } catch (error) {
    try {
      database?.close();
    } catch {
      // Preserve the acquisition error.
    }
    if (
      error instanceof Error &&
      "errcode" in error &&
      (error.errcode === 5 || error.errcode === 6)
    ) {
      throw new MillError(
        input.activeCode,
        input.activeMessage,
        ExitCode.temporary,
      );
    }
    throw new MillError(
      input.unavailableCode,
      input.unavailableMessage,
      ExitCode.io,
      { cause: String(error) },
    );
  }
  let released = false;
  return {
    release(): Promise<void> {
      if (released) return Promise.resolve();
      released = true;
      try {
        database.exec("ROLLBACK");
      } finally {
        database.close();
      }
      return Promise.resolve();
    },
  };
}
