import { RESULT_SCHEMA_VERSION } from "./version.js";

export interface ResultReason {
  code: string;
  message: string;
  details?: Readonly<Record<string, unknown>>;
}

export interface CommandResult<T> {
  schemaVersion: typeof RESULT_SCHEMA_VERSION;
  command: string;
  ok: boolean;
  status: "ok" | "blocked" | "error";
  reasons: readonly ResultReason[];
  data: T;
}

export function commandResult<T>(input: {
  command: string;
  ok: boolean;
  data: T;
  reasons?: readonly ResultReason[];
  status?: CommandResult<T>["status"];
}): CommandResult<T> {
  return {
    schemaVersion: RESULT_SCHEMA_VERSION,
    command: input.command,
    ok: input.ok,
    status: input.status ?? (input.ok ? "ok" : "blocked"),
    reasons: input.reasons ?? [],
    data: input.data,
  };
}

export function formatHuman(result: CommandResult<unknown>): string {
  const marker = result.ok ? "OK" : result.status.toUpperCase();
  const lines = [`${marker}: ${result.command}`];
  for (const reason of result.reasons) {
    lines.push(`- ${reason.code}: ${reason.message}`);
  }
  if (result.reasons.length === 0) {
    lines.push("- completed without blockers");
  }
  lines.push(JSON.stringify(result.data, undefined, 2));
  return `${lines.join("\n")}\n`;
}
