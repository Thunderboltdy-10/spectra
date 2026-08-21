import { readFile } from "node:fs/promises";
import { summarizeSpectraPackage } from "../src/features/spectra/lenses/spectra-package.ts";

const path = process.argv[2];
if (!path) throw new Error("Usage: node scripts/spectra-package-reader.mjs <file.spectra-pkg>");
console.log(JSON.stringify(summarizeSpectraPackage(new Uint8Array(await readFile(path))), null, 2));
