import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";

const [fieldFlag, field, supportPath, sequencePath] = process.argv.slice(2);
if (
  fieldFlag !== "--field" ||
  !["support_tuple_base64", "sequence_base64"].includes(field) ||
  supportPath === undefined ||
  sequencePath === undefined
) {
  throw new Error(
    "usage: encode-release-qualification-inputs.mjs --field <support_tuple_base64|sequence_base64> <support-tuple.json> <sequence.json>",
  );
}

async function readJsonObject(file, label) {
  let value;
  try {
    value = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`${label} must contain valid JSON: ${String(error)}`, {
      cause: error,
    });
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must contain one JSON object`);
  }
  return value;
}

const [supportTuple, sequence] = await Promise.all([
  readJsonObject(supportPath, "support tuple"),
  readJsonObject(sequencePath, "longitudinal sequence"),
]);
const values = {
  support_tuple_base64: Buffer.from(JSON.stringify(supportTuple)).toString(
    "base64",
  ),
  sequence_base64: Buffer.from(JSON.stringify(sequence)).toString("base64"),
};

process.stdout.write(`${values[field]}\n`);
