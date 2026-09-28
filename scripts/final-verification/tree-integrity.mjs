import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = resolve(scriptDirectory, "..", "..");

function outputIsInsideRoot(output, root) {
  const relation = relative(root, output);
  return (
    relation === "" || (!relation.startsWith(`..${sep}`) && relation !== "..")
  );
}

async function sha256File(path) {
  const hash = createHash("sha256");
  await new Promise((resolveHash, rejectHash) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", rejectHash);
    stream.on("end", resolveHash);
  });
  return hash.digest("hex");
}

async function walk(root, directory, files) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(root, absolute, files);
      continue;
    }
    if (!entry.isFile()) continue;
    const path = relative(root, absolute).replaceAll(sep, "/");
    try {
      const info = await lstat(absolute);
      files.push({
        path,
        bytes: info.size,
        status: "readable",
        sha256: await sha256File(absolute),
      });
    } catch (error) {
      files.push({
        path,
        bytes: null,
        status: "locked",
        errorCode: error?.code ?? "ERROR",
      });
    }
  }
}

export async function captureTree(rootPath) {
  const root = resolve(rootPath);
  const files = [];
  await walk(root, root, files);
  const digest = createHash("sha256")
    .update(
      files
        .map(
          (file) =>
            `${file.status}\t${file.bytes ?? ""}\t${file.sha256 ?? file.errorCode}\t${file.path}`,
        )
        .join("\n"),
    )
    .digest("hex");
  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    root,
    files,
    summary: {
      files: files.length,
      readableFiles: files.filter((file) => file.status === "readable").length,
      lockedFiles: files.filter((file) => file.status === "locked").length,
      readableBytes: files.reduce((sum, file) => sum + (file.bytes ?? 0), 0),
      digest,
    },
  };
}

export function compareTrees(before, after) {
  const left = new Map(before.files.map((file) => [file.path, file]));
  const right = new Map(after.files.map((file) => [file.path, file]));
  const added = [];
  const removed = [];
  const modified = [];
  const becameUnreadable = [];
  const newlyReadable = [];
  const lockedUnchanged = [];
  for (const path of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    const beforeFile = left.get(path);
    const afterFile = right.get(path);
    if (!beforeFile) {
      added.push(path);
      continue;
    }
    if (!afterFile) {
      removed.push(path);
      continue;
    }
    if (beforeFile.status === "locked" && afterFile.status === "locked") {
      lockedUnchanged.push(path);
      continue;
    }
    if (beforeFile.status === "readable" && afterFile.status === "locked") {
      becameUnreadable.push(path);
      continue;
    }
    if (beforeFile.status === "locked" && afterFile.status === "readable") {
      newlyReadable.push(path);
      continue;
    }
    if (
      beforeFile.sha256 !== afterFile.sha256 ||
      beforeFile.bytes !== afterFile.bytes
    )
      modified.push(path);
  }
  return {
    pass:
      added.length === 0 &&
      removed.length === 0 &&
      modified.length === 0 &&
      becameUnreadable.length === 0,
    baselineDigest: before.summary.digest,
    afterDigest: after.summary.digest,
    added,
    removed,
    modified,
    becameUnreadable,
    newlyReadable,
    lockedUnchanged,
    note: "Locked files are listed separately. A readable file becoming locked is not treated as unchanged.",
  };
}

async function writeReport(path, value, root) {
  const output = resolve(path);
  if (outputIsInsideRoot(output, root))
    throw new Error(
      "Refusing to write an integrity report inside the tree being checked.",
    );
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return output;
}

function parseArguments(argv) {
  const [command, ...tokens] = argv;
  const values = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--"))
      throw new Error(`Unexpected argument ${token}.`);
    const value = tokens[index + 1];
    if (!value || value.startsWith("--"))
      throw new Error(`Missing value for ${token}.`);
    values[token.slice(2)] = value;
    index += 1;
  }
  return { command, values };
}

async function main() {
  const { command, values } = parseArguments(process.argv.slice(2));
  if (!values.root) throw new Error("--root is required.");
  const root = resolve(values.root);
  if (command === "capture") {
    if (!values.out) throw new Error("capture requires --out.");
    const snapshot = await captureTree(root);
    const output = await writeReport(values.out, snapshot, root);
    process.stdout.write(
      `${JSON.stringify({ output, pass: true, summary: snapshot.summary }, null, 2)}\n`,
    );
    return;
  }
  if (command === "compare") {
    if (!values.before || !values.out)
      throw new Error("compare requires --before and --out.");
    const before = JSON.parse(await readFile(resolve(values.before), "utf8"));
    const after = await captureTree(root);
    const comparison = compareTrees(before, after);
    const output = await writeReport(
      values.out,
      {
        schemaVersion: 1,
        comparedAt: new Date().toISOString(),
        root,
        after,
        comparison,
      },
      root,
    );
    process.stdout.write(
      `${JSON.stringify({ output, ...comparison }, null, 2)}\n`,
    );
    if (!comparison.pass) process.exitCode = 1;
    return;
  }
  throw new Error('Use "capture" or "compare".');
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
