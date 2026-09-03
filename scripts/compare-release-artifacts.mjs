import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";

const [firstPath, secondPath, outputDirectory] = process.argv.slice(2);
if (
  firstPath === undefined ||
  secondPath === undefined ||
  outputDirectory === undefined
) {
  throw new Error(
    "usage: compare-release-artifacts.mjs <builder-a.tgz> <builder-b.tgz> <output-directory>",
  );
}

const archiveByteLimit = 100 * 1024 * 1024;
const entryLimit = 10_000;

function bytesDigest(bytes, algorithm) {
  return createHash(algorithm).update(bytes).digest();
}

function sha256(bytes) {
  return `sha256:${bytesDigest(bytes, "sha256").toString("hex")}`;
}

function npmIntegrity(bytes) {
  return `sha512-${bytesDigest(bytes, "sha512").toString("base64")}`;
}

function textField(header, start, length) {
  const bytes = header.subarray(start, start + length);
  const end = bytes.indexOf(0);
  return bytes.subarray(0, end < 0 ? bytes.length : end).toString("utf8");
}

function octalField(header, start, length, name) {
  const value = textField(header, start, length).trim();
  if (!/^[0-7]+$/u.test(value)) {
    throw new Error(`archive has invalid ${name}`);
  }
  const result = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error(`archive has out-of-range ${name}`);
  }
  return result;
}

function verifyHeaderChecksum(header) {
  const expected = octalField(header, 148, 8, "header checksum");
  let actual = 0;
  for (let index = 0; index < header.length; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : (header[index] ?? 0);
  }
  if (actual !== expected) throw new Error("archive header checksum mismatch");
}

function validatePath(value) {
  if (
    value.length === 0 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("\0") ||
    value
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`unsafe artifact path: ${JSON.stringify(value)}`);
  }
  return value;
}

function parsePax(bytes) {
  const values = {};
  let offset = 0;
  while (offset < bytes.length) {
    const space = bytes.indexOf(0x20, offset);
    if (space < 0) throw new Error("archive has malformed PAX length");
    const lengthText = bytes.subarray(offset, space).toString("ascii");
    if (!/^[1-9]\d*$/u.test(lengthText)) {
      throw new Error("archive has malformed PAX record length");
    }
    const length = Number.parseInt(lengthText, 10);
    const end = offset + length;
    if (end > bytes.length || bytes[end - 1] !== 0x0a) {
      throw new Error("archive has truncated PAX record");
    }
    const record = bytes.subarray(space + 1, end - 1).toString("utf8");
    const equals = record.indexOf("=");
    if (equals <= 0) throw new Error("archive has malformed PAX record");
    values[record.slice(0, equals)] = record.slice(equals + 1);
    offset = end;
  }
  return values;
}

function parseArchive(compressed) {
  if (compressed.byteLength > archiveByteLimit) {
    throw new Error("compressed artifact exceeds the byte budget");
  }
  const archive = gunzipSync(compressed, { maxOutputLength: archiveByteLimit });
  const entries = [];
  const names = new Set();
  let offset = 0;
  let nextPax = {};
  let zeroBlocks = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((value) => value === 0)) {
      zeroBlocks += 1;
      if (zeroBlocks === 2) break;
      continue;
    }
    if (zeroBlocks > 0)
      throw new Error("archive contains data after a zero block");
    verifyHeaderChecksum(header);
    const size = octalField(header, 124, 12, "entry size");
    const mode = octalField(header, 100, 8, "entry mode");
    const paddedSize = Math.ceil(size / 512) * 512;
    if (offset + paddedSize > archive.length) {
      throw new Error("archive entry exceeds the archive boundary");
    }
    const content = archive.subarray(offset, offset + size);
    offset += paddedSize;
    const type = String.fromCharCode(header[156] ?? 0);
    const prefix = textField(header, 345, 155);
    const headerName = textField(header, 0, 100);
    const joinedName =
      prefix.length > 0 ? `${prefix}/${headerName}` : headerName;
    if (type === "x") {
      nextPax = parsePax(content);
      if (typeof nextPax.linkpath === "string") {
        throw new Error("archive PAX record contains a link target");
      }
      continue;
    }
    if (type === "g") {
      throw new Error("archive global PAX headers are not supported");
    }
    if (type !== "\0" && type !== "0" && type !== "5") {
      throw new Error(
        `unsupported artifact entry type: ${JSON.stringify(type)}`,
      );
    }
    const rawName =
      typeof nextPax.path === "string" ? nextPax.path : joinedName;
    nextPax = {};
    const name = validatePath(rawName.replace(/\/$/u, ""));
    if (names.has(name)) throw new Error(`duplicate artifact path: ${name}`);
    names.add(name);
    entries.push({
      name,
      kind: type === "5" ? "directory" : "file",
      executable: mode & 0o111,
      content: Buffer.from(content),
    });
    if (entries.length > entryLimit) {
      throw new Error("artifact entry budget exceeded");
    }
  }
  if (zeroBlocks !== 2)
    throw new Error("archive lacks the two-block terminator");
  if (archive.subarray(offset).some((value) => value !== 0)) {
    throw new Error("archive contains nonzero data after its terminator");
  }
  if (Object.keys(nextPax).length > 0) {
    throw new Error("archive ends with an unapplied PAX header");
  }
  return entries.sort((left, right) =>
    Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)),
  );
}

