import { describe, expect, it } from "vitest";
import { AiDurableAckGate } from "../ai/ai-durable-ack";

describe("AI durable acknowledgement", () => {
  it("stays dirty after transport-clean until the matching pending/ack cycle", () => {
    const gate = new AiDurableAckGate();
    expect(gate.isDirty).toBe(false);
    gate.beginTransaction();
    expect(gate.isDirty).toBe(true);

    gate.handleGatewayMessage("spectra.durable_ack", ["early-ack"]);
    expect(gate.isDirty).toBe(true);

    gate.handleGatewayMessage("spectra.durable_pending", ["ai-op:update-1"]);
    expect(gate.isDirty).toBe(true);

    gate.handleGatewayMessage("spectra.durable_ack", ["ai-op:update-1"]);
    expect(gate.isDirty).toBe(false);
  });

  it("does not clear on a partial ack", () => {
    const gate = new AiDurableAckGate();
    gate.beginTransaction();
    gate.handleGatewayMessage("spectra.durable_pending", [
      "ai-op:update-1",
      "ai-op:update-2",
    ]);
    gate.handleGatewayMessage("spectra.durable_ack", ["ai-op:update-1"]);
    expect(gate.isDirty).toBe(true);
    gate.handleGatewayMessage("spectra.durable_ack", ["ai-op:update-2"]);
    expect(gate.isDirty).toBe(false);
  });

  it("keeps AI completion dirty when transport is clean before pending/ack", () => {
    const gate = new AiDurableAckGate();
    const transport = { hasUnsyncedChanges: false };
    const hasUnsyncedChanges = () =>
      transport.hasUnsyncedChanges || gate.isDirty;

    gate.beginTransaction();
    transport.hasUnsyncedChanges = false;
    expect(hasUnsyncedChanges()).toBe(true);

    gate.handleGatewayMessage("spectra.durable_pending", ["ai-op:update-1"]);
    expect(hasUnsyncedChanges()).toBe(true);

    gate.handleGatewayMessage("spectra.durable_ack", ["ai-op:update-1"]);
    expect(hasUnsyncedChanges()).toBe(false);
  });
});
