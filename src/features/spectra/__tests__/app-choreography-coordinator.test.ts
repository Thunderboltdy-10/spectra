import { describe, expect, it } from "vitest";
import { AppChoreographyCoordinator } from "../collaboration/app-choreography";

describe("application choreography coordinator", () => {
  it("preserves a blocked head when its actor queues another action or cancels an unrelated action", () => {
    const coordinator = new AppChoreographyCoordinator();
    const request = { target: "library" as const, targetKey: "folder-a", summary: "Rename" };
    coordinator.enqueue({ ...request, actorId: "a", operationId: "a1" });
    const waiting = coordinator.enqueue({ ...request, actorId: "b", operationId: "b1" });
    const next = coordinator.enqueue({ ...request, targetKey: "folder-b", actorId: "b", operationId: "b2" });
    coordinator.cancel("b", "missing");
    expect(waiting.status).toBe("blocked");
    expect(next.status).toBe("queued");
    expect(coordinator.snapshot().map((entry) => entry.operationId)).toEqual(["a1", "b1", "b2"]);
    coordinator.complete("a", "a1");
    expect(waiting.status).toBe("performing");
    expect(next.status).toBe("queued");
    coordinator.complete("b", "b1");
    expect(next.status).toBe("performing");
  });

  it("deduplicates only the same in-flight actor and operation, without retargeting it", () => {
    const coordinator = new AppChoreographyCoordinator();
    const request = { actorId: "a", operationId: "1", target: "library" as const, targetKey: "folder", summary: "Rename" };
    const first = coordinator.enqueue(request);
    expect(coordinator.enqueue(request)).toBe(first);
    expect(() => coordinator.enqueue({ ...request, targetKey: "other" })).toThrow(/cannot change/);
    expect(coordinator.enqueue({ ...request, actorId: "b" }).status).toBe("blocked");
    expect(coordinator.snapshot()).toHaveLength(2);
  });

  it("releases a failed performance without completing it or losing the waiting action", () => {
    const coordinator = new AppChoreographyCoordinator();
    const request = { actorId: "a", target: "calendar" as const, targetKey: "block", summary: "Move" };
    const failed = coordinator.enqueue({ ...request, operationId: "1" });
    const next = coordinator.enqueue({ ...request, operationId: "2" });
    expect(coordinator.fail("a", "1", "Control unmounted")).toBe(true);
    expect(failed).toMatchObject({ status: "failed", reason: "Control unmounted" });
    expect(next.status).toBe("performing");
    expect(coordinator.complete("a", "1")).toBe(false);
  });

  it("expires even an action without a control key, and renews only real current progress", () => {
    let now = 0;
    const coordinator = new AppChoreographyCoordinator({ now: () => now, claimTtlMs: 1000 });
    const request = { actorId: "a", target: "school" as const, summary: "Open course" };
    const first = coordinator.enqueue({ ...request, operationId: "1" });
    const next = coordinator.enqueue({ ...request, operationId: "2" });
    now = 900;
    expect(coordinator.renewClaim("a", "2")).toBe(false);
    expect(coordinator.renewClaim("a", "1")).toBe(true);
    now = 1500;
    expect(coordinator.expireClaims()).toBe(0);
    now = 1901;
    expect(coordinator.expireClaims()).toBe(1);
    expect(first.status).toBe("cancelled");
    expect(next.status).toBe("performing");
    expect(coordinator.complete("a", "1")).toBe(false);
  });

  it("keeps independent actor queues active in parallel", () => {
    const coordinator = new AppChoreographyCoordinator();
    const first = coordinator.enqueue({ actorId: "ai-a", operationId: "a-1", target: "library", targetKey: "folder-a", summary: "Move A" });
    const second = coordinator.enqueue({ actorId: "ai-b", operationId: "b-1", target: "settings", targetKey: "toolbar", summary: "Change toolbar" });
    expect(first.status).toBe("performing");
    expect(second.status).toBe("performing");
  });

  it("blocks a same-target collision and resumes after release", () => {
    const coordinator = new AppChoreographyCoordinator();
    const first = coordinator.enqueue({ actorId: "ai-a", operationId: "a-1", target: "library", targetKey: "folder-a", summary: "Rename" });
    const second = coordinator.enqueue({ actorId: "ai-b", operationId: "b-1", target: "library", targetKey: "folder-a", summary: "Move" });
    expect(first.status).toBe("performing");
    expect(second.status).toBe("blocked");
    expect(coordinator.complete("ai-a", "a-1")).toBe(true);
    expect(coordinator.snapshot()).toContainEqual(expect.objectContaining({ operationId: "b-1", status: "performing" }));
  });

  it("cancelling an actor releases its claim and queued work", () => {
    const coordinator = new AppChoreographyCoordinator();
    coordinator.enqueue({ actorId: "ai-a", operationId: "a-1", target: "calendar", targetKey: "block", summary: "Move" });
    coordinator.enqueue({ actorId: "ai-b", operationId: "b-1", target: "calendar", targetKey: "block", summary: "Resize" });
    expect(coordinator.cancel("ai-a")).toBe(1);
    expect(coordinator.snapshot()).toContainEqual(expect.objectContaining({ operationId: "b-1", status: "performing" }));
  });

  it("expires a stale claim so the waiter can perform", () => {
    let now = 0;
    const coordinator = new AppChoreographyCoordinator({
      now: () => now,
      claimTtlMs: 1_000,
    });
    coordinator.enqueue({
      actorId: "ai-a",
      operationId: "a-1",
      target: "library",
      targetKey: "folder-a",
      summary: "Rename",
    });
    coordinator.enqueue({
      actorId: "ai-b",
      operationId: "b-1",
      target: "library",
      targetKey: "folder-a",
      summary: "Move",
    });
    expect(
      coordinator.snapshot().find((entry) => entry.operationId === "b-1")
        ?.status,
    ).toBe("blocked");
    now = 1_001;
    expect(coordinator.expireClaims()).toBe(1);
    expect(coordinator.snapshot()).toContainEqual(
      expect.objectContaining({ operationId: "b-1", status: "performing" }),
    );
  });
});
