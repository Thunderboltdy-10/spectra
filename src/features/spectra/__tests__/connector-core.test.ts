import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONNECTION_COMPENSATION_TABLE,
  connectionSecretPurpose,
  createProviderRegistry,
  listProviderDescriptors,
  parseConnectionSecretPurpose,
  presentConnectionHealth,
  type ProviderDescriptor,
} from "../connectors/core";
import {
  buildOAuthAuthorizationUrl,
  classifyOAuthRefreshFailure,
  createOAuthState,
  OAuthProtocolError,
  refreshOAuthToken,
  verifyOAuthState,
} from "../connectors/core/oauth";

const oauthDescriptor: ProviderDescriptor = {
  id: "recorded-oauth",
  family: "file-sync",
  display: {
    name: "Recorded OAuth",
    description: "Fixture provider",
    icon: "cloud",
  },
  auth: {
    kind: "oauth",
    authorizeUrl: "https://provider.example/authorize",
    tokenUrl: "https://provider.example/token",
    revokeUrl: "https://provider.example/revoke",
    clientIdEnv: "RECORDED_OAUTH_CLIENT_ID",
    clientSecretEnv: "RECORDED_OAUTH_CLIENT_SECRET",
    scopes: ["files.read", "files.write"],
    authorizationParams: { access_type: "offline" },
  },
  capabilities: {
    artifactTypes: ["document"],
    nativeFormats: ["docx"],
    directions: ["sync"],
  },
  rateLimit: {
    requestsPerMinute: 60,
    baseBackoffMs: 1_000,
    maxBackoffMs: 60_000,
  },
  worker: { kind: "convex-action", module: "recorded:worker" },
};

describe("connector core", () => {
  beforeEach(() => {
    process.env.SPECTRA_OAUTH_STATE_SECRET = "s".repeat(48);
    process.env.RECORDED_OAUTH_CLIENT_ID = "recorded-client";
    process.env.RECORDED_OAUTH_CLIENT_SECRET = "recorded-secret";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.SPECTRA_OAUTH_STATE_SECRET;
    delete process.env.RECORDED_OAUTH_CLIENT_ID;
    delete process.env.RECORDED_OAUTH_CLIENT_SECRET;
  });

  it("registers the existing device and ManageBac without pretending they share a worker", () => {
    const descriptors = listProviderDescriptors();
    expect(descriptors.map((item) => item.id)).toEqual([
      "spectra-bridge",
      "managebac",
    ]);
    expect(descriptors[0]).toMatchObject({
      family: "file-sync",
      auth: { kind: "device" },
      worker: { kind: "bridge" },
    });
    expect(descriptors[1]).toMatchObject({
      family: "school-data",
      auth: { kind: "token" },
      worker: { kind: "convex-action" },
    });
  });

  it("rejects duplicate provider descriptors at the registry boundary", () => {
    expect(() =>
      createProviderRegistry([oauthDescriptor, oauthDescriptor]),
    ).toThrow("Duplicate provider descriptor");
  });

  it("defines a compensating exit and a plain sentence for every connection state", () => {
    for (const status of [
      "connected",
      "expired",
      "rate_limited",
      "revoked",
      "error",
    ] as const) {
      expect(
        CONNECTION_COMPENSATION_TABLE[status].compensation.length,
      ).toBeGreaterThan(20);
      expect(
        CONNECTION_COMPENSATION_TABLE[status].exits.length,
      ).toBeGreaterThan(0);
      const presentation = presentConnectionHealth({ status });
      expect(presentation.label).not.toMatch(/[_A-Z]{3,}/);
      expect(presentation.sentence).toMatch(/[.!]$/);
    }
  });

  it("binds an OAuth token purpose to one provider and connection", () => {
    const purpose = connectionSecretPurpose("google-drive", "connection_123");
    expect(purpose).toBe("connector:google-drive:connection_123:oauth-token");
    expect(parseConnectionSecretPurpose(purpose)).toEqual({
      provider: "google-drive",
      connectionId: "connection_123",
      kind: "oauth-token",
    });
    expect(
      parseConnectionSecretPurpose("connector:other:bad:access-token"),
    ).toBeNull();
  });

  it("signs short-lived OAuth state and rejects a tampered callback", () => {
    const state = createOAuthState({
      provider: oauthDescriptor.id,
      returnTo: "/settings?section=connections",
      now: 1_000,
      nonce: "recorded-nonce",
    });
    expect(verifyOAuthState(state.value, 2_000)).toMatchObject({
      provider: oauthDescriptor.id,
      nonce: "recorded-nonce",
      returnTo: "/settings?section=connections",
    });
    expect(() => verifyOAuthState(`${state.value}x`, 2_000)).toThrow(
      "OAuth state is invalid",
    );
  });

  it("builds authorize parameters and refreshes without dropping a retained refresh token", async () => {
    const authorization = buildOAuthAuthorizationUrl({
      descriptor: oauthDescriptor,
      redirectUri: "https://spectra.example/api/callback",
      state: "signed-state",
    });
    expect(authorization.origin).toBe("https://provider.example");
    expect(authorization.searchParams.get("client_id")).toBe("recorded-client");
    expect(authorization.searchParams.get("scope")).toBe(
      "files.read files.write",
    );
    expect(authorization.searchParams.get("access_type")).toBe("offline");

    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        expect(String(init?.body)).toContain("grant_type=refresh_token");
        expect(String(init?.body)).toContain("refresh_token=refresh-original");
        return new Response(
          JSON.stringify({
            access_token: "access-next",
            token_type: "Bearer",
            expires_in: 3_600,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    );
    const refreshed = await refreshOAuthToken({
      descriptor: oauthDescriptor,
      current: {
        accessToken: "access-old",
        refreshToken: "refresh-original",
        tokenType: "Bearer",
        scopes: ["files.read"],
        obtainedAt: 1,
      },
      fetchImpl,
    });
    expect(refreshed).toMatchObject({
      accessToken: "access-next",
      refreshToken: "refresh-original",
      scopes: ["files.read", "files.write"],
    });
  });

  it("classifies invalid grants as expired and HTTP 429 as a scheduled retry", () => {
    expect(
      classifyOAuthRefreshFailure(
        new OAuthProtocolError("invalid_grant", "Invalid grant", 400),
        oauthDescriptor,
        10_000,
      ),
    ).toMatchObject({
      status: "expired",
      errorCode: "invalid_grant",
      retryAt: undefined,
    });
    expect(
      classifyOAuthRefreshFailure(
        new OAuthProtocolError("temporarily_unavailable", "Wait", 429),
        oauthDescriptor,
        10_000,
      ),
    ).toMatchObject({
      status: "rate_limited",
      errorCode: "temporarily_unavailable",
      retryAt: 11_000,
    });
  });
});
