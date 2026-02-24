import { auth, currentUser } from "@clerk/nextjs/server";
import { getAdminEmails } from "@/lib/env";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import type { Role } from "@/types";

const SUPER_ADMIN_EMAILS = new Set(
  (process.env.SUPER_ADMIN_EMAILS ?? "pablo.martinez.dovale@gmail.com")
    .split(/[,\s;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

export type SessionActor = {
  clerkId: string;
  email: string;
  name: string;
  role: Role;
  orgId: string;
  userId: string;
  onboardingComplete: boolean;
};

export function isSuperAdminEmail(email: string) {
  return SUPER_ADMIN_EMAILS.has(email.trim().toLowerCase());
}

const hasClerkConfig = Boolean(
  process.env.CLERK_SECRET_KEY &&
    (process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || process.env.CLERK_PUBLISHABLE_KEY),
);

async function bootstrapActor(params: {
  clerkId: string;
  email: string;
  name: string;
  bootstrapAdmin: boolean;
}) {
  await convexMutation("users:ensureUser", {
    clerkId: params.clerkId,
    email: params.email,
    name: params.name,
    requestedRole: "student",
    bootstrapAdmin: params.bootstrapAdmin,
  });

  const me = await convexQuery<
    { clerkId: string },
    {
      _id: string;
      role: Role;
      orgId: string;
      email: string;
      name: string;
      onboardingComplete?: boolean;
    } | null
  >("users:me", {
    clerkId: params.clerkId,
  });

  if (!me) {
    throw new Error("AUTH_BOOTSTRAP_FAILED: Could not initialize user in database.");
  }

  return {
    clerkId: params.clerkId,
    email: me.email,
    name: me.name,
    role: me.role,
    orgId: me.orgId,
    userId: me._id,
    onboardingComplete: Boolean(me.onboardingComplete),
  };
}

export async function requireActor(): Promise<SessionActor> {
  if (!hasClerkConfig) {
    return bootstrapActor({
      clerkId: "local-demo-admin",
      email: "local-admin@school.local",
      name: "Local Demo Admin",
      bootstrapAdmin: true,
    });
  }

  let userId: string | null = null;

  try {
    const authData = await auth();
    userId = authData.userId;
  } catch {
    throw new Error(
      "AUTH_MISCONFIGURED: Clerk auth failed. Check CLERK_SECRET_KEY and NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.",
    );
  }

  if (!userId) {
    throw new Error("AUTH_NOT_SIGNED_IN: Sign in to continue.");
  }

  const existing = await convexQuery<
    { clerkId: string },
    {
      _id: string;
      role: Role;
      orgId: string;
      email: string;
      name: string;
      onboardingComplete?: boolean;
    } | null
  >("users:me", {
    clerkId: userId,
  });

  if (existing) {
    let current = existing;
    let syncedEmail = existing.email;
    let syncedName = existing.name;

    // Clerk can update primary email after initial signup. When that happens,
    // re-check super-admin eligibility against the live Clerk profile so
    // super-admin routes do not fail due to stale email in Convex.
    if (existing.role !== "admin" && !isSuperAdminEmail(existing.email)) {
      const profile = await currentUser();
      const profileEmail = profile?.emailAddresses[0]?.emailAddress;
      const profileName = profile?.fullName ?? profile?.firstName;
      if (profileEmail) {
        syncedEmail = profileEmail;
      }
      if (profileName) {
        syncedName = profileName;
      }
    }

    const shouldBootstrapAdmin = existing.role !== "admin" && isSuperAdminEmail(syncedEmail);
    const needsIdentitySync = syncedEmail !== existing.email || syncedName !== existing.name;

    if (shouldBootstrapAdmin || needsIdentitySync) {
      await convexMutation("users:ensureUser", {
        clerkId: userId,
        email: syncedEmail,
        name: syncedName,
        requestedRole: existing.role,
        bootstrapAdmin: shouldBootstrapAdmin,
      });

      const refreshed = await convexQuery<
        { clerkId: string },
        {
          _id: string;
          role: Role;
          orgId: string;
          email: string;
          name: string;
          onboardingComplete?: boolean;
        } | null
      >("users:me", {
        clerkId: userId,
      });
      if (refreshed) {
        current = refreshed;
      }
    }

    return {
      clerkId: userId,
      email: current.email,
      name: current.name,
      role: current.role,
      orgId: current.orgId,
      userId: current._id,
      onboardingComplete: Boolean(current.onboardingComplete),
    };
  }

  const user = await currentUser();
  if (!user) {
    throw new Error(
      "AUTH_PROFILE_UNAVAILABLE: Signed-in Clerk user profile could not be loaded. Retry sign-in.",
    );
  }

  const email = user.emailAddresses[0]?.emailAddress ?? "unknown@example.com";
  const name = user.fullName ?? user.firstName ?? "Student";
  const bootstrapAdmin = getAdminEmails().has(email.toLowerCase()) || isSuperAdminEmail(email);

  return bootstrapActor({
    clerkId: userId,
    email,
    name,
    bootstrapAdmin,
  });
}

export async function requireSuperAdmin(): Promise<SessionActor> {
  const actor = await requireActor();
  if (!isSuperAdminEmail(actor.email)) {
    throw new Error("Super admin access required");
  }
  return actor;
}
