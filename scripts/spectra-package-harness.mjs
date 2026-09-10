import { mkdir, writeFile } from "node:fs/promises";
import { createSpectraPackage, openSpectraPackage, upgradeManifest } from "../src/features/spectra/lenses/spectra-package.ts";

const out = ".tmp-n5-package";
await mkdir(out, { recursive: true });
const bytes = createSpectraPackage({ artifactType: "whiteboard", schemaVersion: 1, createdByVersion: "n5-harness", content: { nodes: [{ id: "n1", text: "Hello" }] }, assets: { "note.txt": new TextEncoder().encode("asset") } });
await writeFile(`${out}/roundtrip.spectra-pkg`, bytes);
const opened = await openSpectraPackage(bytes);
if (opened.manifest.artifactType !== "whiteboard" || opened.assets["note.txt"]?.length !== 5) throw new Error("round-trip failed");
const upgraded = upgradeManifest({ version: 0, type: "whiteboard", schemaVersion: 1, createdBy: "legacy" });
if (upgraded.packageFormatVersion !== 1 || upgraded.createdByVersion !== "legacy") throw new Error("upgrade failed");
console.log(JSON.stringify({ roundTrip: "passed", upgrade: "passed", path: `${out}/roundtrip.spectra-pkg` }));
