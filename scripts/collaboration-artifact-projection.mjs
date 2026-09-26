/** Pure canonical room projection. Shared by the gateway and retained-pin proof. */
import { nativeArtifactProjection } from "./collaboration-native-projection.mjs";

const META_MAP = "spectra:artifact-meta";
const REGION_MAP = "spectra:artifact-regions";
const REGION_MARKER = "$spectraRegion";
const CODE_LINES_MARKER = "$spectraCodeLines";

function expandProjection(value, regions, active = new Set()) {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof value[REGION_MARKER] === "string"
  ) {
    const regionId = value[REGION_MARKER];
    if (active.has(regionId)) throw new Error("COLLABORATION_PROJECTION_CYCLE");
    const encoded = regions.get(regionId);
    if (typeof encoded !== "string")
      throw new Error("COLLABORATION_PROJECTION_REGION_MISSING");
    const nextActive = new Set(active);
    nextActive.add(regionId);
    return expandProjection(JSON.parse(encoded).value, regions, nextActive);
  }
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    Array.isArray(value[CODE_LINES_MARKER]) &&
    value[CODE_LINES_MARKER].every((regionId) => typeof regionId === "string")
  ) {
    return value[CODE_LINES_MARKER].map((regionId) => {
      if (active.has(regionId))
        throw new Error("COLLABORATION_PROJECTION_CYCLE");
      const encoded = regions.get(regionId);
      if (typeof encoded !== "string")
        throw new Error("COLLABORATION_PROJECTION_REGION_MISSING");
      const nextActive = new Set(active);
      nextActive.add(regionId);
      const line = expandProjection(
        JSON.parse(encoded).value,
        regions,
        nextActive,
      );
      return typeof line === "string" ? line : String(line ?? "");
    }).join("\n");
  }
  if (Array.isArray(value))
    return value.map((entry) => expandProjection(entry, regions, active));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        expandProjection(entry, regions, active),
      ]),
    );
  return value;
}

function assertSharedTimetableProjection(content) {
  if (!content || typeof content !== "object" || Array.isArray(content))
    throw new Error("COLLABORATION_TIMETABLE_PROJECTION_INVALID");
  for (const forbidden of ["view", "availability", "preferences"])
    if (Object.prototype.hasOwnProperty.call(content, forbidden))
      throw new Error("COLLABORATION_TIMETABLE_PERSONAL_STATE_FORBIDDEN");
  const layers = Array.isArray(content.layers) ? content.layers : [];
  for (const layer of layers) {
    if (!layer || typeof layer !== "object" || Array.isArray(layer))
      throw new Error("COLLABORATION_TIMETABLE_PROJECTION_INVALID");
    const authority =
      typeof layer.authority === "string" ? layer.authority : undefined;
    if (
      layer.private === true ||
      authority === "user" ||
      ((layer.kind === "personal" || layer.kind === "study") &&
        authority !== "workspace" &&
        authority !== "school" &&
        authority !== "external")
    )
      throw new Error("COLLABORATION_TIMETABLE_PERSONAL_LAYER_FORBIDDEN");
  }
  const sharedLayerIds = new Set(
    layers.flatMap((layer) => (typeof layer.id === "string" ? [layer.id] : [])),
  );
  const events = Array.isArray(content.events) ? content.events : [];
  for (const event of events) {
    if (
      !event ||
      typeof event !== "object" ||
      Array.isArray(event) ||
      Object.prototype.hasOwnProperty.call(event, "overlay") ||
      typeof event.layerId !== "string" ||
      !sharedLayerIds.has(event.layerId)
    )
      throw new Error("COLLABORATION_TIMETABLE_PERSONAL_EVENT_FORBIDDEN");
  }
}

export function artifactProjection(document, fallbackSchemaVersion) {
  const nativeProjection = nativeArtifactProjection(
    document,
    fallbackSchemaVersion,
  );
  if (nativeProjection) {
    if (nativeProjection.typeKey === "timetable")
      assertSharedTimetableProjection(nativeProjection.content);
    // Size gates live in planProjectionStorage (spill) or Convex parse
    // (fail-closed). Returning the string here keeps spill reachable.
    return JSON.stringify(nativeProjection);
  }
  const metadata = document.getMap(META_MAP);
  if (metadata.get("initialized") !== true) return null;
  const rootTemplate = metadata.get("rootTemplate");
  const title = metadata.get("title");
  const summary = metadata.get("summary");
  const tags = metadata.get("tags");
  const typeKey = metadata.get("typeKey");
  const schemaVersion = metadata.get("schemaVersion");
  if (
    typeof rootTemplate !== "string" ||
    typeof title !== "string" ||
    typeof typeKey !== "string" ||
    typeof schemaVersion !== "number" ||
    !Array.isArray(tags) ||
    !tags.every((tag) => typeof tag === "string")
  )
    throw new Error("COLLABORATION_PROJECTION_INVALID");
  const content = expandProjection(
    JSON.parse(rootTemplate),
    document.getMap(REGION_MAP),
  );
  if (typeKey === "timetable") assertSharedTimetableProjection(content);
  const projection = JSON.stringify({
    title,
    summary: typeof summary === "string" && summary ? summary : undefined,
    tags,
    typeKey,
    schemaVersion,
    content,
  });
  // Do not null oversize here — callers spill via planProjectionStorage or
  // Convex rejects inline writes fail-closed.
  return projection;
}
