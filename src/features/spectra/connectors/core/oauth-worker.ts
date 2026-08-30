import "server-only";

import { convexMutation, convexQuery } from "@/lib/convex-server";
import {
  loadAccountSecretForConnector,
  revokeAccountSecret,
  storeAccountSecret,
} from "@/lib/server-secrets";
import {
  classifyOAuthRefreshFailure,
  OAuthProtocolError,
  parseStoredOAuthTokenBundle,
  refreshOAuthToken,
  revokeOAuthToken,
  type OAuthTokenBundle,
} from "./oauth";
import { requireOAuthProviderDescriptor } from "./registry";

type OAuthConnectionContext = {
  connectionId: string;
  accountId: string;
  provider: string;
  displayLabel?: string;
  secretPurpose: string;
  grantedScopes: string[];
  expiresAt?: number;
};

async function context(connectionId: string) {
  return convexQuery<{ connectionId: string }, OAuthConnectionContext>(
    "connections:oauthContext",
    { connectionId },
  );
}

export async function persistOAuthToken(input: {
  connection: OAuthConnectionContext;
  token: OAuthTokenBundle;
  displayLabel?: string;
  secretLabel: string;
}) {
  await storeAccountSecret({
    accountId: input.connection.accountId,
    purpose: input.connection.secretPurpose,
    label: input.secretLabel,
    value: JSON.stringify(input.token),
  });
  await convexMutation("connections:markConnected", {
    connectionId: input.connection.connectionId,
    grantedScopes: input.token.scopes,
    expiresAt: input.token.expiresAt,
    displayLabel: input.displayLabel,
  });
}

/**
 * Shared refresh substrate for provider action workers. A concrete provider
 * worker supplies only its descriptor; token storage and health compensation
 * remain centralized here.
 */
export async function refreshOAuthConnection(input: {
  connectionId: string;
  expectedProvider?: string;
  serviceSubject?: string;
  fetchImpl?: typeof fetch;
}) {
  const connection = await context(input.connectionId);
  if (input.expectedProvider && connection.provider !== input.expectedProvider)
    throw new OAuthProtocolError(
      "provider_mismatch",
      "The connection does not belong to this provider.",
    );
  const descriptor = requireOAuthProviderDescriptor(connection.provider);
  try {
    const stored = await loadAccountSecretForConnector({
      accountId: connection.accountId,
      purpose: connection.secretPurpose,
      serviceSubject: input.serviceSubject,
    });
    if (!stored)
      throw new OAuthProtocolError(
        "refresh_token_missing",
        "This connection must be authorized again.",
      );
    const refreshed = await refreshOAuthToken({
      descriptor,
      current: parseStoredOAuthTokenBundle(stored.value),
      fetchImpl: input.fetchImpl,
    });
    await persistOAuthToken({
      connection,
      token: refreshed,
      displayLabel: connection.displayLabel,
      secretLabel: stored.label,
    });
    return { refreshed: true, expiresAt: refreshed.expiresAt };
  } catch (error) {
    const failure = classifyOAuthRefreshFailure(error, descriptor);
    await convexMutation("connections:markFailure", {
      connectionId: connection.connectionId,
      ...failure,
    });
    throw error;
  }
}

export async function revokeOAuthConnection(input: {
  connectionId: string;
  expectedProvider?: string;
  fetchImpl?: typeof fetch;
}) {
  const connection = await context(input.connectionId);
  if (input.expectedProvider && connection.provider !== input.expectedProvider)
    throw new OAuthProtocolError(
      "provider_mismatch",
      "The connection does not belong to this provider.",
    );
  const descriptor = requireOAuthProviderDescriptor(connection.provider);
  let remoteRevocationConfirmed = false;
  try {
    const stored = await loadAccountSecretForConnector({
      accountId: connection.accountId,
      purpose: connection.secretPurpose,
    });
    if (stored) {
      remoteRevocationConfirmed = await revokeOAuthToken({
        descriptor,
        token: parseStoredOAuthTokenBundle(stored.value),
        fetchImpl: input.fetchImpl,
      });
    }
  } catch {
    remoteRevocationConfirmed = false;
  }
  try {
    await revokeAccountSecret({
      accountId: connection.accountId,
      purpose: connection.secretPurpose,
    });
  } catch (error) {
    await convexMutation("connections:markFailure", {
      connectionId: connection.connectionId,
      status: "error",
      errorCode: "local_revocation_failed",
      statusReason: "Spectra could not remove the stored provider token.",
    });
    throw error;
  }
  await convexMutation("connections:markRevoked", {
    connectionId: connection.connectionId,
    remoteRevocationConfirmed,
  });
  return { revoked: true, remoteRevocationConfirmed };
}
