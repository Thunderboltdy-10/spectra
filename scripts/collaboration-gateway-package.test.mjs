import { readFile } from "node:fs/promises";
import { dirname, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("hosted gateway package startup", () => {
  it("copies the complete relative import graph and starts the supported environment loader", async () => {
    const dockerfile = await readFile(resolve(root, "deploy/collaboration-gateway/Dockerfile"), "utf8");
    const instructions = dockerfile.replace(/\\\r?\n/g, " ").split(/\r?\n/);
    const command = instructions.find((line) => line.startsWith("CMD "));
    expect(JSON.parse(command.slice(4))).toEqual(["node", "scripts/serve-collaboration-gateway.mjs"]);
    const copied = new Map();
    for (const line of instructions) {
      if (!line.startsWith("COPY ") || line.includes("--from=")) continue;
      const parts = line.slice(5).trim().split(/\s+/);
      const destination = parts.pop();
      for (const source of parts) copied.set(source, posix.join(destination, posix.basename(source)));
    }
    // Bundle only for static resolution; neither entry is executed or written.
    // The raw entry is spawned by path and therefore needs an explicit graph root.
    const result = await build({
      absWorkingDir: root,
      entryPoints: ["scripts/serve-collaboration-gateway.mjs", "scripts/collaboration-gateway.mjs"],
      bundle: true, packages: "external", write: false, metafile: true,
      platform: "node", format: "esm", outdir: "unused",
    });
    for (const source of Object.keys(result.metafile.inputs)) {
      expect(copied.get(source), `Docker package omits or relocates ${source}`).toBe(source);
    }
    expect([...copied.keys()].some((path) => path.includes(".env"))).toBe(false);
  });
});
