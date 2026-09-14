import { existsSync } from "node:fs";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const arguments_ = process.argv.slice(2);
let base;
if (arguments_.length === 0) {
  base = undefined;
} else if (arguments_.length === 2 && arguments_[0] === "--base") {
  base = arguments_[1];
} else {
  throw new Error("usage: check-docs.mjs [--base <commit>]");
}

const root = await realpath(process.cwd());
const patterns = [
  /\bthe key point is\b/iu,
  /\bin conclusion\b/iu,
  /\bultimately\b/iu,
  /\bhere'?s the thing\b/iu,
  /\bwhat nobody tells you\b/iu,
  /\bthe part everyone misses\b/iu,
];

function git(argumentsForGit) {
  const result = spawnSync("/usr/bin/git", argumentsForGit, {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_OPTIONAL_LOCKS: "0",
    },
  });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

function changedMarkdown() {
  const selectedBase = base ?? git(["merge-base", "HEAD", "origin/main"]);
  const changed =
    selectedBase === undefined
      ? git(["diff", "--name-only", "HEAD"])
      : git(["diff", "--name-only", selectedBase]);
  const untracked = git(["ls-files", "--others", "--exclude-standard"]);
  if (changed === undefined || untracked === undefined)
    throw new Error("docs check could not determine changed files from Git");
  return [...new Set([...changed.split("\n"), ...untracked.split("\n")])]
    .filter((file) => file.endsWith(".md") || file.endsWith(".mdx"))
    .filter((file) => file.length > 0)
    .sort();
}

function withoutCodeFences(source) {
  let fenced = false;
  return source.split("\n").map((line) => {
    if (/^\s*```/u.test(line)) {
      fenced = !fenced;
      return "";
    }
    return fenced || /^\s*>/u.test(line) ? "" : line;
  });
}

const failures = [];
for (const file of changedMarkdown()) {
  const absolute = path.resolve(root, file);
  if (!absolute.startsWith(`${root}${path.sep}`)) {
    failures.push(`${file}: path escapes repository`);
    continue;
  }
  const source = await readFile(absolute, "utf8");
  for (const [index, line] of withoutCodeFences(source).entries()) {
    for (const pattern of patterns) {
      if (pattern.test(line))
        failures.push(
          `${file}:${index + 1}: writing pattern ${pattern.source}`,
        );
    }
  }
  for (const match of source.matchAll(
    /!?\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/gu,
  )) {
    const destination = match[1];
    if (
      destination === undefined ||
      destination.startsWith("#") ||
      /^[a-z][a-z0-9+.-]*:/iu.test(destination) ||
      destination.startsWith("//")
    )
      continue;
    const target = path.resolve(
      path.dirname(absolute),
      destination.split(/[?#]/u, 1)[0],
    );
    if (
      !target.startsWith(`${root}${path.sep}`) ||
      !existsSync(target) ||
      (await lstat(target)).isSymbolicLink()
    ) {
      failures.push(`${file}: broken local link ${destination}`);
    }
  }
}
if (failures.length > 0)
  throw new Error(`docs check failed:\n${failures.join("\n")}`);
process.stdout.write("docs check passed\n");
