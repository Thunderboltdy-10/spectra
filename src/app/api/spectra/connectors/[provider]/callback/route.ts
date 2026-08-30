import { NextRequest, NextResponse } from "next/server";
import { convexMutation } from "@/lib/convex-server";
import {
  exchangeOAuthCode,
  loadOAuthIdentity,
  oauthCookieName,
  verifyOAuthState,
} from "@/features/spectra/connectors/core/oauth";
import { persistOAuthToken } from "@/features/spectra/connectors/core/oauth-worker";
import { requireOAuthProviderDescriptor } from "@/features/spectra/connectors/core";

type PreparedConnection = {
  connectionId: string;
  accountId: string;
  secretPurpose: string;
};

function finishUrl(
  origin: string,
  returnTo: string,
  provider: string,
  status: "connected" | "error",
  reason?: string,
) {
  const url = new URL(returnTo, origin);
  url.searchParams.set("section", "connections");
  url.searchParams.set("connection", status);
  url.searchParams.set("provider", provider);
  if (reason) url.searchParams.set("reason", reason);
  return url;
}

function clearStateCookie(response: NextResponse, provider: string) {
  response.cookies.set(oauthCookieName(provider), "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    path: `/api/spectra/connectors/${provider}/callback`,
  });
  return response;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  let returnTo = "/settings?section=connections";
  try {
    const stateValue = request.nextUrl.searchParams.get("state") ?? "";
    const state = verifyOAuthState(stateValue);
    returnTo = state.returnTo;
    if (
      state.provider !== provider ||
      request.cookies.get(oauthCookieName(provider))?.value !== state.nonce
    ) {
      throw new Error("OAUTH_STATE_MISMATCH");
    }
    if (request.nextUrl.searchParams.has("error")) {
      return clearStateCookie(
        NextResponse.redirect(
          finishUrl(
            request.nextUrl.origin,
            returnTo,
            provider,
            "error",
            "authorization_declined",
          ),
        ),
        provider,
      );
    }
    const code = request.nextUrl.searchParams.get("code");
    if (!code) throw new Error("OAUTH_CODE_MISSING");
    const descriptor = requireOAuthProviderDescriptor(provider);
    const redirectUri = new URL(
      `/api/spectra/connectors/${provider}/callback`,
      request.nextUrl.origin,
    ).toString();
    const token = await exchangeOAuthCode({ descriptor, code, redirectUri });
    const identity = await loadOAuthIdentity({ descriptor, token });
    const prepared = await convexMutation<
      {
        provider: string;
        family: typeof descriptor.family;
        providerAccountId: string;
        displayLabel: string;
        grantedScopes: string[];
      },
      PreparedConnection
    >("connections:prepareOAuth", {
      provider,
      family: descriptor.family,
      providerAccountId: identity.providerAccountId,
      displayLabel: identity.label,
      grantedScopes: token.scopes,
    });
    await persistOAuthToken({
      connection: {
        ...prepared,
        provider,
        grantedScopes: token.scopes,
        expiresAt: token.expiresAt,
      },
      token,
      displayLabel: identity.label,
      secretLabel: `${descriptor.display.name} OAuth token`,
    });
    return clearStateCookie(
      NextResponse.redirect(
        finishUrl(request.nextUrl.origin, returnTo, provider, "connected"),
      ),
      provider,
    );
  } catch {
    return clearStateCookie(
      NextResponse.redirect(
        finishUrl(
          request.nextUrl.origin,
          returnTo,
          provider,
          "error",
          "connection_failed",
        ),
      ),
      provider,
    );
  }
}
