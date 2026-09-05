import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { xlsxLens } from "../lenses/xlsx-lens";
import {
  xlsxArtifactContent,
  xlsxProjectionUpdateFromContent,
} from "../lenses/office-content";
import { xlsxChangedRegions } from "../lenses/office-projection-merge";

const xlsxPath =
  "C:/Users/pablo/Downloads/spectra-rc-v1-final-mounted-20260903/xlsx-run3/IA Data Collection.xlsx";

describe("xlsx-run3 native materialize", () => {
  it.skipIf(!existsSync(xlsxPath))(
    "writes one new cell without a format op for every visible cell",
    async () => {
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
