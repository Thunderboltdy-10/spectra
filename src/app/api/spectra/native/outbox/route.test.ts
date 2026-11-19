import { beforeEach, describe, expect, it, vi } from "vitest";

const verify = vi.fn();
const asOwner = vi.fn(async (_clerkId: string, task: () => Promise<unknown>) => task());
const docxPost = vi.fn();
const officePost = vi.fn();

vi.mock("@/lib/scheduled-callback", () => ({ verifyScheduledCallback: verify, asOwner }));
vi.mock("../../lenses/docx/route", () => ({ POST: docxPost }));
vi.mock("../../lenses/office/route", () => ({ POST: officePost }));

const { POST } = await import("./route");

const send = (body: unknown) => POST(new Request("https://spectra.test/api/spectra/native/outbox", {
  method: "POST", body: JSON.stringify(body),
}));

describe("native outbox route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verify.mockReturnValue(true);
  });

  it("refuses an unsigned call before doing anything", async () => {
    verify.mockReturnValue(false);
    const response = await send({ workId: "w", action: "materialize", route: "docx", clerkId: "c" });
    expect(response.status).toBe(403);
    expect(asOwner).not.toHaveBeenCalled();
  });

  it("runs the lens route as the owner with the same request a studio sends", async () => {
    docxPost.mockResolvedValue(Response.json({ state: "pending" }));
    const response = await send({ workId: "w1", action: "materialize", route: "docx", clerkId: "clerk_1" });
    expect(await response.json()).toEqual({ state: "pending" });
    expect(asOwner).toHaveBeenCalledWith("clerk_1", expect.any(Function));
    const request = docxPost.mock.calls[0]![0] as Request;
    expect(await request.json()).toEqual({ action: "materialize", artifactId: "w1" });
    expect(officePost).not.toHaveBeenCalled();
  });

  it("answers refusals and missing sessions as errors the outbox can read", async () => {
    officePost.mockResolvedValue(Response.json({ error: "OFFICE_LENS_FAILED", message: "NATIVE_WRITES_DISABLED" }, { status: 400 }));
    const refused = await send({ workId: "w2", action: "reconcile", route: "office", clerkId: "c" });
    expect(refused.status).toBe(200);
    expect(await refused.json()).toEqual({ error: "OFFICE_LENS_FAILED: NATIVE_WRITES_DISABLED" });
    asOwner.mockRejectedValueOnce(new Error("The owner has no active session for this scheduled run."));
    const signedOut = await send({ workId: "w2", action: "reconcile", route: "office", clerkId: "c" });
    expect(await signedOut.json()).toEqual({ error: "OWNER_SESSION_UNAVAILABLE" });
    expect(await (await send({ workId: "w2", action: "delete", route: "office", clerkId: "c" })).json())
      .toEqual({ error: "OUTBOX_REQUEST_INVALID" });
  });
});
