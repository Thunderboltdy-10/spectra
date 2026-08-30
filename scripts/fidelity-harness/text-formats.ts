import path from "node:path";
import {
  csvOperationSchema,
  type CsvProjection,
} from "../../src/features/spectra/lenses/csv-lens";
import {
  mdOperationSchema,
  type MdProjection,
} from "../../src/features/spectra/lenses/md-lens";
import { runLensFixtureContract } from "./contract-runner";

const root = process.cwd();

async function main() {
  const results = await Promise.all([
    runLensFixtureContract({
      fixturePath: path.join(root, "fixtures", "md", "obsidian-note.md"),
      sidecarPath: path.join(
        root,
        "fixtures",
        "md",
        "obsidian-note.fixture.json",
      ),
      projectionText: (projection: MdProjection) =>
        `${projection.nativeBinding.frontmatter ?? ""}${projection.body}`,
      parseDelta: (value) => mdOperationSchema.parse(value),
    }),
    runLensFixtureContract({
      fixturePath: path.join(root, "fixtures", "csv", "single-table.csv"),
      sidecarPath: path.join(
        root,
        "fixtures",
        "csv",
        "single-table.fixture.json",
      ),
      projectionText: (projection: CsvProjection) =>
        projection.table.cells
          .map((cell) => `${cell.ref}=${cell.value}`)
          .join("\n"),
      parseDelta: (value) => csvOperationSchema.parse(value),
    }),
  ]);

  console.log(JSON.stringify({ contracts: results }, null, 2));
}

void main();
