import { describe, expect, it } from "vitest";
import { AppChoreographyCoordinator } from "../collaboration/app-choreography";

describe("application choreography coordinator", () => {
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
});
