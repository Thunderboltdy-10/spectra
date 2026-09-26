/** Finite synthetic CPU/heap probe. Run each size in its own guarded process:
 * node --expose-gc --import tsx scripts/benchmark-artifact-preparation.ts 10000
 * node --expose-gc --import tsx scripts/benchmark-artifact-preparation.ts 50000
 * No database, services, native files, or provider calls are involved. */
import { performance } from "node:perf_hooks";
import { canonicalArtifactWriteContent, resolveArtifactWriteInput } from "../src/features/spectra/operations/artifact-write-content";
import { classifyArtifactContentWipe } from "../src/features/spectra/operations/artifact-content-wipe";
import { artifactScopeDigest } from "../convex/spectraArtifactWriteScope";

const cellCount = Number(process.argv[2] ?? 10_000);
if (![10_000, 50_000].includes(cellCount)) throw new Error("Choose a finite fixture: 10000 or 50000 cells.");
const cells = Object.fromEntries(Array.from({ length: cellCount }, (_, index) => [
  `A${index + 1}`, index % 10 === 0
    ? { value: index, formula: `=ROW()+${index}` }
    : { value: index % 7 === 0 ? false : index, format: { numberFormat: "0.00" } },
]));
const content = {
  workbook: { calculationMode: "automatic", locale: "en" }, activeSheetId: "sheet",
  sheets: [{ id: "sheet", name: "Synthetic fixture", cells, tables: [], charts: [] }],
};
const input = { blueprintKey: "sheets", contentPatch: { changes: [{ path: "/sheets/id:sheet/cells/A1/value", value: 37 }] } };
const bytes = Buffer.byteLength(JSON.stringify(content));
const samples: Array<Record<string, unknown>> = [];

async function sample(index: number) {
  global.gc?.();
  const startHeap = process.memoryUsage().heapUsed;
  const start = performance.now();
  const before = canonicalArtifactWriteContent("sheets", content);
  const afterCanonical = performance.now();
  const canonicalHeap = process.memoryUsage().heapUsed;
  const expected = resolveArtifactWriteInput("sheets", before, input, "Update the first cell to 37");
  const afterResolve = performance.now();
  const resolvedHeap = process.memoryUsage().heapUsed;
  const wipe = classifyArtifactContentWipe("sheets", content, expected.resolvedContent);
  const afterClassify = performance.now();
  const baseDigest = await artifactScopeDigest(before);
  const resultDigest = await artifactScopeDigest(expected.content);
  const end = performance.now();
  const endHeap = process.memoryUsage().heapUsed;
  if (wipe.fullContentDeletion || baseDigest === resultDigest) throw new Error("Fixture edit was not preserved.");
  const projected = expected.content as { sheets: Array<{ cells: Record<string, { value?: unknown }> }> };
  if (projected.sheets[0]?.cells.A1?.value !== 37) throw new Error("Fixture first cell edit was lost.");
  samples.push({ index, warmup: index === 0, cellCount, inputBytes: bytes,
    canonicalMs: afterCanonical - start, resolveMs: afterResolve - afterCanonical,
    classifyMs: afterClassify - afterResolve, digestMs: end - afterClassify, totalMs: end - start,
    heapAtStartBytes: startHeap, heapAfterCanonicalBytes: canonicalHeap,
    heapAfterResolveBytes: resolvedHeap, heapAtEndBytes: endHeap,
    observedBoundaryHeapGrowthBytes: Math.max(canonicalHeap, resolvedHeap, endHeap) - startHeap,
    processMaxRssKiB: process.resourceUsage().maxRSS,
  });
}

async function main() {
  for (let i = 0; i < 4; i++) await sample(i);
  global.gc?.();
  const measured = samples.slice(1);
  const totals = measured.map(sample => Number(sample.totalMs)).sort((a, b) => a - b);
  console.log(JSON.stringify({
    kind: "synthetic-artifact-preparation", node: process.version, cellCount,
    warmups: 1, measuredRepetitions: 3, medianTotalMs: totals[1], samples,
    heapAfterFinalGcBytes: process.memoryUsage().heapUsed,
    limitations: "Local synthetic helper CPU and phase-boundary heap only. maxRSS is process-wide high water, not retained heap. No Convex isolate, database IO/billing, browser, native conversion, or transport measurement.",
  }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
