import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { comparePackages } from "@ariadng/office/preservation";
import {
  XlsxLensError,
  xlsxLens,
  type XlsxProjection,
} from "../../src/features/spectra/lenses/xlsx-lens";
import {
  fillRange,
  offsetFormula,
} from "../../src/features/spectra/sheets/operations";
import {
  coordinateToAddress,
  parseAddress,
  type SheetCell,
} from "../../src/features/spectra/sheets/model";

/**
 * Command-level evidence for the workbook.
 *
 * The rule the inventory sets is that a promotion with no fixture is not a
 * promotion. Each `.fixture.json` beside an Excel file names the commands that
 * write into it, the parts each one may dirty, and the regions that must come
 * back untouched. This module runs those rows against real Excel-authored files:
 * it drives the studio's own operation code into the lens, compares the saved
 * package part by part, and reopens the result.
 *
 * One row type is unlike the others. A `blocked` row asserts that a write is
 * *refused*: replacing a formula Spectra cannot evaluate with the number Excel
 * last cached for it is the one failure that looks perfect on screen and ruins
 * the workbook on the way back to Excel. That refusal is a feature, so it is
 * tested like one.
 */

export type XlsxFixtureMutationRow = {
  commandId: string;
  /** Part-name prefixes this command is allowed to reserialize. */
  touch: string[];
  /** Part-name prefixes that must be byte-identical afterwards. */
  preserve: string[];
  /**
   * The lens error code this row expects instead of a saved file. Present only
   * on rows that assert a refusal.
   */
  blocked?: string;
  /**
   * A native cell/formula edit may refresh an existing chart's cached points.
   * Permit that specific chart-part delta only when its non-cache structure and
   * source formula remain unchanged; chart formatting/relationships must still
   * stay byte-equivalent at the semantic level.
   */
  allowChartCacheRefresh?: boolean;
};

export type XlsxFixtureSidecar = {
  source?: string;
  contains?: string[];
  expected?: Record<string, string>;
  mutations?: XlsxFixtureMutationRow[];
};

export type XlsxCommandAssertion = {
  fixture: string;
  commandId: string;
  changedParts: string[];
  /** Every claimed part matched something that changed. */
  touchedAsDeclared: boolean;
  /** Nothing outside the claim changed. */
  noCollateralChange: boolean;
  /** Every claimed preserved part is byte-identical. */
  preserved: boolean;
  /** The write is visible when the file is reopened. */
  readBack: boolean;
  /** Every formula in the file is still a formula, with its text unchanged. */
  formulasIntact: boolean;
  notes?: string;
};

/** The cells of one projected sheet, in the shape the studio's operations take. */
function cellsOf(projection: XlsxProjection, sheetIndex: number) {
  const cells: Record<string, SheetCell> = {};
  for (const cell of projection.sheets[sheetIndex]!.cells) {
    cells[cell.ref] = {
      value: cell.value instanceof Date ? cell.value.toISOString() : cell.value,
      ...(cell.formula ? { formula: cell.formula } : {}),
      ...(cell.formulaSupport ? { nativeFormulaSupport: cell.formulaSupport } : {}),
    };
  }
  return cells;
}

/** The first sheet that has a cell the given test accepts. */
function findCell(
  projection: XlsxProjection,
  accept: (cell: XlsxProjection["sheets"][number]["cells"][number]) => boolean,
) {
  for (let index = 0; index < projection.sheets.length; index += 1) {
    const cell = projection.sheets[index]!.cells.find(accept);
    if (cell) return { sheetIndex: index, cell };
  }
  return null;
}

/** A projection with one cell replaced or added on the given sheet. */
function withCell(
  projection: XlsxProjection,
  sheetIndex: number,
  ref: string,
  patch: { value?: unknown; formula?: string },
): XlsxProjection {
  const sheet = projection.sheets[sheetIndex]!;
  const existing = sheet.cells.find((candidate) => candidate.ref === ref);
  const next = existing
    ? sheet.cells.map((candidate) =>
        candidate.ref === ref
          ? {
              ...candidate,
              ...(patch.formula !== undefined
                ? { formula: patch.formula }
                : {}),
              ...(patch.value !== undefined
                ? { value: patch.value as never }
                : {}),
            }
          : candidate,
      )
    : [
        ...sheet.cells,
        {
          id: `${sheet.id}:${ref}`,
          ref,
          value: (patch.value ?? null) as never,
          ...(patch.formula ? { formula: patch.formula } : {}),
        },
      ];
  return {
    ...projection,
    sheets: projection.sheets.map((candidate, index) =>
      index === sheetIndex ? { ...candidate, cells: next } : candidate,
    ),
  };
}

