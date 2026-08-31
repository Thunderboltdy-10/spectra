import type {
  PptxProjection,
  PptxSlideProjection,
  XlsxProjection,
  XlsxSheetProjection,
} from "./projection-contracts";
import { mergeThreeWay, type MergeConflict } from "./three-way-merge";

export type NativeConflictPreview = {
  regionId: string;
  spectra: string;
  external: string;
};

type ProjectionMerge<T> = {
  projection: T;
  conflicts: MergeConflict<unknown>[];
  spectraChanged: string[];
  externalChanged: string[];
  previews: NativeConflictPreview[];
};

const equal = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

function assertUnique<T>(values: readonly T[], id: (value: T) => string, label: string) {
  const seen = new Set<string>();
  for (const value of values) {
    const regionId = id(value);
    if (!regionId || seen.has(regionId))
      throw new Error(`${label} cannot be edited safely because its native identity is missing or ambiguous.`);
    seen.add(regionId);
  }
}

function short(value: unknown) {
  if (value === undefined) return "Deleted";
  if (value === null) return "Empty";
  if (typeof value === "string") return value.trim().slice(0, 160) || "Empty";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const text = JSON.stringify(value);
  return (text ?? "Changed").slice(0, 160);
}

function preview(conflict: MergeConflict<unknown>): NativeConflictPreview {
  return {
    regionId: conflict.id,
    spectra: short(conflict.ours),
    external: short(conflict.theirs),
  };
}

function changed<T>(base: T | undefined, value: T | undefined) {
  return !equal(base, value);
}

function resolveWhole<T>(
  regionId: string,
  base: T | undefined,
  ours: T | undefined,
  theirs: T | undefined,
  resolution?: "spectra" | "external",
) {
  const oursChanged = changed(base, ours);
  const theirsChanged = changed(base, theirs);
  if (oursChanged && theirsChanged && !equal(ours, theirs)) {
    const conflict = { id: regionId, base, ours, theirs } satisfies MergeConflict<T>;
    return {
      value: resolution === "spectra" ? ours : resolution === "external" ? theirs : undefined,
      conflict,
      oursChanged,
      theirsChanged,
    };
  }
  return {
    value: oursChanged ? ours : theirsChanged ? theirs : base,
    oursChanged,
    theirsChanged,
  };
}

function cellId(sheetId: string, ref: string) {
  return `${sheetId}:${ref.toUpperCase()}`;
}

export function xlsxChangedRegions(before: XlsxProjection, after: XlsxProjection) {
  const regions: string[] = [];
  const priorSheets = new Map(before.sheets.map((sheet) => [sheet.id, sheet]));
  for (const sheet of after.sheets) {
    const old = priorSheets.get(sheet.id);
    priorSheets.delete(sheet.id);
    if (!old) {
      regions.push(sheet.id, ...sheet.cells.map((cell) => cellId(sheet.id, cell.ref)));
      continue;
    }
    if (old.name !== sheet.name || !equal(old.merges, sheet.merges))
      regions.push(`${sheet.id}:structure`);
    const priorCells = new Map(old.cells.map((cell) => [cellId(sheet.id, cell.ref), cell]));
    for (const cell of sheet.cells) {
      const regionId = cellId(sheet.id, cell.ref);
      const previous = priorCells.get(regionId);
      priorCells.delete(regionId);
      if (!equal(previous, cell)) regions.push(regionId);
    }
    regions.push(...priorCells.keys());
  }
  regions.push(...priorSheets.keys());
  if (!equal(before.definedNames, after.definedNames)) regions.push("xlsx:defined-names");
  return [...new Set(regions)];
}

function mergeSheet(
  base: XlsxSheetProjection,
  ours: XlsxSheetProjection,
  theirs: XlsxSheetProjection,
  resolution?: "spectra" | "external",
) {
  const metadata = mergeThreeWay({
    base: [{ id: `${base.id}:structure`, name: base.name, merges: base.merges }],
    ours: [{ id: `${ours.id}:structure`, name: ours.name, merges: ours.merges }],
    theirs: [{ id: `${theirs.id}:structure`, name: theirs.name, merges: theirs.merges }],
    id: (value) => value.id,
    mergeOrder: false,
    conflictResolution: resolution === "spectra" ? "ours" : resolution === "external" ? "theirs" : undefined,
  });
  const cells = mergeThreeWay({
    base: base.cells,
    ours: ours.cells,
    theirs: theirs.cells,
    id: (cell) => cellId(base.id, cell.ref),
    mergeOrder: false,
    conflictResolution: resolution === "spectra" ? "ours" : resolution === "external" ? "theirs" : undefined,
  });
  const structure = metadata.value[0] ?? { name: theirs.name, merges: theirs.merges };
  return {
    sheet: { ...theirs, name: structure.name, merges: structure.merges, cells: cells.value },
    conflicts: [...metadata.conflicts, ...cells.conflicts] as MergeConflict<unknown>[],
    spectraChanged: [...metadata.changedByOurs, ...cells.changedByOurs],
    externalChanged: [...metadata.changedByTheirs, ...cells.changedByTheirs],
  };
}

