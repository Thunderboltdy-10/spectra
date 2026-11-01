import { afterEach, describe, expect, it, vi } from "vitest";
import { collaborationGatewayUrl } from "@/lib/collaboration-token";

afterEach(() => vi.unstubAllEnvs());

describe("collaborationGatewayUrl", () => {
  it("refuses to hand production clients a localhost gateway", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SPECTRA_COLLAB_URL", "");
    expect(() => collaborationGatewayUrl()).toThrow(
      /^COLLABORATION_GATEWAY_CONFIG_MISSING: Configure NEXT_PUBLIC_SPECTRA_COLLAB_URL/,
    );
  });

  it("uses the configured gateway", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SPECTRA_COLLAB_URL", " wss://realtime.example.org ");
    expect(collaborationGatewayUrl()).toBe("wss://realtime.example.org");
  });

  it("keeps the localhost defaults for development", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_SPECTRA_COLLAB_URL", "");
    expect(collaborationGatewayUrl()).toBe("ws://localhost:1234");
  });
});