/** A ref two rows below the lowest used row of a sheet, so nothing is trampled. */
function freeRef(projection: XlsxProjection, sheetIndex: number, column = 0) {
  let lowest = 0;
  for (const cell of projection.sheets[sheetIndex]!.cells) {
    const coordinate = parseAddress(cell.ref);
    if (coordinate && coordinate.row > lowest) lowest = coordinate.row;
  }
  return coordinateToAddress({ row: lowest + 2, column });
}

/**
 * One projection edit per command id, each the same change the studio makes when
 * a person uses that control. Where the studio has a pure operation for the verb,
 * the harness calls that operation rather than restating it, so the evidence is
 * about the shipped code path and not about a bespoke test edit.
 */
const EDITS: Record<
  string,
  (projection: XlsxProjection) => XlsxProjection | undefined
> = {
  // A plain paste of one value into a cell that holds no formula. A fixture whose
  // sheets are empty of values still has somewhere to paste, which is the point
  // of the free-ref fallback: the command works on a blank sheet too.
  "sheets.clipboard.paste": (projection) => {
    const found = findCell(projection, (cell) => !cell.formula);
    const sheetIndex = found?.sheetIndex ?? 0;
    if (!projection.sheets[sheetIndex]) return undefined;
    const ref = found?.cell.ref ?? freeRef(projection, sheetIndex, 0);
    return withCell(projection, sheetIndex, ref, {
      value: "Spectra pasted this",
    });
  },
  // Fill down, run through the studio's own `fillRange`, so the file proves the
  // operation and not a re-implementation of it.
  "sheets.fill.down": (projection) => {
    const found = findCell(projection, (cell) => !cell.formula);
    if (!found) return undefined;
    const seed = parseAddress(found.cell.ref);
    if (!seed) return undefined;
    const target = { row: seed.row + 1, column: seed.column };
    const filled = fillRange(cellsOf(projection, found.sheetIndex), {
      start: seed,
      end: target,
    }, "down");
    const address = coordinateToAddress(target);
    const written = filled.cells[address];
    if (!written) return undefined;
    return withCell(projection, found.sheetIndex, address, {
      ...(written.formula ? { formula: written.formula } : {}),
      value: written.value ?? null,
    });
  },
  // AutoSum writes a formula, which is a different lens operation from a value.
  "sheets.formula.autosum": (projection) => {
    const found = findCell(projection, (cell) => typeof cell.value === "number");
    if (!found) return undefined;
    const seed = parseAddress(found.cell.ref);
    if (!seed) return undefined;
    const ref = freeRef(projection, found.sheetIndex, seed.column);
    const top = coordinateToAddress({ row: seed.row, column: seed.column });
    const bottom = coordinateToAddress({
      row: (parseAddress(ref)?.row ?? seed.row + 1) - 1,
      column: seed.column,
    });
    return withCell(projection, found.sheetIndex, ref, {
      formula: `=SUM(${top}:${bottom})`,
      value: null,
    });
  },
  // A recognized formula written into a free cell, then offset the way a fill
  // would offset it. Proves the reference rewriter against a real file.
  "sheets.formula.insert": (projection) => {
    const found = findCell(projection, (cell) => typeof cell.value === "number");
    if (!found) return undefined;
    const ref = freeRef(projection, found.sheetIndex, 0);
    return withCell(projection, found.sheetIndex, ref, {
      formula: offsetFormula(`=ROUND(${found.cell.ref}, 2)`, 0, 0),
      value: null,
    });
  },
  // The refusal. A cached-only formula is asked to become its own cached number,
  // which is exactly the write that must never succeed.
  "sheets.clipboard.paste.values": (projection) => {
    const found = findCell(
      projection,
      (cell) => cell.formulaSupport === "cached-only",
    );
    if (!found) return undefined;
    const sheet = projection.sheets[found.sheetIndex]!;
    return {
      ...projection,
      sheets: projection.sheets.map((candidate, index) =>
        index !== found.sheetIndex
          ? candidate
          : {
              ...candidate,
              cells: sheet.cells.map((cell) =>
                cell.ref === found.cell.ref
                  ? { ...cell, formula: undefined, formulaSupport: undefined }
                  : cell,
              ),
            },
      ),
    };
  },
};