export function mergeXlsxProjections(
  base: XlsxProjection,
  ours: XlsxProjection,
  theirs: XlsxProjection,
  resolution?: "spectra" | "external",
): ProjectionMerge<XlsxProjection> {
  for (const projection of [base, ours, theirs]) {
    assertUnique(projection.sheets, (sheet) => sheet.id, "An Excel worksheet");
    for (const sheet of projection.sheets)
      assertUnique(sheet.cells, (cell) => cellId(sheet.id, cell.ref), `Worksheet ${sheet.name}`);
  }
  const baseById = new Map(base.sheets.map((sheet) => [sheet.id, sheet]));
  const oursById = new Map(ours.sheets.map((sheet) => [sheet.id, sheet]));
  const theirsById = new Map(theirs.sheets.map((sheet) => [sheet.id, sheet]));
  const order = mergeThreeWay({
    base: base.sheets,
    ours: ours.sheets,
    theirs: theirs.sheets,
    id: (sheet) => sheet.id,
    equal: (left, right) => left?.id === right?.id,
    orderId: "xlsx:sheet-order",
    conflictResolution: resolution === "spectra" ? "ours" : resolution === "external" ? "theirs" : undefined,
  });
  const conflicts: MergeConflict<unknown>[] = [...order.conflicts];
  const spectraChanged = [...order.changedByOurs];
  const externalChanged = [...order.changedByTheirs];
  const mergedById = new Map<string, XlsxSheetProjection>();
  const ids = new Set([...baseById.keys(), ...oursById.keys(), ...theirsById.keys()]);
  for (const sheetId of ids) {
    const ancestor = baseById.get(sheetId);
    const current = oursById.get(sheetId);
    const external = theirsById.get(sheetId);
    if (!ancestor || !current || !external) {
      const whole = resolveWhole(sheetId, ancestor, current, external, resolution);
      if (whole.conflict) conflicts.push(whole.conflict);
      if (whole.oursChanged) spectraChanged.push(sheetId);
      if (whole.theirsChanged) externalChanged.push(sheetId);
      if (whole.value) mergedById.set(sheetId, whole.value);
      continue;
    }
    const merged = mergeSheet(ancestor, current, external, resolution);
    mergedById.set(sheetId, merged.sheet);
    conflicts.push(...merged.conflicts);
    spectraChanged.push(...merged.spectraChanged);
    externalChanged.push(...merged.externalChanged);
  }
  const orderIds = order.value.map((sheet) => sheet.id);
  const sheets = [
    ...orderIds.flatMap((sheetId) => mergedById.get(sheetId) ? [mergedById.get(sheetId)!] : []),
    ...[...mergedById].flatMap(([sheetId, sheet]) => orderIds.includes(sheetId) ? [] : [sheet]),
  ];
  const names = resolveWhole("xlsx:defined-names", base.definedNames, ours.definedNames, theirs.definedNames, resolution);
  if (names.conflict) conflicts.push(names.conflict);
  if (names.oursChanged) spectraChanged.push("xlsx:defined-names");
  if (names.theirsChanged) externalChanged.push("xlsx:defined-names");
  return {
    projection: { ...theirs, sheets, definedNames: names.value ?? theirs.definedNames },
    conflicts,
    spectraChanged: [...new Set(spectraChanged)],
    externalChanged: [...new Set(externalChanged)],
    previews: conflicts.map(preview),
  };
}

function objectText(value: PptxSlideProjection["objects"][number] | undefined) {
  if (!value) return value;
  const content = value.content as { text?: unknown } | string;
  return typeof content === "string" ? content : typeof content?.text === "string" ? content.text : value;
}

function slideText(objects: PptxSlideProjection["objects"]) {
  return objects
    .filter((object) => object.type === "text")
    .map((object) => objectText(object))
    .filter((value): value is string => typeof value === "string");
}

