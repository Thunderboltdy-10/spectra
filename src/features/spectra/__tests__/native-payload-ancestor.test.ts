import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { Id } from "../../../../convex/_generated/dataModel";
const calls = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/convex-server", () => ({ convexQuery: calls.query, convexMutation: vi.fn() }));
import { fetchStoredNativeBase, type NativePayloadTruth } from "../lenses/native-payload-server";

const bytes = (text: string) => new TextEncoder().encode(text);
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const workId = "work" as Id<"spectraArtifacts">;
const truth = (base?: string) => ({ hash: hash("B"), baseRevision: base,
  projectionBaseRevision: undefined } as NativePayloadTruth);
beforeEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe("exact retained native ancestor", () => {
  it("loads A when the initial upload records baseRevision A and cloud fallback is C", async () => {
    calls.query.mockResolvedValue({ url: "https://fixture.invalid/A", hash: hash("A"), bytes: 1 });
    const fetch = vi.fn().mockResolvedValue(new Response(bytes("A")));
    vi.stubGlobal("fetch", fetch);
    expect(await fetchStoredNativeBase(workId, truth(hash("A")), bytes("C"))).toEqual(bytes("A"));
    expect(calls.query).toHaveBeenCalledWith("payloads:get", { workId, hash: hash("A") });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("uses fallback only when its verified bytes equal the recorded ancestor", async () => {
    expect(await fetchStoredNativeBase(workId, truth(hash("A")), bytes("A"))).toEqual(bytes("A"));
    expect(calls.query).not.toHaveBeenCalled();
  });
  it("does not substitute cloud bytes when no native ancestor was recorded", async () => {
    await expect(fetchStoredNativeBase(workId, truth(), bytes("C"))).rejects.toThrow("EXTERNAL_NATIVE_BASE_UNAVAILABLE");
    expect(calls.query).not.toHaveBeenCalled();
  });
});
