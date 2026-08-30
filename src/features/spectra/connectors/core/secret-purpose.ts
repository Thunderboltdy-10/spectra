const PROVIDER_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CONNECTION_ID = /^[a-z0-9_]+$/i;

export type ConnectionSecretKind = "oauth-token";

export function connectionSecretPurpose(
  provider: string,
  connectionId: string,
  kind: ConnectionSecretKind = "oauth-token",
) {
  const normalizedProvider = provider.trim().toLowerCase();
  const normalizedConnectionId = connectionId.trim();
  if (!PROVIDER_ID.test(normalizedProvider))
    throw new Error("CONNECTION_PROVIDER_INVALID");
  if (!CONNECTION_ID.test(normalizedConnectionId))
    throw new Error("CONNECTION_ID_INVALID");
  return `connector:${normalizedProvider}:${normalizedConnectionId}:${kind}`;
}

export function parseConnectionSecretPurpose(value: string) {
  const [namespace, provider, connectionId, kind, ...rest] = value.split(":");
  if (
    namespace !== "connector" ||
    rest.length > 0 ||
    !provider ||
    !connectionId ||
    kind !== "oauth-token" ||
    !PROVIDER_ID.test(provider) ||
    !CONNECTION_ID.test(connectionId)
  ) {
    return null;
  }
  return { provider, connectionId, kind: kind as ConnectionSecretKind };
}
