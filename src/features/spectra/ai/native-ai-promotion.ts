import type { Id } from "../../../../convex/_generated/dataModel";
import type * as Y from "yjs";
import { materializeDocxArtifact } from "@/app/api/spectra/lenses/docx/route";
import { materializeOfficeArtifact } from "@/app/api/spectra/lenses/office/route";
import type { ArtifactLiveValue } from "@/features/spectra/collaboration/artifact-yjs-model";

/**
 * Keep Spectra's collaborative document authoritative while Bridge catches up.
 * The materialization mutation records a durable, revisioned write request and
 * projects its target into the cloud artifact before this function returns.
 * Bridge then retries that request independently of the browser session.
 */
export const NATIVE_PROMOTION_MODE = "immediate-projection" as const;

const DOCX_FORMATS = new Set(["docx", "docm", "dotx", "dotm"]);
const OFFICE_FORMATS = new Set([
  "xlsx",
  "xlsm",
  "xltx",
  "xltm",
  "xlam",
  "pptx",
  "pptm",
  "potx",
  "potm",
]);

export type NativeMaterializeResult = {
  state: string;
  requestId?: string;
  hash?: string;
  status?: string;
  /** Canonical content read back from the native payload that will be written. */
  projectionContent?: unknown;
  conflict?: { message?: string };
};

export type NativePromotionDeps = {
  materializeDocx?: (
    workId: Id<"spectraArtifacts">,
    content: unknown,
    options?: { promotionMode?: "immediate-projection" },
  ) => Promise<NativeMaterializeResult>;
  materializeOffice?: (
    workId: Id<"spectraArtifacts">,
    content: unknown,
    options?: { promotionMode?: "immediate-projection" },
  ) => Promise<NativeMaterializeResult>;
};

function promotionError(code: string, detail: string) {
  return new Error(`${code}: ${detail}`);
}

export function isNativeContentRegion(regionId: string) {
  return !regionId.startsWith("metadata:");
}

export function linkedOfficeKind(nativeFormat: string | undefined) {
  const format = nativeFormat?.toLowerCase();
  if (!format) return null;
  if (DOCX_FORMATS.has(format)) return "docx" as const;
  if (OFFICE_FORMATS.has(format)) return "office" as const;
  return null;
}

/**
 * `beforeCommit` must persist the native outbox entry and its cloud projection,
 * but it no longer waits for local Office bytes. Once that durable intent is
 * accepted, apply the same content to Yjs so closing or refreshing the browser
 * cannot leave a later Bridge retry detached from the live document.
 */
export async function commitAiYjsAfterNativeQueue(params: {
  document: Y.Doc;
  apply: () => void;
  origin: Record<string, unknown>;
  desired: ArtifactLiveValue;
  changedRegionIds: string[];
  beforeCommit?: (info: {
    desired: ArtifactLiveValue;
    changedRegionIds: string[];
  }) => Promise<void>;
}) {
  await params.beforeCommit?.({
    desired: params.desired,
    changedRegionIds: params.changedRegionIds,
  });
  params.document.transact(params.apply, params.origin);
}

/** Persist the native save intent, then let Yjs commit without waiting on Office. */
export async function promoteNativeAiContent(params: {
  workId: string;
  blueprintKey: string;
  nativeFormat: string;
  content: unknown;
  deps?: NativePromotionDeps;
}) {
  const kind = linkedOfficeKind(params.nativeFormat);
  if (!kind) {
    throw promotionError(
      "NATIVE_PROMOTION_REFUSED",
      "This file is not a linked Office original, so Spectra will not pretend a native write succeeded.",
    );
  }
  const materializeDocx =
    params.deps?.materializeDocx ?? materializeDocxArtifact;
  const materializeOffice =
    params.deps?.materializeOffice ?? materializeOfficeArtifact;
  const options = { promotionMode: NATIVE_PROMOTION_MODE };
  const queued =
    kind === "docx"
      ? await materializeDocx(
          params.workId as Id<"spectraArtifacts">,
          params.content,
          options,
        )
      : await materializeOffice(
          params.workId as Id<"spectraArtifacts">,
          params.content,
          options,
        );

  switch (queued.state) {
    case "pending":
    case "claimed":
    case "verified":
    case "cloud_saved":
    case "deferred_native":
      // A pending request is already durable in Convex. Bridge owns its bounded
      // retry schedule; this browser run must not cancel it on disconnect.
      return queued;
    case "unchanged":
      // A semantic edit can normalize to the bytes already in Office (for
      // example, removing an editor-only empty paragraph). Commit it to Yjs
      // only when the materializer supplies the canonical projection it read
      // back from those unchanged bytes.
      if (queued.projectionContent !== undefined) return queued;
      throw promotionError(
        "NATIVE_PROMOTION_UNCHANGED",
        "The original file did not receive that change, so Spectra did not keep it in the live document.",
      );
    case "conflicted":
      throw promotionError(
        "NATIVE_PROMOTION_CONFLICT",
        queued.conflict?.message || "Both copies changed. Nothing overwritten.",
      );
    case "protected-pending":
      throw promotionError(
        "NATIVE_PROMOTION_PROTECTED",
        "Spectra can read this original but will not change it.",
      );
    case "failed":
      throw promotionError(
        "NATIVE_PROMOTION_FAILED",
        queued.status || "The original file did not accept that change.",
      );
    default:
      throw promotionError(
        "NATIVE_PROMOTION_REFUSED",
        "Spectra could not record a durable save for the original file, so the collaborative document was left unchanged.",
      );
  }
}
