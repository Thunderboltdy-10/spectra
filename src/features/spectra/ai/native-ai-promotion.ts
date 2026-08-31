import * as Y from "yjs";
import type { Id } from "../../../../convex/_generated/dataModel";
import { materializeDocxArtifact } from "@/app/api/spectra/lenses/docx/route";
import { materializeOfficeArtifact } from "@/app/api/spectra/lenses/office/route";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import type { ArtifactLiveValue } from "@/features/spectra/collaboration/artifact-yjs-model";

export const NATIVE_PROMOTION_MODE = "verified-first" as const;

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

const WAIT_MS = 45_000;
const POLL_MS = 150;

export type NativeMaterializeResult = {
  state: string;
  requestId?: string;
  hash?: string;
  status?: string;
  conflict?: { message?: string };
};

export type NativePromotionDeps = {
  materializeDocx?: (
    workId: Id<"spectraArtifacts">,
    content: unknown,
    options?: { promotionMode?: "verified-first" },
  ) => Promise<NativeMaterializeResult>;
  materializeOffice?: (
    workId: Id<"spectraArtifacts">,
    content: unknown,
    options?: { promotionMode?: "verified-first" },
  ) => Promise<NativeMaterializeResult>;
  query?: <TArgs extends object, TResult>(
    name: string,
    args: TArgs,
  ) => Promise<TResult>;
  mutate?: <TArgs extends object, TResult>(
    name: string,
    args: TArgs,
  ) => Promise<TResult>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

type MaterializationStatus = {
  requestId: string;
  state: "pending" | "claimed" | "verified" | "failed" | "conflicted";
  errorCode?: string;
  errorMessage?: string;
};

function abortError(signal?: AbortSignal) {
  if (!signal?.aborted) return null;
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The AI run was stopped.", "AbortError");
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

function promotionError(code: string, detail: string) {
  return new Error(`${code}: ${detail}`);
}

/**
 * Native bytes must be verified before the shared Yjs apply. Callers pass the
 * final rebased desired value; a thrown refusal leaves the document untouched.
 */
export async function commitAiYjsAfterNativePromotion(params: {
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

export async function promoteNativeAiContent(params: {
  workId: string;
  blueprintKey: string;
  nativeFormat: string;
  content: unknown;
  signal?: AbortSignal;
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
  const query = params.deps?.query ?? convexQuery;
  const mutate = params.deps?.mutate ?? convexMutation;
  const sleep =
    params.deps?.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = params.deps?.now ?? Date.now;
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
  return waitForVerifiedPromotion({
    queued,
    signal: params.signal,
    query,
    mutate,
    sleep,
    now,
  });
}

async function waitForVerifiedPromotion(params: {
  queued: NativeMaterializeResult;
  signal?: AbortSignal;
  query: NonNullable<NativePromotionDeps["query"]>;
  mutate: NonNullable<NativePromotionDeps["mutate"]>;
  sleep: NonNullable<NativePromotionDeps["sleep"]>;
  now: NonNullable<NativePromotionDeps["now"]>;
}) {
  const { queued } = params;
  if (queued.state === "verified") return queued;
  if (queued.state === "unchanged") {
    throw promotionError(
      "NATIVE_PROMOTION_UNCHANGED",
      "The original file did not receive that change, so Spectra did not keep it in the live document.",
    );
  }
  if (queued.state === "cloud_saved") {
    throw promotionError(
      "NATIVE_PROMOTION_CLOUD_ONLY",
      "This file lives on your PC. Connect Spectra Bridge on that computer to apply the change to the original.",
    );
  }
  if (queued.state === "protected-pending") {
    throw promotionError(
      "NATIVE_PROMOTION_PROTECTED",
      "Spectra can read this original but will not change it.",
    );
  }
  if (queued.state === "conflicted") {
    throw promotionError(
      "NATIVE_PROMOTION_CONFLICT",
      queued.conflict?.message || "Both copies changed. Nothing overwritten.",
    );
  }
  if (queued.state === "failed") {
    throw promotionError(
      "NATIVE_PROMOTION_FAILED",
      queued.status || "The original file did not accept that change.",
    );
  }
  const requestId = queued.requestId;
  if (!requestId || requestId === "protected-original") {
    throw promotionError(
      "NATIVE_PROMOTION_REFUSED",
      "Spectra could not verify the original file, so the live document was left unchanged.",
    );
  }
  let deadline = params.now() + WAIT_MS;
  let extendedForClaim = false;
  while (params.now() < deadline) {
    const aborted = abortError(params.signal);
    const status = await params.query<
      { requestId: string },
      MaterializationStatus
    >("replicas:materializationStatus", { requestId });
    if (status.state === "verified") return { ...queued, state: "verified" };
    if (status.state === "failed" || status.state === "conflicted") {
      throw promotionError(
        status.state === "conflicted"
          ? "NATIVE_PROMOTION_CONFLICT"
          : "NATIVE_PROMOTION_FAILED",
        status.errorMessage ||
          "The original file did not accept that change, so Spectra did not keep it in the live document.",
      );
    }
    if (status.state === "claimed" && !extendedForClaim) {
      deadline = params.now() + WAIT_MS;
      extendedForClaim = true;
    }
    if (aborted) {
      if (status.state === "pending") {
        await params
          .mutate<
            { requestId: string },
            { cancelled: boolean; state: string }
          >("replicas:cancelMaterialization", { requestId })
          .catch(() => null);
        throw aborted;
      }
    }
    await params.sleep(POLL_MS);
  }
  throw promotionError(
    "NATIVE_PROMOTION_FAILED",
    "Spectra timed out waiting to verify the original file, so the live document was left unchanged.",
  );
}