/** Every `<f>` formula text in the package, keyed by the part that holds it. */
function formulaTexts(payload: Uint8Array) {
  const files = unzipSync(payload);
  const found: Record<string, string[]> = {};
  for (const [name, bytes] of Object.entries(files)) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/i.test(name)) continue;
    const xml = strFromU8(bytes);
    found[name] = [...xml.matchAll(/<f[^>]*>([^<]*)<\/f>/g)].map(
      (match) => match[1]!,
    );
  }
  return found;
}

/**
 * Chart caches are derived values, not chart structure. Excel changes the
 * cache kind when a source value changes from numeric to text and may normalize
 * an equivalent sheet quote at the same time. Ignore only those two details;
 * a changed range, series, axis, style, relationship or layout is still a
 * collateral mutation.
 */
function chartStructureFingerprint(payload: Uint8Array, name: string) {
  const xml = strFromU8(unzipSync(payload)[name] ?? new Uint8Array());
  return xml
    .replace(/^<\?xml[^>]*\?>\s*/i, "")
    .replace(/<c:(?:numCache|strCache)>[\s\S]*?<\/c:(?:numCache|strCache)>/gi, "<c:cache />")
    .replace(/<c:f>([^<]*)<\/c:f>/gi, (_match, formula: string) => {
      const canonical = formula.trim().replace(/^'((?:[^']|'')+)'!/, (_sheetMatch, sheet: string) => `${sheet.replaceAll("''", "'")}!`);
      return `<c:f>${canonical}</c:f>`;
    });
}

function chartCacheOnly(source: Uint8Array, saved: Uint8Array, name: string) {
  return /^xl\/charts\/[^/]+\.xml$/i.test(name) &&
    chartStructureFingerprint(source, name) === chartStructureFingerprint(saved, name) &&
    strFromU8(unzipSync(source)[name] ?? new Uint8Array()) !== strFromU8(unzipSync(saved)[name] ?? new Uint8Array());
}

