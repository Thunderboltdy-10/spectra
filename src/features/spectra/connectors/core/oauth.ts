import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { ProviderDescriptor } from "./types";

export type OAuthStatePayload = {
  provider: string;
  nonce: string;
  returnTo: string;
  expiresAt: number;
};

export type OAuthTokenBundle = {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  scopes: string[];
  expiresAt?: number;
  obtainedAt: number;
};

export class OAuthProtocolError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "OAuthProtocolError";
  }
}

export function classifyOAuthRefreshFailure(
  error: unknown,
  descriptor: ProviderDescriptor,
  now = Date.now(),
) {
  const code =
    error instanceof OAuthProtocolError ? error.code : "oauth_refresh_failed";
  if (error instanceof OAuthProtocolError && error.status === 429) {
    return {
      status: "rate_limited" as const,
      errorCode: code,
      statusReason: "The provider asked Spectra to wait before refreshing.",
      retryAt: now + descriptor.rateLimit.baseBackoffMs,
    };
  }
  if (
    code === "invalid_grant" ||
    code === "refresh_token_missing" ||
    code === "oauth_token_envelope_invalid"
  ) {
    return {
      status: "expired" as const,
      errorCode: code,
      statusReason: "The provider requires a new authorization.",
      retryAt: undefined,
    };
  }
  return {
    status: "error" as const,
    errorCode: code,
    statusReason: "The provider token refresh failed.",
    retryAt: undefined,
  };
}

function oauthFlow(descriptor: ProviderDescriptor) {
  if (descriptor.auth.kind !== "oauth")
    throw new OAuthProtocolError(
      "provider_not_oauth",
      "This provider does not use OAuth.",
    );
  return descriptor.auth;
}

function stateSecret() {
  const value = process.env.SPECTRA_OAUTH_STATE_SECRET;
  if (!value || value.length < 32)
    throw new OAuthProtocolError(
      "oauth_state_config_missing",
      "OAuth state signing is not configured.",
    );
  return value;
}

function clientCredentials(descriptor: ProviderDescriptor) {
  const flow = oauthFlow(descriptor);
  const clientId = process.env[flow.clientIdEnv]?.trim();
  const clientSecret = process.env[flow.clientSecretEnv]?.trim();
  if (!clientId || !clientSecret)
    throw new OAuthProtocolError(
      "oauth_client_config_missing",
      `OAuth is not configured for ${descriptor.display.name}.`,
    );
  return { clientId, clientSecret };
}

export function normalizeOAuthReturnTo(value?: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//"))
    return "/settings?section=connections";
  try {
    const parsed = new URL(value, "https://spectra.local");
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/settings?section=connections";
  }
}

export function createOAuthState(input: {
  provider: string;
  returnTo?: string | null;
  now?: number;
  nonce?: string;
}) {
  const payload: OAuthStatePayload = {
    provider: input.provider,
    nonce: input.nonce ?? randomBytes(24).toString("base64url"),
    returnTo: normalizeOAuthReturnTo(input.returnTo),
    expiresAt: (input.now ?? Date.now()) + 10 * 60_000,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", stateSecret())
    .update(encoded)
    .digest("base64url");
  return { value: `${encoded}.${signature}`, payload };
}

export function verifyOAuthState(value: string, now = Date.now()) {
  const [encoded, received, ...rest] = value.split(".");
  if (!encoded || !received || rest.length)
    throw new OAuthProtocolError(
      "oauth_state_invalid",
      "OAuth state is invalid.",
    );
  const expected = createHmac("sha256", stateSecret()).update(encoded).digest();
  const signature = Buffer.from(received, "base64url");
  if (
    signature.length !== expected.length ||
    !timingSafeEqual(signature, expected)
  ) {
    throw new OAuthProtocolError(
      "oauth_state_invalid",
      "OAuth state is invalid.",
    );
  }
  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new OAuthProtocolError(
      "oauth_state_invalid",
      "OAuth state is invalid.",
    );
  }
  if (
    !payload ||
    typeof payload.provider !== "string" ||
    typeof payload.nonce !== "string" ||
    typeof payload.returnTo !== "string" ||
    typeof payload.expiresAt !== "number" ||
    payload.expiresAt <= now
  ) {
    throw new OAuthProtocolError("oauth_state_expired", "OAuth state expired.");
  }
  return payload;
}

export function oauthCookieName(provider: string) {
  return `spectra-oauth-${provider}`;
}

export function buildOAuthAuthorizationUrl(input: {
  descriptor: ProviderDescriptor;
  redirectUri: string;
  state: string;
}) {
  const flow = oauthFlow(input.descriptor);
  const { clientId } = clientCredentials(input.descriptor);
  const url = new URL(flow.authorizeUrl);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", flow.scopes.join(" "));
  url.searchParams.set("state", input.state);
  for (const [key, value] of Object.entries(flow.authorizationParams ?? {}))
    url.searchParams.set(key, value);
  return url;
}