function mergeSlide(
  base: PptxSlideProjection,
  ours: PptxSlideProjection,
  theirs: PptxSlideProjection,
  resolution?: "spectra" | "external",
) {
  const scalar = <T>(suffix: string, ancestor: T, current: T, external: T) =>
    resolveWhole(`${base.id}:${suffix}`, ancestor, current, external, resolution);
  const title = scalar("title", base.title, ours.title, theirs.title);
  const notes = scalar("notes", base.speakerNotes, ours.speakerNotes, theirs.speakerNotes);
  const hidden = scalar(
    "hidden",
    Boolean(base.hidden),
    Boolean(ours.hidden),
    Boolean(theirs.hidden),
  );
  const structure = scalar(
    "structure",
    { layoutPartName: base.layoutPartName, hasTransition: base.hasTransition, hasTiming: base.hasTiming, notesPartName: base.notesPartName },
    { layoutPartName: ours.layoutPartName, hasTransition: ours.hasTransition, hasTiming: ours.hasTiming, notesPartName: ours.notesPartName },
    { layoutPartName: theirs.layoutPartName, hasTransition: theirs.hasTransition, hasTiming: theirs.hasTiming, notesPartName: theirs.notesPartName },
  );
  const objects = mergeThreeWay({
    base: base.objects,
    ours: ours.objects,
    theirs: theirs.objects,
    id: (object) => object.id,
    orderId: `${base.id}:object-order`,
    conflictResolution: resolution === "spectra" ? "ours" : resolution === "external" ? "theirs" : undefined,
  });
  const conflicts: MergeConflict<unknown>[] = [];
  if (title.conflict) conflicts.push(title.conflict);
  if (notes.conflict) conflicts.push(notes.conflict);
  if (hidden.conflict) conflicts.push(hidden.conflict);
  if (structure.conflict) conflicts.push(structure.conflict);
  conflicts.push(...objects.conflicts);
  const mergedStructure = structure.value ?? {
    layoutPartName: theirs.layoutPartName,
    hasTransition: theirs.hasTransition,
    hasTiming: theirs.hasTiming,
    notesPartName: theirs.notesPartName,
  };
  return {
    slide: {
      ...theirs,
      ...mergedStructure,
      title: title.value ?? "",
      hidden: hidden.value === true || undefined,
      speakerNotes: notes.value ?? "",
      objects: objects.value,
      text: [title.value ?? "", ...slideText(objects.value)].filter(Boolean),
    },
    conflicts,
    spectraChanged: [
      ...(title.oursChanged ? [`${base.id}:title`] : []),
      ...(notes.oursChanged ? [`${base.id}:notes`] : []),
      ...(hidden.oursChanged ? [`${base.id}:hidden`] : []),
      ...(structure.oursChanged ? [`${base.id}:structure`] : []),
      ...objects.changedByOurs,
    ],
    externalChanged: [
      ...(title.theirsChanged ? [`${base.id}:title`] : []),
      ...(notes.theirsChanged ? [`${base.id}:notes`] : []),
      ...(hidden.theirsChanged ? [`${base.id}:hidden`] : []),
      ...(structure.theirsChanged ? [`${base.id}:structure`] : []),
      ...objects.changedByTheirs,
    ],
  };
}

export function pptxChangedRegions(before: PptxProjection, after: PptxProjection) {
  return mergePptxProjections(before, before, after).externalChanged;
}

export function mergePptxProjections(
  base: PptxProjection,
  ours: PptxProjection,
  theirs: PptxProjection,
  resolution?: "spectra" | "external",
): ProjectionMerge<PptxProjection> {
  for (const projection of [base, ours, theirs]) {
    assertUnique(projection.slides, (slide) => slide.id, "A PowerPoint slide");
    for (const slide of projection.slides)
      assertUnique(slide.objects, (object) => object.id, `Slide ${slide.index + 1}`);
  }
  const baseById = new Map(base.slides.map((slide) => [slide.id, slide]));
  const oursById = new Map(ours.slides.map((slide) => [slide.id, slide]));
  const theirsById = new Map(theirs.slides.map((slide) => [slide.id, slide]));
  const order = mergeThreeWay({
    base: base.slides,
    ours: ours.slides,
    theirs: theirs.slides,
    id: (slide) => slide.id,
    equal: (left, right) => left?.id === right?.id,
    orderId: "pptx:slide-order",
    conflictResolution: resolution === "spectra" ? "ours" : resolution === "external" ? "theirs" : undefined,
  });
  const conflicts: MergeConflict<unknown>[] = [...order.conflicts];
  const spectraChanged = [...order.changedByOurs];
  const externalChanged = [...order.changedByTheirs];
  const mergedById = new Map<string, PptxSlideProjection>();
  const ids = new Set([...baseById.keys(), ...oursById.keys(), ...theirsById.keys()]);
  for (const slideId of ids) {
    const ancestor = baseById.get(slideId);
    const current = oursById.get(slideId);
    const external = theirsById.get(slideId);
    if (!ancestor || !current || !external) {
      const whole = resolveWhole(slideId, ancestor, current, external, resolution);
      if (whole.conflict) conflicts.push(whole.conflict);
      if (whole.oursChanged) spectraChanged.push(slideId);
      if (whole.theirsChanged) externalChanged.push(slideId);
      if (whole.value) mergedById.set(slideId, whole.value);
      continue;
    }
    const merged = mergeSlide(ancestor, current, external, resolution);
    mergedById.set(slideId, merged.slide);
    conflicts.push(...merged.conflicts);
    spectraChanged.push(...merged.spectraChanged);
    externalChanged.push(...merged.externalChanged);
  }
  const orderIds = order.value.map((slide) => slide.id);
  const slides = [
    ...orderIds.flatMap((slideId) => mergedById.get(slideId) ? [mergedById.get(slideId)!] : []),
    ...[...mergedById].flatMap(([slideId, slide]) => orderIds.includes(slideId) ? [] : [slide]),
  ].map((slide, index) => ({ ...slide, index }));
  return {
    projection: { ...theirs, slides },
    conflicts,
    spectraChanged: [...new Set(spectraChanged)],
    externalChanged: [...new Set(externalChanged)],
    previews: conflicts.map((conflict) => ({
      regionId: conflict.id,
      spectra: short(conflict.ours),
      external: short(conflict.theirs),
    })),
  };
}
