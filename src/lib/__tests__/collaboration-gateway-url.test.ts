import { afterEach, describe, expect, it, vi } from "vitest";
import { collaborationGatewayUrl } from "@/lib/collaboration-token";

afterEach(() => vi.unstubAllEnvs());

describe("collaborationGatewayUrl", () => {
  it("refuses to hand production clients a localhost gateway", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SPECTRA_COLLAB_URL", "");
    vi.stubEnv("SPECTRA_CLOUDFLARE_COLLAB_URL", "");
    expect(() => collaborationGatewayUrl("hocuspocus")).toThrow(
      /^COLLABORATION_GATEWAY_CONFIG_MISSING: Configure NEXT_PUBLIC_SPECTRA_COLLAB_URL/,
    );
    expect(() => collaborationGatewayUrl("cloudflare")).toThrow(
      /^COLLABORATION_GATEWAY_CONFIG_MISSING: Configure SPECTRA_CLOUDFLARE_COLLAB_URL/,
    );
  });

  it("uses the configured gateway, preferring the Cloudflare URL for Cloudflare rooms", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SPECTRA_COLLAB_URL", " wss://realtime.example.org ");
    vi.stubEnv("SPECTRA_CLOUDFLARE_COLLAB_URL", "wss://edge.example.org");
    expect(collaborationGatewayUrl("hocuspocus")).toBe("wss://realtime.example.org");
    expect(collaborationGatewayUrl("cloudflare")).toBe("wss://edge.example.org");
    vi.stubEnv("SPECTRA_CLOUDFLARE_COLLAB_URL", "");
    expect(collaborationGatewayUrl("cloudflare")).toBe("wss://realtime.example.org");
  });

  it("keeps the localhost defaults for development", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_SPECTRA_COLLAB_URL", "");
    vi.stubEnv("SPECTRA_CLOUDFLARE_COLLAB_URL", "");
    expect(collaborationGatewayUrl("hocuspocus")).toBe("ws://localhost:1234");
    expect(collaborationGatewayUrl("cloudflare")).toBe("ws://localhost:8787");
  });
});