function tokenRequest(input: {
  descriptor: ProviderDescriptor;
  body: URLSearchParams;
}) {
  const flow = oauthFlow(input.descriptor);
  const { clientId, clientSecret } = clientCredentials(input.descriptor);
  const headers = new Headers({
    accept: "application/json",
    "content-type": "application/x-www-form-urlencoded",
  });
  if (flow.clientAuth === "basic") {
    headers.set(
      "authorization",
      `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    );
    input.body.set("client_id", clientId);
  } else {
    input.body.set("client_id", clientId);
    input.body.set("client_secret", clientSecret);
  }
  return { url: flow.tokenUrl, headers, body: input.body };
}

function scopes(value: unknown, fallback: string[]) {
  if (Array.isArray(value))
    return value.filter((scope): scope is string => typeof scope === "string");
  if (typeof value === "string")
    return value
      .split(/[ ,]+/)
      .map((scope) => scope.trim())
      .filter(Boolean);
  return fallback;
}

async function parseTokenResponse(
  response: Response,
  descriptor: ProviderDescriptor,
  previousRefreshToken?: string,
) {
  const body = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!response.ok || !body || typeof body.access_token !== "string") {
    const code =
      body && typeof body.error === "string"
        ? body.error
        : "oauth_token_failed";
    throw new OAuthProtocolError(
      code,
      "The provider did not issue a usable access token.",
      response.status,
    );
  }
  const now = Date.now();
  const expiresIn =
    typeof body.expires_in === "number" && Number.isFinite(body.expires_in)
      ? Math.max(0, body.expires_in)
      : undefined;
  const flow = oauthFlow(descriptor);
  return {
    accessToken: body.access_token,
    refreshToken:
      typeof body.refresh_token === "string"
        ? body.refresh_token
        : previousRefreshToken,
    tokenType: typeof body.token_type === "string" ? body.token_type : "Bearer",
    scopes: scopes(body.scope, flow.scopes),
    expiresAt: expiresIn === undefined ? undefined : now + expiresIn * 1_000,
    obtainedAt: now,
  } satisfies OAuthTokenBundle;
}

export async function exchangeOAuthCode(input: {
  descriptor: ProviderDescriptor;
  code: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
  });
  const request = tokenRequest({ descriptor: input.descriptor, body });
  const response = await (input.fetchImpl ?? fetch)(request.url, {
    method: "POST",
    headers: request.headers,
    body: request.body,
    cache: "no-store",
  });
  return parseTokenResponse(response, input.descriptor);
}

export async function refreshOAuthToken(input: {
  descriptor: ProviderDescriptor;
  current: OAuthTokenBundle;
  fetchImpl?: typeof fetch;
}) {
  if (!input.current.refreshToken)
    throw new OAuthProtocolError(
      "refresh_token_missing",
      "This connection must be authorized again.",
    );
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: input.current.refreshToken,
  });
  const request = tokenRequest({ descriptor: input.descriptor, body });
  const response = await (input.fetchImpl ?? fetch)(request.url, {
    method: "POST",
    headers: request.headers,
    body: request.body,
    cache: "no-store",
  });
  return parseTokenResponse(
    response,
    input.descriptor,
    input.current.refreshToken,
  );
}

export async function loadOAuthIdentity(input: {
  descriptor: ProviderDescriptor;
  token: OAuthTokenBundle;
  fetchImpl?: typeof fetch;
}) {
  const flow = oauthFlow(input.descriptor);
  if (!flow.userInfo)
    return {
      providerAccountId: "default",
      label: input.descriptor.display.name,
    };
  const response = await (input.fetchImpl ?? fetch)(flow.userInfo.url, {
    headers: {
      authorization: `${input.token.tokenType} ${input.token.accessToken}`,
    },
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const id = body?.[flow.userInfo.idField];
  if (!response.ok || (typeof id !== "string" && typeof id !== "number"))
    throw new OAuthProtocolError(
      "oauth_identity_failed",
      "The provider account could not be identified.",
      response.status,
    );
  const rawLabel = flow.userInfo.labelField
    ? body?.[flow.userInfo.labelField]
    : undefined;
  return {
    providerAccountId: String(id).slice(0, 240),
    label:
      typeof rawLabel === "string" && rawLabel.trim()
        ? rawLabel.trim().slice(0, 120)
        : input.descriptor.display.name,
  };
}

export async function revokeOAuthToken(input: {
  descriptor: ProviderDescriptor;
  token: OAuthTokenBundle;
  fetchImpl?: typeof fetch;
}) {
  const flow = oauthFlow(input.descriptor);
  if (!flow.revokeUrl) return false;
  const { clientId, clientSecret } = clientCredentials(input.descriptor);
  const body = new URLSearchParams({
    token: input.token.refreshToken ?? input.token.accessToken,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const response = await (input.fetchImpl ?? fetch)(flow.revokeUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  return response.ok;
}

export function parseStoredOAuthTokenBundle(value: string) {
  const parsed = JSON.parse(value) as Partial<OAuthTokenBundle>;
  if (
    typeof parsed.accessToken !== "string" ||
    typeof parsed.tokenType !== "string" ||
    !Array.isArray(parsed.scopes) ||
    typeof parsed.obtainedAt !== "number"
  ) {
    throw new OAuthProtocolError(
      "oauth_token_envelope_invalid",
      "The stored OAuth token envelope is invalid.",
    );
  }
  return parsed as OAuthTokenBundle;
}
