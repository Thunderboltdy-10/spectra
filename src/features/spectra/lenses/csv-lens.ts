import { z } from "zod";
import { sha256Payload } from "./payload-hash";
import type {
  LensCapabilitySet,
  LensExternalDiff,
  LensFidelityEntry,
  LensFidelityMap,
  LensOpenResult,
  SpectraLens,
} from "./types";

const csvDelimiterSchema = z.enum([",", ";", "\t", "|"]);
const csvCellSchema = z
  .object({
    id: z.string().regex(/^csv:[A-Z]+[1-9][0-9]*$/),
    ref: z.string().regex(/^[A-Z]+[1-9][0-9]*$/),
    value: z.string().max(5_000_000),
  })
  .strict();

export const csvProjectionSchema = z
  .object({
    table: z
      .object({
        id: z.literal("csv:table"),
        rowCount: z.number().int().nonnegative().max(1_000_000),
        columnCount: z.number().int().nonnegative().max(16_384),
        cells: z.array(csvCellSchema).max(5_000_000),
      })
      .strict(),
    nativeBinding: z
      .object({
        version: z.literal(1),
        format: z.literal("csv"),
        profile: z.enum(["strict-native", "enhanced", "spectra-native"]),
        semanticDigest: z.string().regex(/^[a-f0-9]{64}$/),
        delimiter: csvDelimiterSchema,
        lineEnding: z.enum(["lf", "crlf", "cr"]),
        byteOrderMark: z.boolean(),
        trailingNewline: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type CsvProjection = z.infer<typeof csvProjectionSchema>;

export const csvOperationSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("set-cell"),
      ref: z.string().regex(/^[A-Z]+[1-9][0-9]*$/),
      value: z.string().max(5_000_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("clear-cell"),
      ref: z.string().regex(/^[A-Z]+[1-9][0-9]*$/),
    })
    .strict(),
]);
export type CsvSemanticDelta = z.infer<typeof csvOperationSchema>;
export const CSV_LENS_DELTA_KINDS = csvOperationSchema.options.map(
  (operation) => operation.shape.kind.value,
);

export class CsvLensError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CsvLensError";
  }
}

function decodeCsv(payload: Uint8Array) {
  const byteOrderMark =
    payload.length >= 3 &&
    payload[0] === 0xef &&
    payload[1] === 0xbb &&
    payload[2] === 0xbf;
  try {
    return {
      byteOrderMark,
      text: new TextDecoder("utf-8", { fatal: true }).decode(
        byteOrderMark ? payload.subarray(3) : payload,
      ),
    };
  } catch {
    throw new CsvLensError(
      "CSV_INVALID_UTF8",
      "This CSV file is not valid UTF-8. Spectra kept its bytes unchanged and did not guess an encoding.",
    );
  }
}

function lineEndingOf(
  text: string,
): CsvProjection["nativeBinding"]["lineEnding"] {
  if (text.includes("\r\n")) return "crlf";
  if (text.includes("\r")) return "cr";
  return "lf";
}

