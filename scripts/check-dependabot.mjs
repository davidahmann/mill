import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { dependabotFailures } from "./dependabot-policy.mjs";

const files = [
  [".github/dependabot.yml", true],
  ["policy-starters/node-npm/.github/dependabot.yml", false],
];
const failures = [];
for (const [file, requireMillIgnores] of files) {
  try {
    const document = parse(await readFile(file, "utf8"));
    failures.push(
      ...dependabotFailures(document, { requireMillIgnores }).map(
        (failure) => `${file}: ${failure}`,
      ),
    );
  } catch (error) {
    failures.push(`${file}: ${String(error)}`);
  }
}
if (failures.length > 0) {
  throw new Error(`Dependabot policy failed:\n${failures.join("\n")}`);
}
process.stdout.write(
  "Dependabot policy passed for Mill and node-npm starter\n",
);