function canonicalContentsDigest(entries) {
  const hash = createHash("sha256");
  for (const entry of entries) {
    hash.update(
      `${entry.kind}\0${entry.name}\0${entry.executable}\0${entry.content.byteLength}\0`,
    );
    hash.update(entry.content);
    hash.update("\n");
  }
  return `sha256:${hash.digest("hex")}`;
}

async function inspectArtifact(source, builder) {
  const bytes = await readFile(source);
  const entries = parseArchive(bytes);
  const manifestEntry = entries.find(
    (entry) => entry.name === "package/package.json" && entry.kind === "file",
  );
  if (manifestEntry === undefined) {
    throw new Error(`${builder} has no regular package/package.json`);
  }
  const manifest = JSON.parse(manifestEntry.content.toString("utf8"));
  if (
    manifest.name !== "@davidahmann/mill" ||
    typeof manifest.version !== "string"
  ) {
    throw new Error(`${builder} has an unexpected package identity`);
  }
  return {
    builder,
    filename: path.basename(source),
    sha256: sha256(bytes),
    npmIntegrity: npmIntegrity(bytes),
    contentsDigest: canonicalContentsDigest(entries),
    packageName: manifest.name,
    packageVersion: manifest.version,
  };
}

const [first, second] = await Promise.all([
  inspectArtifact(firstPath, "builder-a"),
  inspectArtifact(secondPath, "builder-b"),
]);
if (
  first.packageName !== second.packageName ||
  first.packageVersion !== second.packageVersion ||
  first.contentsDigest !== second.contentsDigest
) {
  throw new Error(
    "independent artifacts do not have identical canonical contents",
  );
}
await mkdir(outputDirectory, { recursive: true });
const selectedFilename = first.filename;
const selectedPath = path.join(outputDirectory, selectedFilename);
await copyFile(firstPath, selectedPath, constants.COPYFILE_EXCL);
const metadata = {
  schemaVersion: "1",
  package: { name: first.packageName, version: first.packageVersion },
  builders: [first, second].map((artifact) => ({
    builder: artifact.builder,
    filename: artifact.filename,
    sha256: artifact.sha256,
    npmIntegrity: artifact.npmIntegrity,
    contentsDigest: artifact.contentsDigest,
  })),
  selectedArtifact: {
    builder: first.builder,
    filename: selectedFilename,
    sha256: first.sha256,
    npmIntegrity: first.npmIntegrity,
    contentsDigest: first.contentsDigest,
  },
};
await writeFile(
  path.join(outputDirectory, "artifact-metadata.json"),
  `${JSON.stringify(metadata, undefined, 2)}\n`,
  { flag: "wx", mode: 0o644 },
);
await writeFile(
  path.join(outputDirectory, `${selectedFilename}.sha256`),
  `${first.sha256.slice("sha256:".length)}  ${selectedFilename}\n`,
  { flag: "wx", mode: 0o644 },
);
process.stdout.write(
  `qualified matching release contents: ${selectedFilename} ${first.contentsDigest}\n`,
);
