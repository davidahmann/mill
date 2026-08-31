import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const workflowDirectory = path.resolve(".github/workflows");
const files = (await readdir(workflowDirectory))
  .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
  .sort();
const failures = [];

for (const file of files) {
  const source = await readFile(path.join(workflowDirectory, file), "utf8");
  if (!/^permissions:/mu.test(source)) {
    failures.push(`${file}: missing top-level permissions`);
  }
  if (!/^concurrency:/mu.test(source)) {
    failures.push(`${file}: missing concurrency control`);
  }
  if (!/^\s+timeout-minutes:\s+\d+/mu.test(source)) {
    failures.push(`${file}: jobs must declare timeout-minutes`);
  }
  for (const match of source.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gmu)) {
    const reference = match[1] ?? "";
    if (!/@[a-f0-9]{40}$/u.test(reference)) {
      failures.push(
        `${file}: action is not pinned to a full commit: ${reference}`,
      );
    }
  }
}

if (files.length === 0) {
  failures.push("no workflows found");
}
if (failures.length > 0) {
  throw new Error(`workflow contract failed:\n${failures.join("\n")}`);
}
process.stdout.write(`workflow contract passed: ${files.join(", ")}\n`);
