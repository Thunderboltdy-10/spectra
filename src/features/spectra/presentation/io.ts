import { strFromU8, strToU8, zipSync } from "fflate";
import { OFFICE_ARCHIVE_LIMITS, readBoundedArchive } from "../../../../shared/parser-limits";
import {
  nativePresentationParagraph,
  normalizePresentationContent,
  normalizePresentationHyperlink,
  presentationObjectParagraphs,
  presentationObjectText,
  type PresentationChartContent,
  type PresentationContent,
  type PresentationObject,
  type PresentationSlide,
} from "./model";
import type { SpectraArtifactAsset } from "../data/api";
import { normalizeNativeFontFamily } from "../office-fonts";

export type PresentationFidelityEntry = {
  scope: string;
  level: "exact" | "adapted" | "unsupported";
  message: string;
};

export type PresentationImportedMedia = {
  archivePath: string;
  name: string;
  mediaType: string;
  bytes: Uint8Array;
};

export type PresentationImportResult = {
  format: "pptx" | "odp";
  content: PresentationContent;
  fidelityReport: PresentationFidelityEntry[];
  unsupportedFeatures: string[];
  media: PresentationImportedMedia[];
};

const MAX_ARCHIVE_FILES = 5_000;
const MAX_ARCHIVE_BYTES = 240_000_000;

function arrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function parseXml(bytes: Uint8Array, label: string) {
  const source = strFromU8(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(source))
    throw new Error(`${label} contains unsafe XML declarations.`);
  const document = new DOMParser().parseFromString(source, "application/xml");
  if (document.getElementsByTagName("parsererror").length)
    throw new Error(`${label} is not valid XML.`);
  return document;
}

async function archiveFrom(buffer: ArrayBuffer) {
  const checked = await readBoundedArchive(new Uint8Array(buffer), OFFICE_ARCHIVE_LIMITS);
  const files = Object.fromEntries(
    Object.entries(checked.entries).filter(([name]) => !name.endsWith("/")),
  );
  const entries = Object.entries(files);
  if (entries.length > MAX_ARCHIVE_FILES)
    throw new Error("The presentation archive contains too many files.");
  const bytes = entries.reduce(
    (total, [, value]) => total + value.byteLength,
    0,
  );
  if (bytes > MAX_ARCHIVE_BYTES)
    throw new Error("The expanded presentation exceeds the safe import limit.");
  return files;
}

function archivePath(base: string, target: string) {
  const directory = base.split("/").slice(0, -1);
  const parts = target.replaceAll("\\", "/").split("/");
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") directory.pop();
    else directory.push(part);
  }
  return directory.join("/");
}

function relationshipMap(files: Record<string, Uint8Array>, ownerPath: string) {
  const name = ownerPath.split("/").at(-1)!;
  const relationshipPath = `${ownerPath.split("/").slice(0, -1).join("/")}/_rels/${name}.rels`;
  const bytes = files[relationshipPath];
  const relationships = new Map<
    string,
    { path: string; type: string; external: boolean }
  >();
  if (!bytes) return relationships;
  const document = parseXml(bytes, relationshipPath);
  for (const node of Array.from(
    document.getElementsByTagName("Relationship"),
  )) {
    const id = node.getAttribute("Id");
    const target = node.getAttribute("Target");
    if (!id || !target) continue;
    relationships.set(id, {
      path: archivePath(ownerPath, target),
      type: node.getAttribute("Type") ?? "",
      external: node.getAttribute("TargetMode") === "External",
    });
  }
  return relationships;
}

function elements(parent: ParentNode, name: string) {
  return Array.from((parent as Document | Element).getElementsByTagName(name));
}

function numberAttribute(
  element: Element | undefined,
  name: string,
  fallback: number,
) {
  const value = Number(element?.getAttribute(name));
  return Number.isFinite(value) ? value : fallback;
}

function slideText(element: Element) {
  const paragraphs = elements(element, "a:p").map((paragraph) =>
    elements(paragraph, "a:t")
      .map((text) => text.textContent ?? "")
      .join(""),
  );
  return paragraphs.filter(Boolean).join("\n");
}

function pptxSlidePathsInPresentationOrder(
  files: Record<string, Uint8Array>,
  presentation: Document,
) {
  const available = Object.keys(files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/i.test(path))
    .sort((left, right) => {
      const a = Number(/slide(\d+)/i.exec(left)?.[1]);
      const b = Number(/slide(\d+)/i.exec(right)?.[1]);
      return a - b;
    });
  const availableSet = new Set(available);
  const relationships = relationshipMap(files, "ppt/presentation.xml");
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const slideId of elements(presentation, "p:sldId")) {
    const relationshipId = slideId.getAttribute("r:id");
    const path = relationshipId
      ? relationships.get(relationshipId)?.path
      : undefined;
    if (path && availableSet.has(path) && !seen.has(path)) {
      ordered.push(path);
      seen.add(path);
    }
  }
  return [
    ...ordered,
    ...available.filter((path) => !seen.has(path)),
  ];
}

function sceneBounds(
  element: Element,
  slideWidth: number,
  slideHeight: number,
  canvasHeight: number,
) {
  const transform = elements(element, "a:xfrm")[0];
  const offset = transform ? elements(transform, "a:off")[0] : undefined;
  const extent = transform ? elements(transform, "a:ext")[0] : undefined;
  const x =
    (numberAttribute(offset, "x", slideWidth * 0.1) / slideWidth) * 1_000;
  const y =
    (numberAttribute(offset, "y", slideHeight * 0.12) / slideHeight) *
    canvasHeight;
  const width =
    (numberAttribute(extent, "cx", slideWidth * 0.4) / slideWidth) * 1_000;
  const height =
    (numberAttribute(extent, "cy", slideHeight * 0.18) / slideHeight) *
    canvasHeight;
  return {
    x: Math.max(0, Math.min(990, x)),
    y: Math.max(0, Math.min(canvasHeight - 10, y)),
    width: Math.max(10, Math.min(1_000 - x, width)),
    height: Math.max(10, Math.min(canvasHeight - y, height)),
    rotation: numberAttribute(transform, "rot", 0) / 60_000,
  };
}

