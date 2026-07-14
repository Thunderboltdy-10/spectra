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

function operatorEmails() {
  const values = (process.env.SUPER_ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (process.env.NODE_ENV === "production" && values.length === 0) {
    throw new Error("AUTH_OPERATOR_CONFIG_MISSING: SUPER_ADMIN_EMAILS must contain at least one verified operator email in production.");
  }
  return new Set(values);
}

export function isPlatformOperatorEmail(email: string) {
  return operatorEmails().has(email.trim().toLowerCase());
}

async function readIdentity(clerkId: string) {
  return convexQuery<{ clerkId: string }, IdentityContext | null>("identity:me", { clerkId });
}

async function ensureVerifiedClerkAccount(clerkId: string) {
  const profile = await currentUser();
  if (!profile) throw new Error("AUTH_PROFILE_UNAVAILABLE: The signed-in identity profile could not be loaded.");
  const primary = profile.emailAddresses.find((entry) => entry.id === profile.primaryEmailAddressId);
  const verified = [primary, ...profile.emailAddresses]
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .find((entry) => entry.verification?.status === "verified" && Boolean(entry.emailAddress));
  if (!verified) throw new Error("AUTH_EMAIL_UNVERIFIED: Verify your school email before using Spectra.");
  await convexMutation("identity:registerVerifiedAccount", {
    clerkId,
    email: verified.emailAddress,
    emailVerified: true,
    name: profile.fullName ?? profile.firstName ?? "Spectra user",
    avatarUrl: profile.imageUrl || undefined,
  });
}

async function requireLocalDevelopmentActor(): Promise<SessionActor> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_MISCONFIGURED: Clerk is required in production.");
  }
  const clerkId = "dev_local_spectra_user";
  await convexMutation("identity:ensureDevelopmentActor", {
    clerkId,
    email: "local-user@spectra.dev",
    name: "Local Spectra User",
    schoolName: "Local Spectra School",
    schoolSlug: "local-spectra-school",
  });
  const identity = await readIdentity(clerkId);
  if (!identity) throw new Error("AUTH_BOOTSTRAP_FAILED: Development identity could not be initialized.");
  return {
    clerkId,
    accountId: identity.accountId,
    email: identity.email,
    name: identity.name,
    schoolId: identity.schoolId,
    schoolRole: identity.schoolRole,
    membershipId: identity.membershipId,
  };
}

export async function requireActor(): Promise<SessionActor> {
  if (!hasClerkServerConfig()) return requireLocalDevelopmentActor();

  let clerkId: string | null = null;
  try {
    clerkId = (await auth()).userId;
  } catch {
    throw new Error("AUTH_MISCONFIGURED: Clerk authentication failed.");
  }
  if (!clerkId) throw new Error("AUTH_NOT_SIGNED_IN: Sign in to continue.");

  let identity = await readIdentity(clerkId);
  if (!identity) {
    await ensureVerifiedClerkAccount(clerkId);
    identity = await readIdentity(clerkId);
  }
  if (!identity) {
    throw new Error("AUTH_NO_SCHOOL: This account does not have an active school membership.");
  }
  if (!identity.emailVerified) throw new Error("AUTH_EMAIL_UNVERIFIED: Verify your school email before using Spectra.");
  return {
    clerkId,
    accountId: identity.accountId,
    email: identity.email,
    name: identity.name,
    schoolId: identity.schoolId,
    schoolRole: identity.schoolRole,
    membershipId: identity.membershipId,
  };
}

export async function requirePlatformOperator() {
  const actor = await requireActor();
  if (!isPlatformOperatorEmail(actor.email)) throw new Error("AUTH_OPERATOR_REQUIRED: Platform operator access is required.");
  return actor;
}
