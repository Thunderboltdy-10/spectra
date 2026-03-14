import { auth, currentUser } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { getAdminEmails } from "@/lib/env";
import { hasClerkServerConfig } from "@/lib/clerk-config";
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

const INVITATION_TOKEN_COOKIE = "ai-school-invitation-token";

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

async function assertActiveOrgAccess(clerkId: string) {
  const access = await convexQuery<
    { clerkId: string },
    { hasUser: boolean; hasOrg: boolean; orgActive: boolean } | null
  >("users:accessState", {
    clerkId,
  });

  if (!access?.hasUser || !access.hasOrg) {
    throw new Error("AUTH_NO_ACCESS: Your account isn't linked to a school. Contact your school administrator.");
  }
  if (!access.orgActive) {
    throw new Error("AUTH_ORG_INACTIVE: Your school's workspace is currently inactive. Contact your administrator.");
  }
}

export async function requireActor(): Promise<SessionActor> {
  if (!hasClerkServerConfig()) {
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
      "AUTH_MISCONFIGURED: Clerk auth failed. Check CLERK_SECRET_KEY and your Clerk publishable key env.",
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

    await assertActiveOrgAccess(userId);

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

  if (bootstrapAdmin) {
    return bootstrapActor({
      clerkId: userId,
      email,
      name,
      bootstrapAdmin,
    });
  }

  const invitationToken = (await cookies()).get(INVITATION_TOKEN_COOKIE)?.value;
  if (invitationToken) {
    await convexMutation("users:acceptInvitationByToken", {
      clerkId: userId,
      email,
      name,
      token: invitationToken,
    });

    const provisioned = await convexQuery<
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

    if (provisioned) {
      await assertActiveOrgAccess(userId);
      return {
        clerkId: userId,
        email: provisioned.email,
        name: provisioned.name,
        role: provisioned.role,
        orgId: provisioned.orgId,
        userId: provisioned._id,
        onboardingComplete: Boolean(provisioned.onboardingComplete),
      };
    }
  }

  throw new Error("AUTH_NO_ACCESS: Your account isn't linked to a school. Contact your school administrator.");
}

export async function requireSuperAdmin(): Promise<SessionActor> {
  const actor = await requireActor();
  if (!isSuperAdminEmail(actor.email)) {
    throw new Error("Super admin access required");
  }
  return actor;
}