function mediaType(path: string) {
  const extension = path.split(".").at(-1)?.toLowerCase();
  return (
    {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      svg: "image/svg+xml",
      mp4: "video/mp4",
      webm: "video/webm",
      mov: "video/quicktime",
    }[extension ?? ""] ?? "application/octet-stream"
  );
}

function pptxMediaObject(
  picture: Element,
  slideIndex: number,
  objectIndex: number,
  relationships: ReturnType<typeof relationshipMap>,
  slideWidth: number,
  slideHeight: number,
  canvasHeight: number,
) {
  const blip = elements(picture, "a:blip")[0];
  const relationshipId =
    blip?.getAttribute("r:embed") ?? blip?.getAttribute("r:link");
  const relation = relationshipId
    ? relationships.get(relationshipId)
    : undefined;
  const type = relation?.path.match(/\.(?:mp4|webm|mov)$/i) ? "video" : "image";
  return {
    id: `slide-${slideIndex + 1}:media-${objectIndex + 1}`,
    type,
    ...sceneBounds(picture, slideWidth, slideHeight, canvasHeight),
    content: relation?.external
      ? { unavailableExternalMedia: relation.path }
      : { importMediaPath: relation?.path },
    altText: elements(picture, "p:cNvPr")[0]?.getAttribute("descr") ?? "",
    readingOrder: objectIndex,
  } satisfies PresentationObject;
}

function parsePptx(
  files: Record<string, Uint8Array>,
): PresentationImportResult {
  const presentationBytes = files["ppt/presentation.xml"];
  if (!presentationBytes)
    throw new Error(
      "This file does not contain a valid PowerPoint presentation.",
    );
  const presentation = parseXml(presentationBytes, "ppt/presentation.xml");
  const slideSize = elements(presentation, "p:sldSz")[0];
  const slideWidth = numberAttribute(slideSize, "cx", 12_192_000);
  const slideHeight = numberAttribute(slideSize, "cy", 6_858_000);
  const ratio = slideWidth / slideHeight;
  const aspectRatio = ratio < 1.55 ? "4:3" : "16:9";
  const canvasHeight = aspectRatio === "4:3" ? 750 : 562.5;
  const slidePaths = pptxSlidePathsInPresentationOrder(files, presentation);
  if (!slidePaths.length)
    throw new Error("The PowerPoint file contains no slides.");

  const importedMedia = new Map<string, PresentationImportedMedia>();
  const unsupported = new Set<string>();
  const fidelity: PresentationFidelityEntry[] = [
    {
      scope: "slides",
      level: "adapted",
      message: `${slidePaths.length} slides were converted into editable Spectra scene objects.`,
    },
  ];
  const slides: PresentationSlide[] = slidePaths.map((path, slideIndex) => {
    const document = parseXml(files[path]!, path);
    const relationships = relationshipMap(files, path);
    const objects: PresentationObject[] = [];
    for (const shape of elements(document, "p:sp")) {
      const objectIndex = objects.length;
      const content = slideText(shape);
      const preset = elements(shape, "a:prstGeom")[0]?.getAttribute("prst");
      const isText = Boolean(content);
      objects.push({
        id: `slide-${slideIndex + 1}:object-${objectIndex + 1}`,
        type: isText ? "text" : "shape",
        ...sceneBounds(shape, slideWidth, slideHeight, canvasHeight),
        content: isText
          ? { text: content }
          : { shape: preset || "rectangle", text: "" },
        style: isText
          ? {
              fontSize: Math.max(
                12,
                numberAttribute(elements(shape, "a:defRPr")[0], "sz", 2_600) /
                  100,
              ),
              fontWeight: elements(shape, "a:rPr").some(
                (node) => node.getAttribute("b") === "1",
              )
                ? 700
                : 400,
              color: "var(--text-primary)",
              align: "left",
            }
          : { fill: "var(--bg-secondary)", stroke: "var(--text-tertiary)", radius: 8 },
        readingOrder: objectIndex,
      });
    }
    for (const picture of elements(document, "p:pic")) {
      const object = pptxMediaObject(
        picture,
        slideIndex,
        objects.length,
        relationships,
        slideWidth,
        slideHeight,
        canvasHeight,
      );
      objects.push(object);
      const source = object.content as { importMediaPath?: string };
      if (source.importMediaPath && files[source.importMediaPath]) {
        importedMedia.set(source.importMediaPath, {
          archivePath: source.importMediaPath,
          name: source.importMediaPath.split("/").at(-1) ?? "media",
          mediaType: mediaType(source.importMediaPath),
          bytes: files[source.importMediaPath]!,
        });
      }
    }
    const graphicFrames = elements(document, "p:graphicFrame");
    if (graphicFrames.length) {
      unsupported.add("PowerPoint charts, SmartArt, and complex tables");
      graphicFrames.forEach((frame, index) =>
        objects.push({
          id: `slide-${slideIndex + 1}:graphic-${index + 1}`,
          type: "shape",
          ...sceneBounds(frame, slideWidth, slideHeight, canvasHeight),
          content: { text: "Imported graphic — replace or rebuild in Spectra" },
          style: { fill: "var(--bg-secondary)", stroke: "var(--border-strong)", radius: 10 },
          altText: "Unsupported PowerPoint graphic placeholder",
          readingOrder: objects.length,
        }),
      );
    }
    const externalLinks = [...relationships.values()].filter(
      (relation) => relation.external,
    );
    if (externalLinks.length) unsupported.add("Externally linked media");
    const notesRelation = [...relationships.values()].find((relation) =>
      relation.type.endsWith("/notesSlide"),
    );
    const notesBytes = notesRelation ? files[notesRelation.path] : undefined;
    const notes = notesBytes
      ? elements(parseXml(notesBytes, notesRelation!.path), "a:t")
          .map((node) => node.textContent ?? "")
          .filter((value) => value && !/^\d+$/.test(value))
          .join("\n")
      : "";
    const title =
      objects
        .filter((object) => object.type === "text")
        .map(presentationObjectText)
        .find(Boolean)
        ?.split("\n")[0]
        ?.slice(0, 300) ?? `Slide ${slideIndex + 1}`;
    return {
      id: `slide-${slideIndex + 1}`,
      title,
      objects,
      speakerNotes: notes,
      layoutId: "imported",
      transition: { kind: "none" },
      accessibility: {
        readingOrder: objects.map((object) => object.id),
      },
    };
  });
  if (importedMedia.size)
    fidelity.push({
      scope: "media",
      level: "exact",
      message: `${importedMedia.size} embedded media files were retained for native asset conversion.`,
    });
  const unsupportedFeatures = [...unsupported];
  unsupportedFeatures.forEach((feature) =>
    fidelity.push({
      scope: feature,
      level: "unsupported",
      message: `${feature} is retained in the original file and represented safely where possible.`,
    }),
  );
  return {
    format: "pptx",
    content: normalizePresentationContent({
      theme: { id: "pptx-import", name: "Imported PowerPoint" },
      slides,
      settings: { aspectRatio, showSlideNumbers: true },
    }),
    fidelityReport: fidelity,
    unsupportedFeatures,
    media: [...importedMedia.values()],
  };
}

