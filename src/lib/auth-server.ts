import { auth, currentUser } from "@clerk/nextjs/server";
import { hasClerkServerConfig } from "@/lib/clerk-config";
import { convexMutation, convexQuery } from "@/lib/convex-server";

export type SchoolRole = "student" | "teacher" | "school_admin";

export type SessionActor = {
  clerkId: string;
  accountId: string;
  email: string;
  name: string;
  schoolId: string;
  schoolRole: SchoolRole;
  membershipId: string;
};

type IdentityContext = {
  accountId: string;
  clerkId: string;
  email: string;
  emailVerified: boolean;
  name: string;
  avatarUrl?: string;
  schoolId: string;
  schoolRole: SchoolRole;
  membershipId: string;
};

export type AccountIdentity = {
  accountId: string;
  email: string;
  emailVerified: boolean;
  name: string;
  avatarUrl?: string;
  status: "active" | "deactivated";
  platformOperator: boolean;
};

export type PlatformOperatorAccount = AccountIdentity & {
  platformOperator: true;
};

export type AccessPrincipal =
  | { kind: "school"; actor: SessionActor }
  | { kind: "platform"; account: PlatformOperatorAccount };

function operatorEmails() {
  const values = (process.env.SUPER_ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (process.env.NODE_ENV === "production" && values.length === 0) {
    throw new Error(
      "AUTH_OPERATOR_CONFIG_MISSING: SUPER_ADMIN_EMAILS must contain at least one verified operator email in production.",
    );
  }
  return new Set(values);
}

export function isPlatformOperatorEmail(email: string) {
  return operatorEmails().has(email.trim().toLowerCase());
}

const ACTOR_IDENTITY_TTL_MS = 30_000;
const actorIdentityCache = new Map<
  string,
  { actor: SessionActor; expiresAt: number }
>();

export function clearActorIdentityCache() {
  actorIdentityCache.clear();
}

async function readIdentity() {
  return convexQuery<Record<string, never>, IdentityContext | null>(
    "identity:me",
    {},
  );
}

function cachedActor(clerkId: string) {
  const cached = actorIdentityCache.get(clerkId);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    actorIdentityCache.delete(clerkId);
    return null;
  }
  return cached.actor;
}

function rememberActor(clerkId: string, actor: SessionActor) {
  if (actorIdentityCache.size >= 500) {
    const now = Date.now();
    for (const [key, value] of actorIdentityCache) {
      if (value.expiresAt <= now) actorIdentityCache.delete(key);
    }
    if (actorIdentityCache.size >= 500) {
      const oldestKey = actorIdentityCache.keys().next().value;
      if (oldestKey) actorIdentityCache.delete(oldestKey);
    }
  }
  actorIdentityCache.set(clerkId, {
    actor,
    expiresAt: Date.now() + ACTOR_IDENTITY_TTL_MS,
  });
}

async function ensureVerifiedClerkAccount() {
  const profile = await currentUser();
  if (!profile)
    throw new Error(
      "AUTH_PROFILE_UNAVAILABLE: The signed-in identity profile could not be loaded.",
    );
  const primary = profile.emailAddresses.find(
    (entry) => entry.id === profile.primaryEmailAddressId,
  );
  const verified = [primary, ...profile.emailAddresses]
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .find(
      (entry) =>
        entry.verification?.status === "verified" &&
        Boolean(entry.emailAddress),
    );
  if (!verified)
    throw new Error(
      "AUTH_EMAIL_UNVERIFIED: Verify your school email before using Spectra.",
    );
  await convexMutation("identity:registerSelf", {
    name: profile.fullName ?? profile.firstName ?? "Spectra user",
    avatarUrl: profile.imageUrl || undefined,
  });
}

export async function requireAccount(): Promise<AccountIdentity> {
  if (!hasClerkServerConfig())
    throw new Error("AUTH_MISCONFIGURED: Clerk authentication is required.");
  const authState = await auth();
  if (!authState.userId)
    throw new Error("AUTH_NOT_SIGNED_IN: Sign in to continue.");
  let account = await convexQuery<
    Record<string, never>,
    AccountIdentity | null
  >("identity:account", {});
  if (!account) {
    await ensureVerifiedClerkAccount();
    account = await convexQuery<Record<string, never>, AccountIdentity | null>(
      "identity:account",
      {},
    );
  }
  if (!account || account.status !== "active")
    throw new Error(
      "AUTH_ACCOUNT_REQUIRED: An active verified account is required.",
    );
  return account;
}

export function isAuthNoSchool(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.startsWith("AUTH_NO_SCHOOL");
}

export async function requireActor(
  options: { fresh?: boolean } = {},
): Promise<SessionActor> {
  if (!hasClerkServerConfig())
    throw new Error("AUTH_MISCONFIGURED: Clerk authentication is required.");

  let clerkId: string | null = null;
  try {
    const authState = await auth();
    clerkId = authState.userId;
  } catch {
    throw new Error("AUTH_MISCONFIGURED: Clerk authentication failed.");
  }
  if (!clerkId) throw new Error("AUTH_NOT_SIGNED_IN: Sign in to continue.");

  if (!options.fresh) {
    const cached = cachedActor(clerkId);
    if (cached) return cached;
  }

  let identity = await readIdentity();
  if (!identity) {
    await ensureVerifiedClerkAccount();
    identity = await readIdentity();
  }
  if (!identity) {
    actorIdentityCache.delete(clerkId);
    throw new Error(
      "AUTH_NO_SCHOOL: This account does not have an active school membership.",
    );
  }
  if (!identity.emailVerified) {
    actorIdentityCache.delete(clerkId);
    throw new Error(
      "AUTH_EMAIL_UNVERIFIED: Verify your school email before using Spectra.",
    );
  }
  const actor = {
    clerkId,
    accountId: identity.accountId,
    email: identity.email,
    name: identity.name,
    schoolId: identity.schoolId,
    schoolRole: identity.schoolRole,
    membershipId: identity.membershipId,
  };
  rememberActor(clerkId, actor);
  return actor;
}

export async function requirePlatformOperator(): Promise<PlatformOperatorAccount> {
  const account = await requireAccount();
  if (!account.platformOperator || !isPlatformOperatorEmail(account.email))
    throw new Error(
      "AUTH_OPERATOR_REQUIRED: Platform operator access is required.",
    );
  return { ...account, platformOperator: true };
}

export async function requireAccessPrincipal(
  scope: "school" | "platform",
): Promise<AccessPrincipal> {
  if (scope === "platform") {
    return { kind: "platform", account: await requirePlatformOperator() };
  }
  return { kind: "school", actor: await requireActor() };
}
