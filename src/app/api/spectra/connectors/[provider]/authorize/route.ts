import { NextRequest, NextResponse } from "next/server";
import { convexQuery } from "@/lib/convex-server";
import {
  buildOAuthAuthorizationUrl,
  createOAuthState,
  oauthCookieName,
} from "@/features/spectra/connectors/core/oauth";
import { requireOAuthProviderDescriptor } from "@/features/spectra/connectors/core";

function settingsRedirect(origin: string, provider: string, error: string) {
  const url = new URL("/settings", origin);
  url.searchParams.set("section", "connections");
  url.searchParams.set("connection", "error");
  url.searchParams.set("provider", provider);
  url.searchParams.set("reason", error);
  return NextResponse.redirect(url);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  try {
    const account = await convexQuery<Record<string, never>, unknown>(
      "identity:account",
      {},
    );
    if (!account)
      return settingsRedirect(
        request.nextUrl.origin,
        provider,
        "sign_in_required",
      );
    const descriptor = requireOAuthProviderDescriptor(provider);
    const state = createOAuthState({
      provider,
      returnTo: request.nextUrl.searchParams.get("returnTo"),
    });
    const redirectUri = new URL(
      `/api/spectra/connectors/${provider}/callback`,
      request.nextUrl.origin,
    ).toString();
    const response = NextResponse.redirect(
      buildOAuthAuthorizationUrl({
        descriptor,
        redirectUri,
        state: state.value,
      }),
    );
    response.cookies.set(oauthCookieName(provider), state.payload.nonce, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 10 * 60,
      path: `/api/spectra/connectors/${provider}/callback`,
    });
    return response;
  } catch {
    return settingsRedirect(
      request.nextUrl.origin,
      provider,
      "provider_unavailable",
    );
  }
}
