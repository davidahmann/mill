import type { Dirent } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, opendir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { parse as parseYaml } from "yaml";
import type { z } from "zod";

import { canonicalDigest } from "../contracts/canonical.js";
import { recipeManifestSchema } from "../contracts/schemas.js";
import { ExitCode, MillError } from "../errors.js";

export type RecipeManifest = z.infer<typeof recipeManifestSchema>;
export type FileOwnership = "mill_only" | "generated_once" | "managed";

export interface RecipeFile {
  path: string;
  content: string;
  contentDigest: string;
  ownership: FileOwnership;
}

const recipeRoot = fileURLToPath(
  new URL("../../recipes/node-typescript-next-web/", import.meta.url),
);
const ignoredDirectories = new Set([
  ".next",
  "coverage",
  "node_modules",
  "playwright-report",
  "test-results",
]);
const ignoredFiles = new Set([".DS_Store"]);

function digest(content: string): string {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

function ownership(relativePath: string): FileOwnership {
  if (["mill.yaml", "mill.lock"].includes(relativePath)) return "mill_only";
  if (relativePath === ".github/workflows/ci.yml") return "managed";
  return "generated_once";
}

function packageName(value: string): string {
  const normalized = value
    .toLowerCase()
    .normalize("NFKD")
    .replaceAll(/[^a-z0-9._-]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "")
    .slice(0, 214);
  return normalized.length === 0 ? "mill-web-product" : normalized;
}

function markdownTitle(value: string): string {
  return value
    .replaceAll(/[\r\n\t]+/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim()
    .replaceAll(
      /[\u0021-\u002F\u003A-\u0040\u005B-\u0060\u007B-\u007E]/gu,
      "\\$&",
    );
}

async function walk(directory: string, relative = "."): Promise<string[]> {
  const handle = await opendir(path.join(directory, relative));
  const entries: Dirent[] = [];
  for await (const entry of handle) entries.push(entry);
  const files: string[] = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (
      ignoredFiles.has(entry.name) ||
      (entry.isDirectory() && ignoredDirectories.has(entry.name))
    ) {
      continue;
    }
    const child = path.join(relative, entry.name);
    const information = await lstat(path.join(directory, child));
    if (information.isSymbolicLink()) {
      throw new MillError(
        "RECIPE_SYMLINK_FORBIDDEN",
        "Recipe assets cannot contain symbolic links.",
        ExitCode.data,
        { path: child },
      );
    }
    if (information.isDirectory())
      files.push(...(await walk(directory, child)));
    else if (information.isFile()) {
      if (information.size > 8 * 1024 * 1024) {
        throw new MillError(
          "RECIPE_ASSET_TOO_LARGE",
          "A bundled recipe asset exceeds the per-file size limit.",
          ExitCode.data,
          { path: child },
        );
      }
      files.push(child);
    } else {
      throw new MillError(
        "RECIPE_ASSET_UNSUPPORTED",
        "A bundled recipe asset has an unsupported filesystem type.",
        ExitCode.data,
        { path: child },
      );
    }
  }
  if (files.length > 128) {
    throw new MillError(
      "RECIPE_ASSET_LIMIT_EXCEEDED",
      "The bundled recipe exceeds its file-count limit.",
      ExitCode.data,
    );
  }
  return files;
}

export async function loadNodeWebRecipe(): Promise<{
  manifest: RecipeManifest;
  digest: string;
}> {
  const source = await readFile(path.join(recipeRoot, "recipe.yaml"), "utf8");
  let raw: unknown;
  try {
    raw = parseYaml(source);
  } catch (error) {
    throw new MillError(
      "RECIPE_MANIFEST_INVALID",
      "The bundled recipe manifest is invalid YAML.",
      ExitCode.data,
      { cause: String(error) },
    );
  }
  const manifest = recipeManifestSchema.parse(raw);
  if (manifest.status !== "supported") {
    throw new MillError(
      "RECIPE_NOT_SUPPORTED",
      "The selected recipe is not qualified for apply.",
      ExitCode.configuration,
      { status: manifest.status },
    );
  }
  const assets = await walk(recipeRoot);
  const assetDigests = await Promise.all(
    assets
      .filter((asset) => asset.split(path.sep).join("/") !== "recipe.yaml")
      .map(async (asset) => ({
        path: asset.split(path.sep).join("/").replace(/^\.\//u, ""),
        digest: digest(await readFile(path.join(recipeRoot, asset), "utf8")),
      })),
  );
  return {
    manifest,
    digest: canonicalDigest({ manifest, assets: assetDigests }),
  };
}

export async function renderNodeWebRecipe(input: {
  projectName: string;
  productTitle: string;
}): Promise<RecipeFile[]> {
  const files = await walk(recipeRoot);
  const rendered: RecipeFile[] = [];
  for (const file of files) {
    const assetPath = file.split(path.sep).join("/").replace(/^\.\//u, "");
    if (assetPath === "recipe.yaml") continue;
    const normalized =
      assetPath === "gitignore.template" ? ".gitignore" : assetPath;
    let content = await readFile(path.join(recipeRoot, file), "utf8");
    if (normalized === "package.json" || normalized === "package-lock.json") {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      parsed.name = packageName(input.projectName);
      if (normalized === "package-lock.json") {
        const packages = parsed.packages as
          Record<string, Record<string, unknown>> | undefined;
        if (packages?.[""] !== undefined) {
          packages[""].name = packageName(input.projectName);
        }
      }
      content = `${JSON.stringify(parsed, undefined, 2)}\n`;
    } else {
      content = content.replace(
        /__MILL_PRODUCT_TITLE_LITERAL__|MILL_PRODUCT_TITLE_MARKDOWN_TOKEN/gu,
        (token) =>
          token === "__MILL_PRODUCT_TITLE_LITERAL__"
            ? JSON.stringify(input.productTitle)
            : markdownTitle(input.productTitle),
      );
    }
    rendered.push({
      path: normalized,
      content,
      contentDigest: digest(content),
      ownership: ownership(normalized),
    });
  }
  return rendered.sort((left, right) => left.path.localeCompare(right.path));
}
