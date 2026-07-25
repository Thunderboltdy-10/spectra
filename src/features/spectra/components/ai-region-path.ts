/** Bidirectional JSON Pointer matching for AI collaborator region highlights. */

const COLLECTION_KEYS: Record<string, readonly string[]> = {
  document: ["blocks"],
  flashcard_deck: ["cards"],
  quiz: ["questions"],
  presentation: ["slides"],
  code: ["files"],
  whiteboard: ["nodes", "edges"],
  timetable: ["events"],
  planner_task: ["subtasks"],
  sheets: ["sheets"],
  agent: ["profile"],
};

const SHEETS_CELL_CAP = 128;

export function normalizeAiPointer(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "";
  if (trimmed === "/") return "/";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function pathTouches(paths: readonly string[], target: string): boolean {
  if (!paths.length) return false;
  const normalizedTarget = normalizeAiPointer(target);
  if (!normalizedTarget) return false;
  if (paths.some((path) => normalizeAiPointer(path) === "/")) return true;
  return paths.some((path) => {
    const normalized = normalizeAiPointer(path);
    if (!normalized) return false;
    return (
      normalized === normalizedTarget ||
      normalized.startsWith(`${normalizedTarget}/`) ||
      (normalized !== "/" && normalizedTarget.startsWith(`${normalized}/`))
    );
  });
}

export function aiRegionAttr(active: boolean): true | undefined {
  return active || undefined;
}

function encodePointerSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

function decodePointerSegment(segment: string): string {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

/**
 * Expand RFC 6901 `-` append pointers against post-patch content so studios
 * can light the newly added index (`/questions/-` → `/questions/10`).
 */
export function expandAppendPointer(
  path: string,
  content: unknown,
): string {
  const normalized = normalizeAiPointer(path);
  if (!normalized || normalized === "/" || !normalized.includes("/-"))
    return normalized;
  if (!content || typeof content !== "object") return normalized;

  const rawSegments = normalized
    .slice(1)
    .split("/")
    .map(decodePointerSegment);
  const resolved: string[] = [];
  let cursor: unknown = content;

  for (const segment of rawSegments) {
    if (segment === "-" && Array.isArray(cursor)) {
      // Preview/content is already patched when changedPaths are published.
      const index = cursor.length > 0 ? cursor.length - 1 : 0;
      resolved.push(String(index));
      cursor = cursor[index];
      continue;
    }
    resolved.push(encodePointerSegment(segment));
    if (cursor == null || typeof cursor !== "object") {
      cursor = undefined;
      continue;
    }
    if (Array.isArray(cursor)) {
      const index = Number(segment);
      cursor =
        Number.isInteger(index) && index >= 0 && index < cursor.length
          ? cursor[index]
          : undefined;
    } else {
      cursor = (cursor as Record<string, unknown>)[segment];
    }
  }

  return `/${resolved.join("/")}`;
}

function columnIndexFromAddress(address: string): number | null {
  const match = /^([A-Z]+)([1-9][0-9]*)$/i.exec(address.trim());
  if (!match) return null;
  const letters = match[1]!.toUpperCase();
  let total = 0;
  for (const character of letters) {
    total = total * 26 + character.charCodeAt(0) - 64;
  }
  return total - 1;
}

/** Concrete cell pointers for sheets content (capped; never emits bare `/`). */
export function sheetsCellHighlightPaths(
  content: unknown,
  scopePath?: string,
  cap = SHEETS_CELL_CAP,
): string[] {
  if (!content || typeof content !== "object") return [];
  const sheets = (content as { sheets?: unknown }).sheets;
  if (!Array.isArray(sheets) || sheets.length === 0) return [];

  const scope = scopePath ? normalizeAiPointer(scopePath) : "";
  const sheetOnly = /^\/sheets\/(\d+)(?:\/cells)?$/.exec(scope);
  const onlyIndex = sheetOnly ? Number(sheetOnly[1]) : null;
  const paths: string[] = [];

  for (let sheetIndex = 0; sheetIndex < sheets.length; sheetIndex += 1) {
    if (onlyIndex !== null && sheetIndex !== onlyIndex) continue;
    if (
      scope &&
      scope !== "/" &&
      onlyIndex === null &&
      !scope.startsWith(`/sheets/${sheetIndex}`)
    )
      continue;

    const sheet = sheets[sheetIndex];
    if (!sheet || typeof sheet !== "object") continue;
    const cells = (sheet as { cells?: unknown }).cells;
    if (!cells || typeof cells !== "object" || Array.isArray(cells)) continue;

    for (const address of Object.keys(cells as Record<string, unknown>).sort()) {
      const normalizedAddress = address.trim().toUpperCase() || address;
      paths.push(
        `/sheets/${sheetIndex}/cells/${encodePointerSegment(normalizedAddress)}`,
      );
      if (paths.length >= cap) return paths;
    }
  }
  return paths;
}

/**
 * Turn coarse/append pointers into studio-matchable paths.
 * Sheets: replace `/`, `/sheets/N`, and lagging `/sheets/N/cells` with concrete
 * cell pointers when content already has addresses (no whole-grid invent after
 * settle — callers clear paths). Authored map-merge patches should still prefer
 * `highlightPathsFromContentPatchChanges` so only touched addresses light.
 */
export function materializeAiChangedPaths(
  paths: readonly string[] | null | undefined,
  content: unknown,
  blueprintKey?: string,
): string[] {
  const incoming = [
    ...new Set(
      (paths ?? [])
        .map(normalizeAiPointer)
        .filter((path) => path.length > 0),
    ),
  ];
  if (!incoming.length) return [];

  const out = new Set<string>();
  for (const path of incoming) {
    if (blueprintKey === "sheets") {
      if (
        path === "/" ||
        /^\/sheets\/\d+$/.test(path) ||
        /^\/sheets\/\d+\/cells$/.test(path)
      ) {
        const cells = sheetsCellHighlightPaths(content, path);
        if (cells.length > 0) {
          for (const cellPath of cells) out.add(cellPath);
          continue;
        }
        // Content has not formed cells yet — keep the coarse prefix so
        // sheetsAiTouchesCell can path-prefix light once cells appear.
        if (/^\/sheets\/\d+(?:\/cells)?$/.test(path)) {
          out.add(path);
          continue;
        }
      }
    }

    const expanded = expandAppendPointer(path, content);
    if (blueprintKey === "sheets") {
      const cellMatch = /^(\/sheets\/\d+\/cells\/)([^/]+)(.*)$/.exec(
        expanded || path,
      );
      if (cellMatch) {
        out.add(
          `${cellMatch[1]}${encodePointerSegment(cellMatch[2]!.toUpperCase())}${cellMatch[3]}`,
        );
        continue;
      }
    }
    out.add(expanded || path);
  }
  return [...out];
}

/**
 * Build highlight paths from contentPatch changes. Expands sheets cells-map
 * merges to the authored cell addresses so column appends do not flood the grid.
 */
export function highlightPathsFromContentPatchChanges(
  changes: readonly { path: string; value?: unknown }[] | null | undefined,
  content: unknown,
  blueprintKey?: string,
): string[] {
  if (!changes?.length) return [];
  const collected: string[] = [];
  for (const change of changes) {
    const path = normalizeAiPointer(change.path);
    if (!path) continue;
    const cellsMap = /^\/sheets\/(\d+)\/cells$/.exec(path);
    if (
      blueprintKey === "sheets" &&
      cellsMap &&
      change.value &&
      typeof change.value === "object" &&
      !Array.isArray(change.value)
    ) {
      const sheetIndex = Number(cellsMap[1]);
      for (const address of Object.keys(
        change.value as Record<string, unknown>,
      )) {
        const normalizedAddress = address.trim().toUpperCase();
        if (!normalizedAddress) continue;
        collected.push(
          `/sheets/${sheetIndex}/cells/${encodePointerSegment(normalizedAddress)}`,
        );
      }
      continue;
    }
    collected.push(path);
  }
  return materializeAiChangedPaths(collected, content, blueprintKey);
}

/**
 * Cell lighting for sheets studios: exact/descendant cell pointers, plus
 * mid-stream path-prefix `/sheets/N/cells` when exact addresses still lag.
 * Never floods from bare `/` or `/sheets/N` (those must be materialized first).
 * Column identity pointers light every cell in that column.
 */
export function sheetsAiTouchesCell(
  paths: readonly string[],
  sheetIndex: number,
  address: string,
): boolean {
  if (!paths.length) return false;
  const encoded = encodePointerSegment(address);
  const cellPath = `/sheets/${sheetIndex}/cells/${encoded}`;
  const cellsPrefix = `/sheets/${sheetIndex}/cells`;
  const column = columnIndexFromAddress(address);

  return paths.some((path) => {
    const normalized = normalizeAiPointer(path);
    if (!normalized || normalized === "/") return false;
    if (normalized === `/sheets/${sheetIndex}`) return false;
    // Coarse cells-map pointer: light every cell on the sheet until exact
    // addresses arrive (path-prefix mid-stream). Exact cell paths win once
    // published because callers replace the coarse path.
    if (normalized === cellsPrefix) return true;
    if (
      normalized === cellPath ||
      normalized.startsWith(`${cellPath}/`) ||
      cellPath.startsWith(`${normalized}/`)
    )
      return true;
    if (column === null) return false;
    const columnPath = `/sheets/${sheetIndex}/columnIdentities/${column}`;
    return (
      normalized === columnPath ||
      normalized.startsWith(`${columnPath}/`) ||
      pathTouches([normalized], columnPath)
    );
  });
}

/** Column-header lighting for sheets (identity path or any cell in column). */
export function sheetsAiTouchesColumn(
  paths: readonly string[],
  sheetIndex: number,
  column: number,
): boolean {
  if (!paths.length) return false;
  const usable = paths.filter((path) => {
    const normalized = normalizeAiPointer(path);
    return (
      Boolean(normalized) &&
      normalized !== "/" &&
      normalized !== `/sheets/${sheetIndex}` &&
      normalized !== `/sheets/${sheetIndex}/cells`
    );
  });
  if (!usable.length) return false;
  const columnPath = `/sheets/${sheetIndex}/columnIdentities/${column}`;
  if (pathTouches(usable, columnPath)) return true;
  const prefix = `/sheets/${sheetIndex}/cells/`;
  return usable.some((path) => {
    const normalized = normalizeAiPointer(path);
    if (!normalized.startsWith(prefix)) return false;
    const address = decodePointerSegment(
      normalized.slice(prefix.length).split("/")[0] ?? "",
    );
    return columnIndexFromAddress(address) === column;
  });
}

/**
 * Whole-artifact creates and focused updates often stream before per-region
 * patches. Prefer concrete preview/effect paths; otherwise fall back so
 * mid-open / mid-edit studios still light `data-ai-region` (except sheets cell
 * grids, which need cell or `/sheets/N/cells` prefix paths).
 *
 * When a creation/catch-up fallback includes `/`, union it with concrete paths so
 * page/layer-only region pointers cannot suppress node/slide lighting.
 * Focused-update callers should only pass `/` while concrete paths are still
 * empty — once exact paths arrive, do not keep a sticky whole-artifact `/`.
 */
export function resolveAiHighlightPaths(input: {
  previewPaths?: readonly string[] | null;
  effectChangedPaths?: readonly string[] | null;
  effectRegionPointers?: readonly string[] | null;
  creationFallbackPaths?: readonly string[] | null;
  contentDerivedPaths?: readonly string[] | null;
}): string[] {
  const concrete = [
    ...new Set(
      [
        ...(input.previewPaths ?? []),
        ...(input.effectChangedPaths ?? []),
        ...(input.effectRegionPointers ?? []),
      ]
        .map(normalizeAiPointer)
        .filter((path) => path.length > 0),
    ),
  ];
  const fallback = [
    ...new Set(
      (input.creationFallbackPaths ?? [])
        .map(normalizeAiPointer)
        .filter((path) => path.length > 0),
    ),
  ];
  const derived = [
    ...new Set(
      (input.contentDerivedPaths ?? [])
        .map(normalizeAiPointer)
        .filter((path) => path.length > 0),
    ),
  ];

  if (concrete.length === 0) {
    if (fallback.length > 0) {
      return fallback.includes("/") && derived.length > 0
        ? [...new Set([...fallback, ...derived])]
        : fallback;
    }
    return derived;
  }

  // Creating/catch-up fallback `/` must stay present so collection items light
  // even when only structural region pointers (pages/layers/settings) arrived.
  if (fallback.includes("/")) {
    return [...new Set([...concrete, "/", ...derived])];
  }

  // Mid-open creates / mid-edit updates: if concrete paths miss every on-screen
  // collection item, still light what the user can see.
  if (derived.length > 0) {
    const touchesDerived = derived.some((path) => pathTouches(concrete, path));
    if (!touchesDerived) return [...new Set([...concrete, ...derived])];
  }

  return concrete;
}

/** Creation fallback when the run has not yet published concrete changedPaths. */
export function creationHighlightFallbackPaths(
  aiState: string | undefined,
  blueprintKey: string | undefined,
): string[] {
  if (aiState !== "creating") return [];
  // Sheets cell grids flood when matched via parent `/` or `/sheets/N`.
  if (blueprintKey === "sheets") return [];
  return ["/"];
}

/**
 * Focused-update fallback `/` only while concrete region paths are still empty.
 * Once exact paths stream in, drop the whole-artifact fallback so settle clears
 * cleanly without inventing permanent highlights.
 */
export function updatingHighlightFallbackPaths(
  aiState: string | undefined,
  blueprintKey: string | undefined,
  hasConcretePaths: boolean,
): string[] {
  if (aiState !== "updating" || hasConcretePaths) return [];
  // Sheets stay cell / cells-prefix exact — never whole-artifact `/`.
  if (blueprintKey === "sheets") return [];
  return ["/"];
}

/**
 * Expand on-screen collections into JSON pointers so studios can light formed
 * items even when the run only advertised `/` or structural regions.
 */
export function contentDerivedHighlightPaths(
  blueprintKey: string | undefined,
  content: unknown,
): string[] {
  if (!blueprintKey || !content || typeof content !== "object") return [];
  if (blueprintKey === "sheets") return sheetsCellHighlightPaths(content);
  const keys = COLLECTION_KEYS[blueprintKey];
  if (!keys?.length) return [];
  const record = content as Record<string, unknown>;
  const paths: string[] = [];
  for (const key of keys) {
    const rows = record[key];
    if (key === "profile") {
      if (rows && typeof rows === "object" && Object.keys(rows).length > 0) {
        paths.push("/profile");
      }
      continue;
    }
    if (!Array.isArray(rows) || rows.length === 0) continue;
    for (let index = 0; index < rows.length; index += 1) {
      paths.push(`/${key}/${index}`);
    }
  }
  return paths;
}

function primaryCollectionSize(blueprintKey: string, content: unknown): number {
  if (!content || typeof content !== "object") return 0;
  if (blueprintKey === "sheets") {
    const sheets = (content as { sheets?: unknown }).sheets;
    if (!Array.isArray(sheets)) return 0;
    return sheets.reduce((total, sheet) => {
      if (!sheet || typeof sheet !== "object") return total;
      const cells = (sheet as { cells?: unknown }).cells;
      if (!cells || typeof cells !== "object" || Array.isArray(cells))
        return total;
      return total + Object.keys(cells as Record<string, unknown>).length;
    }, 0);
  }
  const keys = COLLECTION_KEYS[blueprintKey];
  if (!keys?.length) {
    try {
      return JSON.stringify(content).length > 2 ? 1 : 0;
    } catch {
      return 0;
    }
  }
  const record = content as Record<string, unknown>;
  return keys.reduce((total, key) => {
    const rows = record[key];
    if (key === "profile") {
      return (
        total +
        (rows && typeof rows === "object" && Object.keys(rows).length > 0
          ? 1
          : 0)
      );
    }
    return total + (Array.isArray(rows) ? rows.length : 0);
  }, 0);
}

function stableContentScore(value: unknown): number {
  try {
    return JSON.stringify(value ?? null).length;
  } catch {
    return 0;
  }
}

/**
 * Prefer live Yjs content over a lagging Convex aiPreview during streaming so
 * mid-open studios never regress to empty placeholders while AI writes.
 * Returns which source to feed into mergeAiRegions / the editor.
 */
export function preferStreamingContentSource(input: {
  local: unknown;
  preview: unknown;
  blueprintKey: string;
  aiState: string | undefined;
}): "local" | "preview" {
  const { local, preview, blueprintKey, aiState } = input;
  if (preview === undefined) return "local";
  if (aiState !== "creating" && aiState !== "updating") return "preview";
  const localSize = primaryCollectionSize(blueprintKey, local);
  const previewSize = primaryCollectionSize(blueprintKey, preview);
  if (localSize > previewSize) return "local";
  if (previewSize > localSize) return "preview";
  return stableContentScore(local) >= stableContentScore(preview)
    ? "local"
    : "preview";
}
