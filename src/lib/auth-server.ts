import { auth, currentUser } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { hasClerkServerConfig } from "@/lib/clerk-config";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import type { Role } from "@/types";

const SUPER_ADMIN_EMAIL = "pablo.martinez.dovale@gmail.com";

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
  return email.trim().toLowerCase() === SUPER_ADMIN_EMAIL;
}

export function isAdminLikeActor(actor: Pick<SessionActor, "role" | "email"> | { role: Role; email: string }) {
  return actor.role === "admin" || isSuperAdminEmail(actor.email);
}

async function bootstrapActor(params: {
  clerkId: string;
  email: string;
  name: string;
  bootstrapAdmin: boolean;
  orgId?: string;
}) {
  await convexMutation("users:ensureUser", {
    clerkId: params.clerkId,
    email: params.email,
    name: params.name,
    requestedRole: "student",
    bootstrapAdmin: params.bootstrapAdmin,
    orgId: params.orgId,
  });

  const me = await convexQuery<
    { clerkId: string; orgId?: string },
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
    orgId: params.orgId,
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

async function assertActiveOrgAccess(clerkId: string, orgId: string) {
  const access = await convexQuery<
    { clerkId: string; orgId: string },
    { hasUser: boolean; hasOrg: boolean; orgActive: boolean } | null
  >("users:accessState", {
    clerkId,
    orgId,
  });

  if (!access?.hasUser || !access.hasOrg) {
    throw new Error("AUTH_NO_ACCESS: Your account isn't linked to a school. Contact your school administrator.");
  }
  if (!access.orgActive) {
    throw new Error("AUTH_ORG_INACTIVE: Your school's workspace is currently inactive. Contact your administrator.");
  }
}

export async function requireActor(): Promise<SessionActor> {
  const cookieStore = await cookies();
  const activeOrgId = cookieStore.get("spectra_active_org_id")?.value;

  if (!hasClerkServerConfig()) {
    return bootstrapActor({
      clerkId: "local-demo-admin",
      email: "local-admin@school.local",
      name: "Local Demo Admin",
      bootstrapAdmin: true,
      orgId: activeOrgId,
    });
  }

  let userId: string | null = null;

  try {
    const authData = await auth();
    userId = authData.userId;
  } catch {
    throw new Error(
      "AUTH_MISCONFIGURED: Clerk auth failed. Check CLERK_SECRET_KEY and your Clerk publishable key env.",
    );
  }

  if (!userId) {
    throw new Error("AUTH_NOT_SIGNED_IN: Sign in to continue.");
  }

  const existing = await convexQuery<
    { clerkId: string; orgId?: string },
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
    orgId: activeOrgId,
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
      const emails = (profile?.emailAddresses ?? [])
        .map((entry) => entry.emailAddress?.trim().toLowerCase())
        .filter((value): value is string => Boolean(value));
      const profileEmail = emails[0];
      const profileName = profile?.fullName ?? profile?.firstName;
      if (profileEmail) {
        syncedEmail = profileEmail;
      }
      if (profileName) {
        syncedName = profileName;
      }
    }

    const superAdminByEmail = isSuperAdminEmail(syncedEmail);
    const shouldBootstrapAdmin = existing.role !== "admin" && superAdminByEmail;
    const access = (superAdminByEmail || activeOrgId)
      ? await convexQuery<
          { clerkId: string; orgId?: string },
          { hasUser: boolean; hasOrg: boolean; orgActive: boolean } | null
        >("users:accessState", {
          clerkId: userId,
          orgId: activeOrgId,
        })
      : null;
    const shouldRecoverMissingOrg = superAdminByEmail && !access?.hasOrg;
    const needsIdentitySync = syncedEmail !== existing.email || syncedName !== existing.name;

    if (shouldBootstrapAdmin || shouldRecoverMissingOrg || needsIdentitySync) {
      await convexMutation("users:ensureUser", {
        clerkId: userId,
        email: syncedEmail,
        name: syncedName,
        requestedRole: existing.role,
        bootstrapAdmin: shouldBootstrapAdmin || shouldRecoverMissingOrg,
        orgId: activeOrgId,
      });

      const refreshed = await convexQuery<
        { clerkId: string; orgId?: string },
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
        orgId: activeOrgId,
      });
      if (refreshed) {
        current = refreshed;
      }
    }

    if (!isSuperAdminEmail(current.email)) {
      await assertActiveOrgAccess(userId, current.orgId);
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

  const emails = user.emailAddresses
    .map((entry) => entry.emailAddress?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value));
  const email = emails[0] ?? "unknown@example.com";
  const name = user.fullName ?? user.firstName ?? "Student";
  const bootstrapAdmin = emails.some(isSuperAdminEmail);

  if (bootstrapAdmin) {
    return bootstrapActor({
      clerkId: userId,
      email,
      name,
      bootstrapAdmin,
      orgId: activeOrgId,
    });
  }

  throw new Error("AUTH_NO_ACCESS: Your account is not yet a member of a school.");
}

export async function requireSuperAdmin(): Promise<SessionActor> {
  const actor = await requireActor();
  if (!isSuperAdminEmail(actor.email)) {
    throw new Error("Super admin access required");
  }
  return actor;
}
