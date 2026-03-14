export function getClerkPublishableKey() {
  return process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? process.env.CLERK_PUBLISHABLE_KEY;
}

export function hasClerkPublishableKey() {
  return Boolean(getClerkPublishableKey());
}

export function hasClerkServerConfig() {
  return Boolean(process.env.CLERK_SECRET_KEY && getClerkPublishableKey());
}
