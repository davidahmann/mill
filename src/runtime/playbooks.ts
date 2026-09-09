import { createHash } from "node:crypto";

import { parse as parseYaml } from "yaml";
import type { z } from "zod";

import { playbookIndexSchema, playbookSchema } from "../contracts/schemas.js";
import { ExitCode, MillError } from "../errors.js";
import { safeReadText } from "../security/safe-path.js";

type PlaybookIndex = z.infer<typeof playbookIndexSchema>;
type Playbook = z.infer<typeof playbookSchema>;

export interface PlaybookSelectionRequest {
  index: { path: string; digest: string };
  ids: readonly string[];
}

export interface ResolvedPlaybookIndex {
  path: string;
  digest: string;
  index: PlaybookIndex;
}

export interface ResolvedPlaybook {
  id: string;
  title: string;
  summary: string;
  kind: Playbook["kind"];
  tags: readonly string[];
  path: string;
  digest: string;
  playbook: Playbook;
}

export interface ResolvedPlaybookSelection {
  index: { path: string; digest: string };
  selected: {
    id: string;
    kind: Playbook["kind"];
    path: string;
    digest: string;
  }[];
}

function textDigest(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function parsePlaybookContract<T>(
  source: string,
  schema: z.ZodType<T>,
  label: string,
): T {
  let raw: unknown;
  try {
    raw = parseYaml(source);
  } catch (error) {
    throw new MillError(
      "INVALID_PLAYBOOK_CONTRACT",
      `${label} is not valid YAML.`,
      ExitCode.data,
      { cause: String(error) },
    );
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new MillError(
      "INVALID_PLAYBOOK_CONTRACT",
      `${label} does not satisfy its schema.`,
      ExitCode.data,
      { issues: parsed.error.issues },
    );
  }
  return parsed.data;
}

export async function loadPlaybookIndex(input: {
  root: string;
  path: string;
  expectedDigest?: string;
}): Promise<ResolvedPlaybookIndex> {
  const source = await safeReadText(input.root, input.path, 2 * 1024 * 1024);
  const digest = textDigest(source);
  if (input.expectedDigest !== undefined && digest !== input.expectedDigest) {
    throw new MillError(
      "PLAYBOOK_INDEX_DIGEST_MISMATCH",
      `Playbook index digest does not match ${input.path}.`,
      ExitCode.configuration,
    );
  }
  return {
    path: input.path,
    digest,
    index: parsePlaybookContract(source, playbookIndexSchema, input.path),
  };
}

export async function loadIndexedPlaybook(input: {
  root: string;
  index: ResolvedPlaybookIndex;
  id: string;
}): Promise<ResolvedPlaybook> {
  const entry = input.index.index.playbooks.find(
    (playbook) => playbook.id === input.id,
  );
  if (entry === undefined) {
    throw new MillError(
      "PLAYBOOK_NOT_FOUND",
      `Playbook ID is not present in ${input.index.path}: ${input.id}`,
      ExitCode.data,
    );
  }
  const source = await safeReadText(input.root, entry.path, 2 * 1024 * 1024);
  if (textDigest(source) !== entry.digest) {
    throw new MillError(
      "PLAYBOOK_DIGEST_MISMATCH",
      `Playbook digest does not match ${entry.path}.`,
      ExitCode.configuration,
    );
  }
  const playbook = parsePlaybookContract(source, playbookSchema, entry.path);
  if (playbook.id !== entry.id || playbook.kind !== entry.kind) {
    throw new MillError(
      "PLAYBOOK_INDEX_CONFLICT",
      `Playbook metadata conflicts with index entry: ${entry.path}.`,
      ExitCode.configuration,
    );
  }
  return { ...entry, playbook };
}

export async function resolvePlaybookSelection(input: {
  root: string;
  selection?: PlaybookSelectionRequest;
}): Promise<ResolvedPlaybookSelection | undefined> {
  if (input.selection === undefined) return undefined;
  const index = await loadPlaybookIndex({
    root: input.root,
    path: input.selection.index.path,
    expectedDigest: input.selection.index.digest,
  });
  const selected = await Promise.all(
    input.selection.ids.map((id) =>
      loadIndexedPlaybook({ root: input.root, index, id }),
    ),
  );
  return {
    index: { path: index.path, digest: index.digest },
    selected: selected.map((playbook) => ({
      id: playbook.id,
      kind: playbook.kind,
      path: playbook.path,
      digest: playbook.digest,
    })),
  };
}

export function searchPlaybookIndex(
  index: ResolvedPlaybookIndex,
  query: string,
): PlaybookIndex["playbooks"] {
  const terms = query
    .toLocaleLowerCase("en-US")
    .split(/\s+/u)
    .filter((term) => term.length > 0);
  if (terms.length === 0) return [...index.index.playbooks];
  return index.index.playbooks.filter((playbook) => {
    const haystack = [
      playbook.id,
      playbook.title,
      playbook.summary,
      playbook.kind,
      ...playbook.tags,
    ]
      .join("\n")
      .toLocaleLowerCase("en-US");
    return terms.every((term) => haystack.includes(term));
  });
}
