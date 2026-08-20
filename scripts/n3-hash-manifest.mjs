import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const [rootArg, outputArg] = process.argv.slice(2);
if (!rootArg || !outputArg) {
  throw new Error("usage: node scripts/n3-hash-manifest.mjs <root> <output>");
}

const root = path.resolve(rootArg);
const output = path.resolve(outputArg);
const rows = [];

async function visit(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await visit(absolute);
      continue;
    }
    if (!entry.isFile()) continue;
    const relative = path.relative(root, absolute).replaceAll(path.sep, "/");
    try {
      const hash = createHash("sha256");
      await new Promise((resolve, reject) => {
        const stream = createReadStream(absolute);
        stream.on("data", (chunk) => hash.update(chunk));
        stream.on("error", reject);
        stream.on("end", resolve);
      });
      rows.push(`${hash.digest("hex")}  ${relative}`);
    } catch (error) {
      rows.push(`LOCKED ${error.code ?? "ERROR"}  ${relative}`);
    }
  }
}

await visit(root);
const body = [`# files=${rows.length}`, ...rows, ""].join("\n");
await writeFile(output, body, "utf8");
const digest = createHash("sha256").update(body).digest("hex");
console.log(JSON.stringify({ files: rows.length, digest, output }));