function unit(value: string | null, fallback: number) {
  if (!value) return fallback;
  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount)) return fallback;
  if (value.endsWith("cm")) return amount / 2.54;
  if (value.endsWith("mm")) return amount / 25.4;
  if (value.endsWith("pt")) return amount / 72;
  if (value.endsWith("px")) return amount / 96;
  return amount;
}

function parseOdp(files: Record<string, Uint8Array>): PresentationImportResult {
  const contentBytes = files["content.xml"];
  if (!contentBytes)
    throw new Error(
      "This file does not contain a valid OpenDocument presentation.",
    );
  const document = parseXml(contentBytes, "content.xml");
  const pages = elements(document, "draw:page");
  if (!pages.length)
    throw new Error("The OpenDocument file contains no slides.");
  const media = new Map<string, PresentationImportedMedia>();
  const slides = pages.map((page, slideIndex) => {
    const objects: PresentationObject[] = [];
    for (const frame of elements(page, "draw:frame")) {
      const x = (unit(frame.getAttribute("svg:x"), 1) / 13.333) * 1_000;
      const y = (unit(frame.getAttribute("svg:y"), 1) / 7.5) * 562.5;
      const width = (unit(frame.getAttribute("svg:width"), 4) / 13.333) * 1_000;
      const height = (unit(frame.getAttribute("svg:height"), 2) / 7.5) * 562.5;
      const image = elements(frame, "draw:image")[0];
      const textBox = elements(frame, "draw:text-box")[0];
      const sourcePath = image
        ?.getAttribute("xlink:href")
        ?.replace(/^\.\//, "");
      const objectIndex = objects.length;
      if (image && sourcePath) {
        objects.push({
          id: `slide-${slideIndex + 1}:media-${objectIndex + 1}`,
          type: "image",
          x,
          y,
          width,
          height,
          rotation: 0,
          content: { importMediaPath: sourcePath },
          altText: frame.getAttribute("draw:name") ?? "",
          readingOrder: objectIndex,
        });
        if (files[sourcePath])
          media.set(sourcePath, {
            archivePath: sourcePath,
            name: sourcePath.split("/").at(-1) ?? "media",
            mediaType: mediaType(sourcePath),
            bytes: files[sourcePath]!,
          });
      } else if (textBox) {
        const content = elements(textBox, "text:p")
          .map((node) => node.textContent ?? "")
          .filter(Boolean)
          .join("\n");
        objects.push({
          id: `slide-${slideIndex + 1}:object-${objectIndex + 1}`,
          type: "text",
          x,
          y,
          width,
          height,
          rotation: 0,
          content: { text: content || "Imported text" },
          style: {
            fontSize: 28,
            fontWeight: objectIndex === 0 ? 650 : 400,
            color: "var(--text-primary)",
            align: "left",
          },
          readingOrder: objectIndex,
        });
      }
    }
    const title =
      objects.map(presentationObjectText).find(Boolean)?.split("\n")[0] ??
      page.getAttribute("draw:name") ??
      `Slide ${slideIndex + 1}`;
    return {
      id: `slide-${slideIndex + 1}`,
      title: title.slice(0, 300),
      objects,
      speakerNotes: "",
      layoutId: "imported",
      transition: { kind: "none" as const },
      accessibility: { readingOrder: objects.map((object) => object.id) },
    };
  });
  return {
    format: "odp",
    content: normalizePresentationContent({
      theme: { id: "odp-import", name: "Imported OpenDocument" },
      slides,
      settings: { aspectRatio: "16:9", showSlideNumbers: true },
    }),
    fidelityReport: [
      {
        scope: "slides and text",
        level: "adapted",
        message: `${slides.length} OpenDocument slides were converted into editable Spectra objects.`,
      },
      ...(media.size
        ? [
            {
              scope: "media",
              level: "exact" as const,
              message: `${media.size} embedded images were retained for native asset conversion.`,
            },
          ]
        : []),
      {
        scope: "advanced ODP effects",
        level: "unsupported",
        message:
          "Advanced master styling, transitions, and animations remain recoverable from the retained original.",
      },
    ],
    unsupportedFeatures: [
      "Advanced OpenDocument masters, transitions, and animations",
    ],
    media: [...media.values()],
  };
}

export async function importPresentationFile(
  file: File,
): Promise<PresentationImportResult> {
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  if (extension === "pptm" || extension === "ppsm")
    throw new Error(
      "Macro-enabled presentations are quarantined and cannot be converted in the browser.",
    );
  if (extension !== "pptx" && extension !== "odp")
    throw new Error("Choose a .pptx or .odp presentation export.");
  if (file.size > 80_000_000)
    throw new Error("Presentation imports cannot exceed 80 MB.");
  const files = await archiveFrom(await file.arrayBuffer());
  if (
    Object.keys(files).some((path) =>
      /(?:vbaProject\.bin|activeX|embeddings\/.+\.(?:exe|dll|js|vbs|cmd|bat))$/i.test(
        path,
      ),
    )
  )
    throw new Error(
      "The presentation contains executable or macro content and has been quarantined.",
    );
  return extension === "pptx" ? parsePptx(files) : parseOdp(files);
}

const PRESENTATION_EXPORT_COLORS: Record<string, string> = {
  "brand-primary": "6A4DE8",
  "brand-accent": "159B76",
  "bg-primary": "FBFAF8",
  "bg-secondary": "F6F4F0",
  "bg-tertiary": "EFEDE8",
  "bg-elevated": "FFFEFD",
  "text-primary": "211F1C",
  "text-secondary": "65615B",
  "text-tertiary": "716D67",
  "border-default": "E5E2DC",
  "border-strong": "D4D0C8",
  accent: "6A4DE8",
  "accent-coral": "EF684F",
  "accent-mint": "159B76",
};

function resolvedPresentationColor(value: string) {
  const trimmed = value.trim();
  const token = /^var\(--([\w-]+)\)$/.exec(trimmed);
  if (token) return PRESENTATION_EXPORT_COLORS[token[1] ?? ""];
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(trimmed);
  if (!match) return undefined;
  const digits = match[1]!;
  return digits.length === 3
    ? digits
        .split("")
        .map((digit) => `${digit}${digit}`)
        .join("")
        .toUpperCase()
    : digits.slice(0, 6).toUpperCase();
}

function hex(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  return resolvedPresentationColor(value) ?? fallback;
}

function presentationPaint(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  const resolved = resolvedPresentationColor(trimmed);
  if (resolved) return `#${resolved}`;
  if (/^(?:rgb|rgba|hsl|hsla|lab|oklab|color)\(/i.test(trimmed))
    return trimmed;
  return fallback;
}

async function dataUrl(url: string) {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error("A presentation asset could not be loaded.");
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(new Error("A presentation asset could not be read."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

function assetMap(assets: SpectraArtifactAsset[]) {
  return new Map(assets.map((asset) => [asset.assetId, asset]));
}

function chartContent(object: PresentationObject): PresentationChartContent {
  const source = (object.content && typeof object.content === "object"
    ? object.content
    : {}) as Record<string, unknown>;
  const legacyCategories = Array.isArray(source.labels)
    ? source.labels.map(String)
    : [];
  const legacyValues = Array.isArray(source.values)
    ? source.values.map(Number)
    : [];
  const categories = Array.isArray(source.categories)
    ? source.categories.map(String)
    : legacyCategories.length
      ? legacyCategories
      : ["A", "B", "C"];
  const series = Array.isArray(source.series)
    ? source.series.flatMap((candidate, index) => {
        if (!candidate || typeof candidate !== "object") return [];
        const row = candidate as Record<string, unknown>;
        const values = Array.isArray(row.values)
          ? row.values.map(Number).filter(Number.isFinite)
          : [];
        return [{
          id: typeof row.id === "string" ? row.id : undefined,
          name: typeof row.name === "string" ? row.name : `Series ${index + 1}`,
          categories: Array.isArray(row.categories)
            ? row.categories.map(String)
            : categories,
          values,
        }];
      })
    : [{ name: "Series 1", categories, values: legacyValues }];
  return {
    chartType:
      source.chartType === "column" ||
      source.chartType === "line" ||
      source.chartType === "pie" ||
      source.chartType === "area"
        ? source.chartType
        : "bar",
    ...(typeof source.title === "string" ? { title: source.title } : {}),
    categories,
    series: series.length
      ? series
      : [{ name: "Series 1", categories, values: [0] }],
    ...(typeof source.showLegend === "boolean"
      ? { showLegend: source.showLegend }
      : {}),
    ...(typeof source.axisTitle === "string"
      ? { axisTitle: source.axisTitle }
      : {}),
    ...(typeof source.valueAxisTitle === "string"
      ? { valueAxisTitle: source.valueAxisTitle }
      : {}),
  };
}

function pptxHyperlink(
  value: unknown,
  slideNumbers: ReadonlyMap<string, number>,
) {
  const hyperlink = normalizePresentationHyperlink(value);
  if (!hyperlink) return undefined;
  if (hyperlink.kind === "external") return { url: hyperlink.url };
  const slide = slideNumbers.get(hyperlink.slideId);
  if (!slide) throw new Error(`The internal presentation link target "${hyperlink.slideId}" does not exist.`);
  return { slide };
}

function presentationTextRuns(
  object: PresentationObject,
  content: PresentationContent,
  slideNumbers: ReadonlyMap<string, number>,
) {
  const fallbackFontSize = Number(object.style?.fontSize ?? 28);
  const fallbackFont = presentationNativeFontFamily(
    object.style?.fontFamily,
    content.theme.fonts,
    fallbackFontSize,
  );
  const fallbackColor = hex(object.style?.color, "23322D");
  const paragraphs = presentationObjectParagraphs(object);
  const runs: Array<{
    text: string;
    options?: {
      fontFace?: string;
      fontSize?: number;
      bold?: boolean;
      italic?: boolean;
      underline?: { style: "sng" };
      strike?: boolean;
      color?: string;
      hyperlink?: { url?: string; slide?: number };
      breakLine?: boolean;
      align?: "left" | "center" | "right" | "justify";
      bullet?: boolean | { type: "number" } | { characterCode: string };
      indentLevel?: number;
    };
  }> = [];
  paragraphs.forEach((source, paragraphIndex) => {
    // pptxgenjs writes a paragraph's properties with each of its runs and ends
    // the paragraph after a run marked `breakLine`, so every run carries its
    // paragraph's bullet, level and alignment, and the last one ends it.
    const paragraph = nativePresentationParagraph(source, "bullet");
    const shape = {
      ...(paragraph.alignment ? { align: paragraph.alignment } : {}),
      ...(source.checked !== undefined
        ? { bullet: { characterCode: source.checked ? "2611" : "2610" } }
        : paragraph.bullet === "numbered"
          ? { bullet: { type: "number" as const } }
          : paragraph.bullet === "bullet"
            ? { bullet: true }
            : {}),
      ...(paragraph.level ? { indentLevel: paragraph.level } : {}),
      ...(paragraphIndex < paragraphs.length - 1 ? { breakLine: true } : {}),
    };
    const last = paragraph.runs.length - 1;
    paragraph.runs.forEach((run, runIndex) => {
      const options: NonNullable<(typeof runs)[number]["options"]> = {
        fontFace: presentationNativeFontFamily(
          run.fontFamily ?? object.style?.fontFamily,
          content.theme.fonts,
          run.fontSizePt ?? fallbackFontSize,
        ),
        fontSize: run.fontSizePt ?? fallbackFontSize,
        bold: run.bold ?? Number(object.style?.fontWeight ?? 400) >= 600,
        italic: run.italic ?? Boolean(object.style?.italic),
        underline:
          run.underline ?? Boolean(object.style?.underline)
            ? { style: "sng" }
            : undefined,
        strike: run.strike ?? object.style?.textDecoration === "line-through",
        color: hex(run.color ?? object.style?.color, fallbackColor),
        ...(run.hyperlink || object.hyperlink
          ? { hyperlink: pptxHyperlink(run.hyperlink ?? object.hyperlink, slideNumbers) }
          : {}),
        ...shape,
        ...(runIndex < last ? { breakLine: false } : {}),
      };
      runs.push({ text: run.text, options });
    });
    // An empty paragraph is still a line.
    if (!paragraph.runs.length) runs.push({ text: "", options: shape });
  });
  return { runs, fallbackFont };
}

/**
 * Keep the selected object font in the same lane as the theme fallback. The
 * editor, canvas renderer, and PPTX writer all need the same answer or a font
 * choice can look correct in one representation and silently revert in the
 * next one.
 */
export function presentationFontFamily(
  value: unknown,
  fonts: PresentationContent["theme"]["fonts"] | undefined,
  fontSize: number,
) {
  if (typeof value === "string" && value.trim()) return value.trim();
  const themeFont = fontSize >= 44 ? fonts?.heading : fonts?.body;
  return themeFont?.trim() || "Manrope";
}

/** The native writer gets one concrete family; the browser keeps its CSS stack. */
export function presentationNativeFontFamily(
  value: unknown,
  fonts: PresentationContent["theme"]["fonts"] | undefined,
  fontSize: number,
) {
  return normalizeNativeFontFamily(
    presentationFontFamily(value, fonts, fontSize),
    fontSize >= 44 ? fonts?.heading ?? "Manrope" : fonts?.body ?? "Manrope",
  );
}

export async function buildPresentationPptx(
  content: PresentationContent,
  assets: SpectraArtifactAsset[],
) {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout =
    content.settings?.aspectRatio === "4:3" ? "LAYOUT_4X3" : "LAYOUT_WIDE";
  pptx.author = "Spectra";
  pptx.subject = "Spectra-native presentation export";
  const widthInches = content.settings?.aspectRatio === "4:3" ? 10 : 13.333;
  const heightInches = 7.5;
  const canvasHeight = content.settings?.aspectRatio === "4:3" ? 750 : 562.5;
  const byId = assetMap(assets);
  const slideNumbers = new Map(content.slides.map((slide, index) => [slide.id, index + 1] as const));
  // Image fetches used to happen inside the slide/object loop, so a deck with
  // several media objects paid the network and FileReader cost one at a time.
  // Resolve each referenced asset once before PptxGenJS starts building pages;
  // this keeps export ordering deterministic while allowing the browser to
  // overlap independent downloads.
  const imageAssetIds = new Set<string>();
  for (const slide of content.slides) {
    for (const object of slide.objects) {
      if (object.type !== "image") continue;
      const source = (object.content && typeof object.content === "object"
        ? object.content
        : {}) as { assetId?: unknown };
      if (typeof source.assetId === "string" && byId.get(source.assetId)?.downloadUrl)
        imageAssetIds.add(source.assetId);
    }
  }
  const assetDataUrls = new Map<string, string>();
  await Promise.all(
    [...imageAssetIds].map(async (assetId) => {
      const url = byId.get(assetId)?.downloadUrl;
      if (url) assetDataUrls.set(assetId, await dataUrl(url));
    }),
  );
  for (const slide of content.slides) {
    const page = pptx.addSlide();
    page.background = {
      color: hex(
        slide.background ?? content.theme.tokens?.background,
        "FBFAF5",
      ),
    };
    for (const object of [...slide.objects].sort(
      (left, right) => (left.readingOrder ?? 0) - (right.readingOrder ?? 0),
    )) {
      if (object.hidden) continue;
      const x = (object.x / 1_000) * widthInches;
      const y = (object.y / canvasHeight) * heightInches;
      const w = (object.width / 1_000) * widthInches;
      const h = (object.height / canvasHeight) * heightInches;
      const options = { x, y, w, h, rotate: object.rotation };
      if (object.type === "text") {
        const fontSize = Number(object.style?.fontSize ?? 28);
        const rich = presentationTextRuns(object, content, slideNumbers);
        page.addText(rich.runs.length ? rich.runs : presentationObjectText(object), {
          ...options,
          fontFace: presentationNativeFontFamily(
            object.style?.fontFamily,
            content.theme.fonts,
            fontSize,
          ),
          fontSize,
          bold: Number(object.style?.fontWeight ?? 400) >= 600,
          italic: Boolean(object.style?.italic),
          underline: object.style?.underline ? { style: "sng" } : undefined,
          color: hex(object.style?.color, "23322D"),
          align:
            object.style?.align === "center" || object.style?.align === "right"
              ? object.style.align
              : "left",
          breakLine: false,
          valign: "mid",
          margin: 0,
          fit: "shrink",
        });
      } else if (object.type === "shape") {
        page.addShape(Number(object.style?.cornerRadius ?? object.style?.radius ?? 8) > 0 ? pptx.ShapeType.roundRect : pptx.ShapeType.rect, {
          ...options,
          ...(object.hyperlink ? { hyperlink: pptxHyperlink(object.hyperlink, slideNumbers) } : {}),
          fill: { color: hex(object.style?.fill, "E4EEE8"), transparency: Math.round((1 - Number(object.style?.opacity ?? 1)) * 100) },
          line: { color: hex(object.style?.stroke, "8DA99A"), pt: Number(object.style?.strokeWidth ?? 1), transparency: Math.round((1 - Number(object.style?.opacity ?? 1)) * 100) },
        });
        if (presentationObjectText(object)) {
          const rich = presentationTextRuns(object, content, slideNumbers);
          page.addText(rich.runs.length ? rich.runs : presentationObjectText(object), {
            ...options,
            color: hex(object.style?.color, "23322D"),
            fontSize: Number(object.style?.fontSize ?? 18),
            align: "center",
            valign: "mid",
            margin: 0.05,
          });
        }
      } else if (object.type === "image") {
        const source = (object.content && typeof object.content === "object"
          ? object.content
          : {}) as { assetId?: string; crop?: { left?: number; top?: number; right?: number; bottom?: number } };
        const asset = source.assetId ? byId.get(source.assetId) : undefined;
        const imageData = source.assetId
          ? assetDataUrls.get(source.assetId)
          : undefined;
        if (asset?.downloadUrl && imageData)
          page.addImage({
            data: imageData,
            altText: object.altText,
            ...(object.hyperlink ? { hyperlink: pptxHyperlink(object.hyperlink, slideNumbers) } : {}),
            ...(object.style?.fit === "cover"
              ? { sizing: { type: "cover" as const, w, h } }
              : {}),
            ...options,
          });
      } else if (object.type === "table") {
        const rows = ((object.content as { rows?: unknown[][] }).rows ?? []).map((row) =>
          row.map((cell) => {
            if (!cell || typeof cell !== "object") return { text: String(cell ?? "") };
            const value = cell as { text?: unknown; style?: Record<string, unknown>; rowSpan?: number; colSpan?: number };
            const style = value.style ?? {};
            return {
              text: String(value.text ?? ""),
              options: {
                ...(typeof style.fill === "string" ? { fill: { color: hex(style.fill, "F7F8F5") } } : {}),
                ...(typeof style.color === "string" ? { color: hex(style.color, "23322D") } : {}),
                ...(typeof style.fontSizePt === "number" ? { fontSize: style.fontSizePt } : {}),
                ...(typeof style.bold === "boolean" ? { bold: style.bold } : {}),
                ...(typeof style.italic === "boolean" ? { italic: style.italic } : {}),
                ...(typeof value.rowSpan === "number" && value.rowSpan > 1 ? { rowspan: value.rowSpan } : {}),
                ...(typeof value.colSpan === "number" && value.colSpan > 1 ? { colspan: value.colSpan } : {}),
              },
            };
          }),
        );
        page.addTable(
          rows,
          {
            ...options,
            border: { color: "BAC5BF", pt: 0.7 },
            color: "23322D",
            fontSize: 12,
            fill: "F7F8F5",
            margin: 0.05,
          },
        );
      } else if (object.type === "chart") {
        const chart = chartContent(object);
        const type = chart.chartType === "line"
          ? pptx.ChartType.line
          : chart.chartType === "pie"
            ? pptx.ChartType.pie
            : chart.chartType === "area"
              ? pptx.ChartType.area
              : pptx.ChartType.bar;
        page.addChart(
          type,
          chart.series.map((series) => ({
            name: series.name,
            labels: series.categories.length ? series.categories : chart.categories,
            values: series.values,
          })),
          {
            ...options,
            showLegend: chart.showLegend !== false,
            showTitle: Boolean(chart.title),
            ...(chart.title ? { title: chart.title } : {}),
            ...(chart.chartType === "column" ? { barDir: "col" } : {}),
            ...(chart.axisTitle
              ? { catAxisTitle: chart.axisTitle, showCatAxisTitle: true }
              : {}),
            ...(chart.valueAxisTitle
              ? { valAxisTitle: chart.valueAxisTitle, showValAxisTitle: true }
              : {}),
            chartColors: [hex(content.theme.tokens?.accent, "2F9A72")],
          },
        );
      }
    }
    const citationRows = (slide.citations ?? []).flatMap((citation) => {
      const label = citation.label.trim();
      if (!label) return [];
      let url: string | undefined;
      try {
        const candidate = new URL(citation.url ?? "");
        if (["https:", "http:"].includes(candidate.protocol) && !candidate.username && !candidate.password)
          url = candidate.toString();
      } catch { /* Uploaded evidence need not have a public URL. */ }
      return [{ label, url }];
    });
    if (citationRows.length) {
      // Keep the original canvas editable and the source labels visible in
      // the copy. Full attributions also travel in notes without truncation.
      const fullLabel = citationRows.map((citation) => citation.label.replace(/\s+/g, " ")).join(" · ");
      const footer = fullLabel.length > 180 ? `${fullLabel.slice(0, 177)}…` : fullLabel;
      page.addText(footer, {
        x: 0.3, y: heightInches - 0.2, w: widthInches - 0.6, h: 0.15,
        fontSize: 8, fontFace: presentationNativeFontFamily(undefined, content.theme.fonts, 8),
        color: hex(content.theme.tokens?.body, "23322D"), margin: 0, fit: "shrink",
        ...(citationRows.length === 1 && citationRows[0]!.url ? { hyperlink: { url: citationRows[0]!.url } } : {}),
      });
    }
    const sourceNotes = citationRows.map((citation) => `${citation.label}${citation.url ? ` — ${citation.url}` : ""}`).join("\n");
    const notes = sourceNotes ? `${slide.speakerNotes ?? ""}${slide.speakerNotes ? "\n\n" : ""}Sources:\n${sourceNotes}` : slide.speakerNotes;
    if (notes) page.addNotes(notes);
  }
  const bytes = (await pptx.write({
    outputType: "arraybuffer",
  })) as ArrayBuffer;
  // PptxGenJS can reuse the same cNvPr id for sibling objects when several
  // object families are emitted on one slide. PowerPoint shape identity is
  // slide-scoped, so repair only duplicate ids before exposing the package to
  // the native lens. This keeps later edits pointed at the intended object.
  const { Presentation } = await import("@ariadng/office/pptx");
  const nativeDeck = await Presentation.open(new Uint8Array(bytes));
  for (const slide of nativeDeck.slides()) {
    const nodes: Array<{ getAttribute(name: string): string | undefined; setAttribute(name: string, value: string): void; namespaceUri(): string | null; localName: string }> = [];
    const pending = [...slide.root().elements()];
    while (pending.length) {
      const node = pending.pop()!;
      if (node.namespaceUri() === "http://schemas.openxmlformats.org/presentationml/2006/main" && node.localName === "cNvPr") nodes.push(node);
      pending.push(...node.elements());
    }
    const ids = nodes.map((node) => Number(node.getAttribute("id") ?? 0)).filter(Number.isFinite);
    const used = new Set<number>();
    let next = Math.max(1, ...ids) + 1;
    for (const node of nodes) {
      const id = Number(node.getAttribute("id") ?? 0);
      if (used.has(id)) {
        node.setAttribute("id", String(next));
        next += 1;
        nativeDeck.office.markDirty(slide.partName);
      } else used.add(id);
    }
  }
  const nativeBytes = await nativeDeck.save();
  return new Blob([nativeBytes.buffer as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });
}

function xmlEscape(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function buildPresentationOdp(content: PresentationContent) {
  const canvasHeight = content.settings?.aspectRatio === "4:3" ? 750 : 562.5;
  const width = content.settings?.aspectRatio === "4:3" ? 10 : 13.333;
  const pages = content.slides
    .map(
      (slide) =>
        `<draw:page draw:name="${xmlEscape(slide.title)}">${slide.objects
          .filter((object) => !object.hidden)
          .map((object) => {
            const x = (object.x / 1_000) * width;
            const y = (object.y / canvasHeight) * 7.5;
            const w = (object.width / 1_000) * width;
            const h = (object.height / canvasHeight) * 7.5;
            return `<draw:frame draw:name="${xmlEscape(object.id)}" svg:x="${x}in" svg:y="${y}in" svg:width="${w}in" svg:height="${h}in"><draw:text-box><text:p>${xmlEscape(presentationObjectText(object) || `[${object.type}]`)}</text:p></draw:text-box></draw:frame>`;
          })
          .join("")}</draw:page>`,
    )
    .join("");
  const contentXml = `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" office:version="1.3"><office:body><office:presentation>${pages}</office:presentation></office:body></office:document-content>`;
  const manifest = `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.presentation"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>`;
  const bytes = zipSync(
    {
      mimetype: [
        strToU8("application/vnd.oasis.opendocument.presentation"),
        { level: 0 },
      ],
      "content.xml": strToU8(contentXml),
      "META-INF/manifest.xml": strToU8(manifest),
    },
    { level: 6 },
  );
  return new Blob([arrayBuffer(bytes)], {
    type: "application/vnd.oasis.opendocument.presentation",
  });
}

async function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error("A presentation image could not be rendered."));
    image.src = url;
  });
}

export async function renderPresentationSlide(
  slide: PresentationSlide,
  content: PresentationContent,
  assets: SpectraArtifactAsset[],
  scale = 1.6,
) {
  const canvasHeight = content.settings?.aspectRatio === "4:3" ? 750 : 562.5;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(1_000 * scale);
  canvas.height = Math.round(canvasHeight * scale);
  const context = canvas.getContext("2d");
  if (!context)
    throw new Error("Canvas export is unavailable in this browser.");
  context.scale(scale, scale);
  context.fillStyle = presentationPaint(
    slide.background ?? content.theme.tokens?.background,
    "#FBFAF8",
  );
  context.fillRect(0, 0, 1_000, canvasHeight);
  const byId = assetMap(assets);
  for (const object of [...slide.objects].sort(
    (left, right) => (left.readingOrder ?? 0) - (right.readingOrder ?? 0),
  )) {
    if (object.hidden) continue;
    context.save();
    context.translate(
      object.x + object.width / 2,
      object.y + object.height / 2,
    );
    context.rotate((object.rotation * Math.PI) / 180);
    context.translate(-object.width / 2, -object.height / 2);
    if (object.type === "text") {
      const fontSize = Number(object.style?.fontSize ?? 32);
      const weight = Number(object.style?.fontWeight ?? 400);
      context.fillStyle = presentationPaint(
        object.style?.color,
        "#211F1C",
      );
      context.font = `${object.style?.italic ? "italic " : ""}${weight} ${fontSize}px ${presentationFontFamily(
        object.style?.fontFamily,
        content.theme.fonts,
        fontSize,
      )}`;
      context.textBaseline = "top";
      const lines = presentationObjectText(object).split("\n");
      lines.forEach((line, index) =>
        context.fillText(line, 0, index * fontSize * 1.15, object.width),
      );
    } else if (object.type === "shape") {
      context.fillStyle = presentationPaint(object.style?.fill, "#E4EEE8");
      context.strokeStyle = presentationPaint(
        object.style?.stroke,
        "#8DA99A",
      );
      context.lineWidth = 1;
      context.beginPath();
      context.roundRect(
        0,
        0,
        object.width,
        object.height,
        Number(object.style?.radius ?? 8),
      );
      context.fill();
      context.stroke();
    } else if (object.type === "image") {
      const source = object.content as { assetId?: string };
      const asset = source.assetId ? byId.get(source.assetId) : undefined;
      if (asset?.downloadUrl) {
        const image = await loadImage(asset.downloadUrl);
        context.drawImage(image, 0, 0, object.width, object.height);
      }
    } else if (object.type === "chart") {
      const values = Array.isArray(
        (object.content as { values?: unknown[] }).values,
      )
        ? (object.content as { values: unknown[] }).values.map(Number)
        : [62, 84, 48];
      const maximum = Math.max(1, ...values);
      context.fillStyle = presentationPaint(
        content.theme.tokens?.accent,
        "#2F9A72",
      );
      values.forEach((value, index) => {
        const barWidth = object.width / Math.max(values.length * 1.7, 1);
        const barHeight = (Math.max(0, value) / maximum) * object.height;
        context.fillRect(
          (index + 0.35) * (object.width / values.length),
          object.height - barHeight,
          barWidth,
          barHeight,
        );
      });
    } else {
      context.strokeStyle = "#a8ada8";
      context.strokeRect(0, 0, object.width, object.height);
      context.fillStyle = "#59615c";
      context.font = "16px sans-serif";
      context.fillText(`[${object.type}]`, 12, 12);
    }
    context.restore();
  }
  return canvas;
}

export async function buildPresentationPdf(
  content: PresentationContent,
  assets: SpectraArtifactAsset[],
) {
  const { jsPDF } = await import("jspdf");
  const canvasHeight = content.settings?.aspectRatio === "4:3" ? 750 : 562.5;
  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "pt",
    format: [1_000, canvasHeight],
    compress: true,
  });
  for (let index = 0; index < content.slides.length; index += 1) {
    if (index) pdf.addPage([1_000, canvasHeight], "landscape");
    const canvas = await renderPresentationSlide(
      content.slides[index]!,
      content,
      assets,
      1.5,
    );
    pdf.addImage(
      canvas.toDataURL("image/jpeg", 0.94),
      "JPEG",
      0,
      0,
      1_000,
      canvasHeight,
      undefined,
      "FAST",
    );
  }
  return pdf.output("blob");
}

export async function buildPresentationPngArchive(
  content: PresentationContent,
  assets: SpectraArtifactAsset[],
) {
  const files: Record<string, Uint8Array> = {};
  for (let index = 0; index < content.slides.length; index += 1) {
    const canvas = await renderPresentationSlide(
      content.slides[index]!,
      content,
      assets,
      2,
    );
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value
            ? resolve(value)
            : reject(new Error("Slide image export failed.")),
        "image/png",
      ),
    );
    files[`slide-${String(index + 1).padStart(3, "0")}.png`] = new Uint8Array(
      await blob.arrayBuffer(),
    );
  }
  return new Blob([arrayBuffer(zipSync(files, { level: 3 }))], {
    type: "application/zip",
  });
}