export async function runXlsxCommandFixtures(fixtureDir: string) {
  const assertions: XlsxCommandAssertion[] = [];
  const files = (await readdir(fixtureDir)).filter((name) =>
    name.endsWith(".fixture.json"),
  );
  for (const file of files.sort()) {
    const stem = file.replace(/\.fixture\.json$/, "");
    const sidecar = JSON.parse(
      await readFile(join(fixtureDir, file), "utf8"),
    ) as XlsxFixtureSidecar;
    if (!sidecar.mutations?.length) continue;
    const names = await readdir(fixtureDir);
    const workbookName = names.find((name) =>
      new RegExp(`^${stem}\\.(xlsx|xlsm|xltx|xltm|xlam)$`, "i").test(name),
    );
    if (!workbookName) {
      assertions.push({
        fixture: stem,
        commandId: "(fixture)",
        changedParts: [],
        touchedAsDeclared: false,
        noCollateralChange: false,
        preserved: false,
        readBack: false,
        formulasIntact: false,
        notes: "the sidecar names no Excel file beside it",
      });
      continue;
    }
    const source = new Uint8Array(
      await readFile(join(fixtureDir, workbookName)),
    );
    const partNames = Object.keys(unzipSync(source));
    for (const row of sidecar.mutations) {
      const fail = (notes: string): XlsxCommandAssertion => ({
        fixture: stem,
        commandId: row.commandId,
        changedParts: [],
        touchedAsDeclared: false,
        noCollateralChange: false,
        preserved: false,
        readBack: false,
        formulasIntact: false,
        notes,
      });
      const edit = EDITS[row.commandId];
      if (!edit) {
        assertions.push(fail("no evidence path is registered for this command id"));
        continue;
      }
      const opened = await xlsxLens.open(source);
      const next = edit(opened.projection);
      if (!next) {
        assertions.push(fail("this fixture has nothing for the command to act on"));
        continue;
      }

      // A refusal row: the write must throw the named lens error and produce no
      // file at all.
      if (row.blocked) {
        let code: string | null = null;
        let caughtDetail = "";
        try {
          await xlsxLens.materialize({
            projection: next,
            carry: opened.preservedCarry,
          });
        } catch (error) {
          // `tsx` can evaluate the same source through distinct module URLs when
          // this harness is imported by the aggregate Office runner. In that
          // case a real XlsxLensError may not share this module's constructor
          // identity. The public contract is its stable code, so retain the
          // instanceof check while also accepting that cross-module shape.
          code = error instanceof XlsxLensError
            ? error.code
            : error && typeof error === "object" && "code" in error && typeof error.code === "string"
              ? error.code
              : "UNKNOWN";
          caughtDetail = error instanceof Error
            ? `${error.name}: ${error.message}`
            : String(error);
        }
        const held = code === row.blocked;
        assertions.push({
          fixture: stem,
          commandId: row.commandId,
          changedParts: [],
          touchedAsDeclared: held,
          noCollateralChange: held,
          preserved: held,
          readBack: held,
          formulasIntact: held,
          notes: held
            ? `refused with ${code}, as it must`
            : `expected ${row.blocked}, got ${code ?? "a saved file"}${caughtDetail ? ` (${caughtDetail})` : ""}`,
        });
        continue;
      }

      const saved = await xlsxLens.materialize({
        projection: next,
        carry: opened.preservedCarry,
      });
      const comparison = await comparePackages(source, saved);
      const chartCacheRefreshes = new Set(
        comparison.parts
          .filter((part) => part.verdict !== "identical")
          .map((part) => part.name.replace(/^\//, ""))
          .filter((part) => row.allowChartCacheRefresh && chartCacheOnly(source, saved, part)),
      );
      const changed = comparison.parts
        .filter((part) => part.verdict !== "identical")
        .map((part) => part.name.replace(/^\//, ""));
      // Excel rewrites the shared string table and the calc chain whenever a
      // cell changes, and the OPC layer rewrites relationship and content-type
      // parts when a part is added. None of those is a fidelity loss.
      const infrastructure = (part: string) =>
        part.includes("_rels/") ||
        part.startsWith("[Content_Types]") ||
        /^xl\/(sharedStrings|calcChain|workbook)\.xml$/i.test(part) ||
        /^docProps\//i.test(part);
      const touchedAsDeclared = row.touch.every((claim) =>
        changed.some((part) => part.startsWith(claim)),
      );
      const noCollateralChange = changed.every(
        (part) =>
          infrastructure(part) ||
          row.touch.some((claim) => part.startsWith(claim)) ||
          chartCacheRefreshes.has(part),
      );
      const preserved = row.preserve.every((claim) => {
        const name = partNames.find((candidate) => candidate.startsWith(claim));
        if (!name) return false;
        return Boolean(
          comparison.parts.find(
            (part) =>
              part.name.replace(/^\//, "") === name &&
              (part.verdict === "identical" || chartCacheRefreshes.has(name)),
          ),
        );
      });

      // Formula honesty, read off the saved bytes rather than the projection: no
      // formula may have lost its text or turned into a literal.
      const before = formulaTexts(source);
      const after = formulaTexts(saved);
      const formulasIntact = Object.entries(before).every(([part, texts]) =>
        texts.every((text) => (after[part] ?? []).includes(text)),
      );

      const reopened = await xlsxLens.open(saved);
      const signature = (projection: XlsxProjection) =>
        JSON.stringify(
          projection.sheets.map((sheet) =>
            sheet.cells.map((cell) => [cell.ref, cell.value, cell.formula ?? ""]),
          ),
        );
      const readBack = signature(reopened.projection) !== signature(opened.projection);

      assertions.push({
        fixture: stem,
        commandId: row.commandId,
        changedParts: changed,
        touchedAsDeclared,
        noCollateralChange,
        preserved,
        readBack,
        formulasIntact,
        ...(chartCacheRefreshes.size ? { notes: `chart cache refreshed safely: ${[...chartCacheRefreshes].join(", ")}` } : {}),
      });
    }
  }
  const failures = assertions.filter(
    (assertion) =>
      !assertion.touchedAsDeclared ||
      !assertion.noCollateralChange ||
      !assertion.preserved ||
      !assertion.readBack ||
      !assertion.formulasIntact,
  );
  return { assertions, failures };
}

/**
 * Runnable on its own — `tsx scripts/fidelity-harness/xlsx-commands.ts` — so the
 * workbook's evidence can be produced without waiting on the whole office pass.
 * `office.ts` calls `runXlsxCommandFixtures` for the committed report.
 */
async function main() {
  const result = await runXlsxCommandFixtures(
    join(process.cwd(), "fixtures", "office", "xlsx"),
  );
  console.log(JSON.stringify(result, null, 2));
  if (result.failures.length) process.exitCode = 1;
}

if (process.argv[1] && /xlsx-commands\.ts$/.test(process.argv[1])) void main();