function delimiterCounts(firstRecord: string) {
  const counts = new Map<string, number>([
    [",", 0],
    [";", 0],
    ["\t", 0],
    ["|", 0],
  ]);
  let quoted = false;
  for (let index = 0; index < firstRecord.length; index += 1) {
    const char = firstRecord[index]!;
    if (char === '"') {
      if (quoted && firstRecord[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && counts.has(char)) {
      counts.set(char, counts.get(char)! + 1);
    }
  }
  return counts;
}

function firstRecordOf(text: string) {
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (char === '"') {
      if (quoted && text[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && (char === "\r" || char === "\n")) {
      return text.slice(0, index);
    }
  }
  return text;
}

function detectDelimiter(text: string): z.infer<typeof csvDelimiterSchema> {
  const counts = delimiterCounts(firstRecordOf(text));
  let best: z.infer<typeof csvDelimiterSchema> = ",";
  for (const delimiter of [";", "\t", "|"] as const) {
    if (counts.get(delimiter)! > counts.get(best)!) best = delimiter;
  }
  return best;
}

function parseCsv(text: string, delimiter: string) {
  if (!text) return [] as string[][];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let recordEnded = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      recordEnded = false;
      continue;
    }
    if (char === '"' && field.length === 0) {
      quoted = true;
      recordEnded = false;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
      recordEnded = false;
    } else if (char === "\r" || char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      recordEnded = true;
      if (char === "\r" && text[index + 1] === "\n") index += 1;
    } else {
      field += char;
      recordEnded = false;
    }
  }
  if (quoted) {
    throw new CsvLensError(
      "CSV_UNCLOSED_QUOTE",
      "This CSV file has an unclosed quoted field. Spectra kept it unchanged instead of guessing where the field ends.",
    );
  }
  if (!recordEnded || row.length || field.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function columnName(index: number) {
  let value = index + 1;
  let output = "";
  while (value > 0) {
    const digit = (value - 1) % 26;
    output = String.fromCharCode(65 + digit) + output;
    value = Math.floor((value - 1) / 26);
  }
  return output;
}

function parseRef(ref: string) {
  const match = /^([A-Z]+)([1-9][0-9]*)$/.exec(ref.toUpperCase());
  if (!match) {
    throw new CsvLensError(
      "CSV_CELL_IDENTITY_INVALID",
      "This CSV change has no stable cell address, so Spectra refused to guess its target.",
    );
  }
  let column = 0;
  for (const char of match[1]!) column = column * 26 + char.charCodeAt(0) - 64;
  return { row: Number(match[2]) - 1, column: column - 1 };
}

function cellsFromRows(rows: readonly (readonly string[])[]) {
  const columnCount = rows.reduce(
    (maximum, row) => Math.max(maximum, row.length),
    0,
  );
  return {
    rowCount: rows.length,
    columnCount,
    cells: rows.flatMap((row, rowIndex) =>
      Array.from({ length: columnCount }, (_, columnIndex) => {
        const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
        return { id: `csv:${ref}`, ref, value: row[columnIndex] ?? "" };
      }),
    ),
  };
}

function fidelityMap(
  profile: CsvProjection["nativeBinding"]["profile"],
): LensFidelityMap {
  const unsupported: Array<[string, string]> = [
    [
      "formulas",
      "CSV stores formula-looking text but has no calculation model.",
    ],
    ["numberFormats", "CSV has no native number formatting."],
    ["styles", "CSV has no native cell styling."],
    ["merges", "CSV cannot represent merged cells."],
    ["freezePanes", "CSV cannot represent frozen rows or columns."],
    ["charts", "CSV cannot contain charts."],
    [
      "sheetStructure",
      "CSV is exactly one table and cannot contain multiple sheets.",
    ],
  ];
  const entries: LensFidelityEntry[] = [
    { regionId: "csv:table", feature: "cells", class: "NATIVE" },
    {
      regionId: "csv:single-table-boundary",
      feature: "singleTable",
      class: "EQUIVALENT",
      reason: "CSV is represented as one Spectra sheet table.",
    },
    ...unsupported.map(([feature, reason]) => ({
      regionId: `csv:boundary:${feature}`,
      feature,
      class: "PRESERVED" as const,
      readOnly: true,
      reason,
    })),
  ];
  return { version: 1, profile, entries };
}

function capabilities(
  profile: CsvProjection["nativeBinding"]["profile"],
): LensCapabilitySet {
  return {
    profile,
    human: [
      { id: "edit-cell", available: true },
      {
        id: "edit-formula",
        available: false,
        reason:
          "CSV keeps formula-looking content as text and does not calculate it.",
      },
      {
        id: "format-cell",
        available: false,
        reason: "CSV has no cell formatting to write.",
      },
      {
        id: "add-sheet",
        available: false,
        reason: "CSV contains one table, not multiple sheets.",
      },
    ],
    aiOperations: ["set_cell", "clear_cell"],
  };
}

function quoteCsv(value: string, delimiter: string) {
  return value.includes(delimiter) ||
    /["\r\n]/u.test(value) ||
    /^\s|\s$/u.test(value)
    ? `"${value.replaceAll('"', '""')}"`
    : value;
}

function encodeProjection(projection: CsvProjection) {
  const byRef = new Map(
    projection.table.cells.map((cell) => [cell.ref, cell.value]),
  );
  const lineEnding =
    projection.nativeBinding.lineEnding === "crlf"
      ? "\r\n"
      : projection.nativeBinding.lineEnding === "cr"
        ? "\r"
        : "\n";
  let text = Array.from({ length: projection.table.rowCount }, (_, rowIndex) =>
    Array.from({ length: projection.table.columnCount }, (_, columnIndex) =>
      quoteCsv(
        byRef.get(`${columnName(columnIndex)}${rowIndex + 1}`) ?? "",
        projection.nativeBinding.delimiter,
      ),
    ).join(projection.nativeBinding.delimiter),
  ).join(lineEnding);
  if (projection.nativeBinding.trailingNewline && projection.table.rowCount) {
    text += lineEnding;
  }
  const encoded = new TextEncoder().encode(text);
  if (!projection.nativeBinding.byteOrderMark) return encoded;
  const output = new Uint8Array(encoded.length + 3);
  output.set([0xef, 0xbb, 0xbf]);
  output.set(encoded, 3);
  return output;
}

function validateProjectionIdentity(projection: CsvProjection) {
  const seen = new Set<string>();
  for (const cell of projection.table.cells) {
    if (seen.has(cell.ref)) {
      throw new CsvLensError(
        "CSV_CELL_IDENTITY_DUPLICATE",
        `The CSV projection names ${cell.ref} more than once, so Spectra refused to guess which value is authoritative.`,
      );
    }
    seen.add(cell.ref);
    const position = parseRef(cell.ref);
    if (
      cell.id !== `csv:${cell.ref}` ||
      position.row >= projection.table.rowCount ||
      position.column >= projection.table.columnCount
    ) {
      throw new CsvLensError(
        "CSV_CELL_IDENTITY_INVALID",
        `The CSV cell ${cell.ref} falls outside its declared table, so Spectra refused to guess its target.`,
      );
    }
  }
}

export const csvLens: SpectraLens<CsvProjection, CsvSemanticDelta> = {
  format: "csv",

  async open(
    payload,
    profile = "strict-native",
  ): Promise<LensOpenResult<CsvProjection>> {
    const decoded = decodeCsv(payload);
    const delimiter = detectDelimiter(decoded.text);
    const rows = parseCsv(decoded.text, delimiter);
    const table = cellsFromRows(rows);
    const semanticDigest = await sha256Payload(
      new TextEncoder().encode(JSON.stringify({ rows, delimiter })),
    );
    const projection = csvProjectionSchema.parse({
      table: { id: "csv:table", ...table },
      nativeBinding: {
        version: 1,
        format: "csv",
        profile,
        semanticDigest,
        delimiter,
        lineEnding: lineEndingOf(decoded.text),
        byteOrderMark: decoded.byteOrderMark,
        trailingNewline: /(?:\r\n|\r|\n)$/u.test(decoded.text),
      },
    });
    const fidelity = fidelityMap(profile);
    return {
      projection,
      fidelityMap: fidelity,
      preservedCarry: {
        version: 1,
        format: "csv",
        profile,
        basePayloadHash: await sha256Payload(payload),
        payload,
        projection,
      },
      capabilities: capabilities(profile),
    };
  },

  async mutate(carry, delta) {
    const ref = delta.ref.toUpperCase();
    const position = parseRef(ref);
    const cells = new Map(
      carry.projection.table.cells.map((cell) => [cell.ref, cell]),
    );
    cells.set(ref, {
      id: `csv:${ref}`,
      ref,
      value: delta.kind === "clear-cell" ? "" : delta.value,
    });
    return this.materialize({
      projection: {
        ...carry.projection,
        table: {
          ...carry.projection.table,
          rowCount: Math.max(carry.projection.table.rowCount, position.row + 1),
          columnCount: Math.max(
            carry.projection.table.columnCount,
            position.column + 1,
          ),
          cells: [...cells.values()],
        },
      },
      carry,
    });
  },

  async materialize({ projection, carry }) {
    const next = csvProjectionSchema.parse(projection);
    validateProjectionIdentity(next);
    if (
      next.nativeBinding.delimiter !==
        carry.projection.nativeBinding.delimiter ||
      next.nativeBinding.lineEnding !==
        carry.projection.nativeBinding.lineEnding ||
      next.nativeBinding.byteOrderMark !==
        carry.projection.nativeBinding.byteOrderMark ||
      next.nativeBinding.trailingNewline !==
        carry.projection.nativeBinding.trailingNewline ||
      next.nativeBinding.profile !== carry.projection.nativeBinding.profile
    ) {
      throw new CsvLensError(
        "CSV_DIALECT_READ_ONLY",
        "Spectra keeps this CSV file's delimiter, line endings, and encoding unchanged while editing cells.",
      );
    }
    if (
      next.table.rowCount < carry.projection.table.rowCount ||
      next.table.columnCount < carry.projection.table.columnCount
    ) {
      throw new CsvLensError(
        "CSV_POSITIONAL_SHIFT_REFUSED",
        "Removing CSV rows or columns would move cell addresses. Spectra refused to guess how those identities should shift.",
      );
    }
    if (JSON.stringify(next) === JSON.stringify(carry.projection)) {
      return carry.payload;
    }
    return encodeProjection(next);
  },

  async diffExternal(payloadA, payloadB): Promise<LensExternalDiff> {
    const [before, after, hashA, hashB] = await Promise.all([
      this.open(payloadA),
      this.open(payloadB),
      sha256Payload(payloadA),
      sha256Payload(payloadB),
    ]);
    const previous = new Map(
      before.projection.table.cells.map((cell) => [cell.ref, cell]),
    );
    const changes: LensExternalDiff["changes"] = [];
    for (const cell of after.projection.table.cells) {
      const old = previous.get(cell.ref);
      previous.delete(cell.ref);
      if (!old) {
        changes.push({ regionId: cell.id, kind: "insert", after: cell });
      } else if (old.value !== cell.value) {
        changes.push({
          regionId: cell.id,
          kind: "update",
          before: old,
          after: cell,
        });
      }
    }
    for (const cell of previous.values()) {
      changes.push({ regionId: cell.id, kind: "delete", before: cell });
    }
    return {
      changes,
      changedParts: hashA === hashB ? [] : ["csv:bytes"],
      preservedPartChanges: [],
    };
  },

  capabilities(profile) {
    return capabilities(profile);
  },
};
