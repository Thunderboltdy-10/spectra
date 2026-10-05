import { describe, expect, it, vi } from "vitest";
import { createPairing, PAIRING_COPY, type PairingDeps, type PairingState } from "../pairing";
import type { BridgeDiscovery } from "../../bridge/client";

const running: BridgeDiscovery = { kind: "running", health: { version: "1.4.0", paired: false, protocolVersion: "1.0" } };

function harness(overrides: Partial<PairingDeps> & { discoveries?: BridgeDiscovery[]; statuses?: Array<Awaited<ReturnType<PairingDeps["status"]>>> } = {}) {
  let clock = 1_000;
  const discoveries = [...(overrides.discoveries ?? [running])];
  const statuses = [...(overrides.statuses ?? [{ paired: true, sessionToken: "session" }])];
  const deps: PairingDeps = {
    discover: vi.fn(async () => (discoveries.length > 1 ? discoveries.shift()! : discoveries[0])),
    offer: vi.fn(async () => undefined),
    status: vi.fn(async () => (statuses.length > 1 ? statuses.shift()! : statuses[0])),
    persist: vi.fn(),
    enableDiscovery: vi.fn(),
    platform: () => "windows",
    origin: () => "https://spectra.test",
    now: () => clock,
    wait: vi.fn(async (ms: number) => {
      clock += ms;
    }),
    ...overrides,
  };
  const request = vi.fn(async () => ({ challenge: "c".repeat(40), shortCode: "123456", expiresAt: clock + 10 * 60_000 }));
  const pairing = createPairing(deps);
  const seen: PairingState["phase"][] = [];
  pairing.subscribe(() => seen.push(pairing.get().phase));
  return { deps, request, pairing, seen, advance: (ms: number) => (clock += ms) };
}

describe("connecting this computer", () => {
  it("pairs a running Bridge, shows the code while it waits, and keeps the session", async () => {
    const { pairing, request, deps, seen } = harness({
      statuses: [{ paired: false }, { paired: false }, { paired: true, sessionToken: "session" }],
    });
    const result = await pairing.start(request);
    expect(result.phase).toBe("paired");
    expect(seen).toEqual(["checking", "requesting", "confirming", "paired"]);
    expect(request).toHaveBeenCalledWith({ browserOrigin: "https://spectra.test" });
    expect(deps.offer).toHaveBeenCalledWith(expect.objectContaining({ shortCode: "123456", browserOrigin: "https://spectra.test" }));
    expect(deps.persist).toHaveBeenCalledWith("session");
    expect(deps.enableDiscovery).toHaveBeenCalled();
  });

  it("offers the download when Bridge is missing, then continues by itself once it starts", async () => {
    const notRunning: BridgeDiscovery = { kind: "not-running" };
    const { pairing, request, seen } = harness({ discoveries: [notRunning, notRunning, notRunning, running] });
    const states: PairingState[] = [];
    pairing.subscribe(() => states.push(pairing.get()));
    expect((await pairing.start(request)).phase).toBe("paired");
    expect(seen.slice(0, 3)).toEqual(["checking", "download", "requesting"]);
    expect(states[1]).toMatchObject({ phase: "download", platform: "windows", url: expect.stringMatching(/\/windows$/) });
  });

  it("stops waiting for the download after a while, in plain words", async () => {
    const { pairing, request } = harness({ discoveries: [{ kind: "not-running" }] });
    expect(await pairing.start(request)).toEqual({ phase: "failed", message: PAIRING_COPY.waitedTooLong });
    expect(request).not.toHaveBeenCalled();
  });

  it("says when the code expires or the computer declines", async () => {
    const expired = harness({ statuses: [{ paired: false }] });
    expired.deps.wait = vi.fn(async () => {
      expired.advance(11 * 60_000);
    });
    expect(await expired.pairing.start(expired.request)).toEqual({ phase: "failed", message: PAIRING_COPY.expired });
    const declined = harness({ statuses: [{ paired: false, failure: "Pairing was declined on this computer." }] });
    expect(await declined.pairing.start(declined.request)).toEqual({ phase: "failed", message: "Pairing was declined on this computer." });
  });

  it("does not offer a download where Bridge cannot run", async () => {
    const { pairing, request } = harness({ discoveries: [{ kind: "not-running" }], platform: () => "other" });
    expect(await pairing.start(request)).toEqual({ phase: "failed", message: PAIRING_COPY.noBridgeHere });
  });

  it("refuses an out-of-date Bridge and a taken port", async () => {
    const old = harness({ discoveries: [{ kind: "running", health: { version: "0.9.0", paired: false, protocolVersion: "0.4" } }] });
    expect(await old.pairing.start(old.request)).toEqual({ phase: "failed", message: PAIRING_COPY.outOfDate });
    const taken = harness({ discoveries: [{ kind: "port-taken" }] });
    expect(await taken.pairing.start(taken.request)).toEqual({ phase: "failed", message: PAIRING_COPY.portTaken });
  });

  it("joins a flow already running instead of starting a second one", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { pairing, request, deps } = harness({ discover: vi.fn(async () => (await gate, running)) });
    const first = pairing.start(request);
    expect((await pairing.start(request)).phase).toBe("checking");
    release();
    expect((await first).phase).toBe("paired");
    expect(deps.discover).toHaveBeenCalledTimes(1);
  });

  it("cancelling stops the wait and returns to the start", async () => {
    const { pairing, request, deps } = harness({ statuses: [{ paired: false }] });
    deps.wait = vi.fn(async () => pairing.cancel());
    await pairing.start(request);
    expect(pairing.get()).toEqual({ phase: "idle" });
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it("reads a failed request in plain words", async () => {
    const { pairing } = harness();
    const result = await pairing.start(async () => {
      throw new Error("Pairing expired");
    });
    expect(result).toEqual({ phase: "failed", message: "This connection attempt timed out. Try again." });
  });
});
