import { createHash } from "node:crypto";

import { ExitCode, MillError } from "../errors.js";

export type JsonPrimitive = boolean | null | number | string;
export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

function encode(value: JsonValue): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new MillError(
        "NON_CANONICAL_NUMBER",
        "Canonical JSON rejects non-finite numbers.",
        ExitCode.data,
      );
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    return `[${(value as readonly JsonValue[]).map((item) => encode(item)).join(",")}]`;
  }
  const object = value as Readonly<Record<string, JsonValue>>;
  const entries = Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${encode(object[key] as JsonValue)}`);
  return `{${entries.join(",")}}`;
}

export function canonicalJson(value: JsonValue): string {
  return encode(value);
}

export function canonicalDigest(value: JsonValue): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}
