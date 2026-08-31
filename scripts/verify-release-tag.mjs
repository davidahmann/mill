import { readFile } from "node:fs/promises";

const reference = process.env.GITHUB_REF_NAME;
if (
  reference === undefined ||
  !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(reference)
) {
  throw new Error("release must run from a SemVer v-prefixed tag");
}
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
if (packageJson.version !== reference.slice(1)) {
  throw new Error(
    `package version ${String(packageJson.version)} does not match tag ${reference}`,
  );
}
if (packageJson.version === "0.0.0-development") {
  throw new Error("development version cannot be published");
}
process.stdout.write(
  `release tag matches package version ${String(packageJson.version)}\n`,
);
