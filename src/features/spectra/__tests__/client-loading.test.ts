import { build, type Metafile } from "esbuild";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function eagerInputs(metafile: Metafile, entry: string) {
  const outputs = metafile.outputs;
  const first = Object.keys(outputs).find((key) => outputs[key].entryPoint === entry);
  if (!first) throw new Error(`Missing bundle entry: ${entry}`);
  const pending = [first];
  const seen = new Set<string>();
  const inputs = new Set<string>();
  while (pending.length) {
    const key = pending.pop()!;
    if (seen.has(key)) continue;
    seen.add(key);
    const output = outputs[key];
    for (const input of Object.keys(output.inputs)) inputs.add(input);
    for (const dependency of output.imports) {
      if (!dependency.external && dependency.kind !== "dynamic-import") {
        pending.push(dependency.path);
      }
    }
  }
  return inputs;
}

describe("Library loading boundary", () => {
  it("emits the studio and DOCX import implementation outside the initial shell chunks", async () => {
    const entries = [
      "src/features/spectra/pages/spectra-shell.tsx",
      "src/features/spectra/organization/library-import.ts",
    ];
    const { metafile } = await build({
      absWorkingDir: resolve(__dirname, "../../../.."),
      entryPoints: entries,
      bundle: true,
      splitting: true,
      format: "esm",
      platform: "browser",
      packages: "external",
      external: ["*.css"],
      outdir: ".spectra-local/launch-s11/performance/test-bundle",
      metafile: true,
      write: false,
      logLevel: "silent",
    });
    const studio = "src/features/spectra/components/artifact-studio.tsx";
    const docx = "src/features/spectra/lenses/docx-adapter.ts";
    // Both features still exist in the emitted lazy graph.
    expect(Object.values(metafile!.outputs).some((output) => output.inputs[studio])).toBe(true);
    expect(Object.values(metafile!.outputs).some((output) => output.inputs[docx])).toBe(true);
    for (const entry of entries) {
      const eager = eagerInputs(metafile!, entry);
      expect(eager.has(studio), entry).toBe(false);
      expect(eager.has(docx), entry).toBe(false);
      expect(eager.has("src/features/spectra/collaboration/use-artifact-live-model.ts"), entry).toBe(false);
    }
  });
});
