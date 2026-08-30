import { BUILT_IN_PROVIDER_DESCRIPTORS } from "./providers";
import {
  CONNECTION_AUTH_KINDS,
  CONNECTOR_FAMILIES,
  type ProviderDescriptor,
} from "./types";

const PROVIDER_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function createProviderRegistry(
  descriptors: readonly ProviderDescriptor[],
) {
  const registry = new Map<string, ProviderDescriptor>();
  for (const descriptor of descriptors) {
    if (!PROVIDER_ID.test(descriptor.id))
      throw new Error(`Invalid provider id: ${descriptor.id}`);
    if (registry.has(descriptor.id))
      throw new Error(`Duplicate provider descriptor: ${descriptor.id}`);
    if (!CONNECTOR_FAMILIES.includes(descriptor.family))
      throw new Error(`Invalid connector family: ${descriptor.family}`);
    if (!CONNECTION_AUTH_KINDS.includes(descriptor.auth.kind))
      throw new Error(`Invalid provider auth flow: ${descriptor.auth.kind}`);
    if (descriptor.rateLimit.requestsPerMinute < 1)
      throw new Error(`Invalid provider rate limit: ${descriptor.id}`);
    if (descriptor.worker.kind === "convex-action" && !descriptor.worker.module)
      throw new Error(`Provider worker is missing: ${descriptor.id}`);
    registry.set(descriptor.id, Object.freeze({ ...descriptor }));
  }
  return registry;
}

export const providerRegistry = createProviderRegistry(
  BUILT_IN_PROVIDER_DESCRIPTORS,
);

export function getProviderDescriptor(providerId: string) {
  return providerRegistry.get(providerId);
}

export function requireProviderDescriptor(providerId: string) {
  const descriptor = getProviderDescriptor(providerId);
  if (!descriptor)
    throw new Error(`CONNECTION_PROVIDER_UNAVAILABLE: ${providerId}`);
  return descriptor;
}

export function requireOAuthProviderDescriptor(providerId: string) {
  const descriptor = requireProviderDescriptor(providerId);
  if (descriptor.auth.kind !== "oauth")
    throw new Error(`CONNECTION_OAUTH_UNAVAILABLE: ${providerId}`);
  return descriptor;
}

export function listProviderDescriptors() {
  return [...providerRegistry.values()];
}
