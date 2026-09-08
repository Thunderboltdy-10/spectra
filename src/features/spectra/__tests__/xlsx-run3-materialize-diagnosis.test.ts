import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { xlsxLens } from "../lenses/xlsx-lens";
import {
  xlsxArtifactContent,
  xlsxProjectionUpdateFromContent,
} from "../lenses/office-content";
import { xlsxChangedRegions } from "../lenses/office-projection-merge";

const configuredXlsxPath = process.env.SPECTRA_XLSX_RUN3_FIXTURE?.trim();
const xlsxPath = configuredXlsxPath ? resolve(configuredXlsxPath) : undefined;

describe("xlsx-run3 native materialize", () => {
  it.skipIf(!xlsxPath || !existsSync(xlsxPath))(
    "writes one new cell without a format op for every visible cell",
    async () => {
      if (!xlsxPath) throw new Error("SPECTRA_XLSX_RUN3_FIXTURE is required.");
      const opened = await xlsxLens.open(readFileSync(xlsxPath));
      const content = xlsxArtifactContent(opened.projection);
      const sheet = content.sheets[0];
      if (!sheet) throw new Error("xlsx-run3 has no first sheet.");
      sheet.cells = {
        ...sheet.cells,
        Z1: { value: "P8V1-T0-WRITE" },
      };
      const update = xlsxProjectionUpdateFromContent(
        content,
        opened.projection,
      );
      expect(update.operations).toEqual([
        {
          kind: "set-cell",
          sheetId: "xlsx:sheet:1",
          ref: "Z1",
          value: "P8V1-T0-WRITE",
        },
      ]);
      expect(
        xlsxChangedRegions(opened.projection, update.projection),
      ).toEqual(["xlsx:sheet:1:Z1"]);
      await xlsxLens.mutate(opened.preservedCarry, {
        kind: "ai-edit",
        operations: update.operations,
      });
    },
  );
});
