import { auth, currentUser } from "@clerk/nextjs/server";
import { getAdminEmails } from "@/lib/env";
import { hasClerkServerConfig } from "@/lib/clerk-config";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { clearInvitationTracking, getInvitationCookies } from "@/lib/invitation-flow";
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

export function isAdminLikeActor(actor: Pick<SessionActor, "role" | "email"> | { role: Role; email: string }) {
  return actor.role === "admin" || isSuperAdminEmail(actor.email);
}

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

async function acceptInvitationFromCookie(params: {
  clerkId: string;
  emails: string[];
  name: string;
}) {
  const { handoffToken, token } = await getInvitationCookies();
  const invitationToken = handoffToken ?? token;
  if (!invitationToken) {
    return "missing" as const;
  }

  for (const candidateEmail of params.emails) {
    try {
      await convexMutation("users:acceptInvitationByToken", {
        clerkId: params.clerkId,
        email: candidateEmail,
        name: params.name,
        token: invitationToken,
      });
      await clearInvitationTracking();
      return "accepted" as const;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!message.startsWith("INVITATION_EMAIL_MISMATCH")) {
        throw error;
      }
    }
  }

  return "mismatch" as const;
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
    let profileEmails: string[] = [existing.email];

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
      if (emails.length > 0) {
        profileEmails = emails;
      }
      if (profileEmail) {
        syncedEmail = profileEmail;
      }
      if (profileName) {
        syncedName = profileName;
      }
    }

    const superAdminByEmail = isSuperAdminEmail(syncedEmail);
    const shouldBootstrapAdmin = existing.role !== "admin" && superAdminByEmail;
    const access = superAdminByEmail
      ? await convexQuery<
          { clerkId: string },
          { hasUser: boolean; hasOrg: boolean; orgActive: boolean } | null
        >("users:accessState", {
          clerkId: userId,
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

    if (!current.orgId) {
      const invitationResult = await acceptInvitationFromCookie({
        clerkId: userId,
        emails: profileEmails,
        name: syncedName,
      });
      if (invitationResult === "accepted") {
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
    }

    if (!isSuperAdminEmail(current.email)) {
      await assertActiveOrgAccess(userId);
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
  const bootstrapAdmin = emails.some((candidate) => getAdminEmails().has(candidate) || isSuperAdminEmail(candidate));

  if (bootstrapAdmin) {
    return bootstrapActor({
      clerkId: userId,
      email,
      name,
      bootstrapAdmin,
    });
  }

  const invitationResult = await acceptInvitationFromCookie({
    clerkId: userId,
    emails,
    name,
  });
  if (invitationResult === "accepted") {
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
      if (!isSuperAdminEmail(provisioned.email)) {
        await assertActiveOrgAccess(userId);
      }
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

  // Fallback: If no invitation was found or accepted, but the user might already
  // exist in the database (e.g. manually added by email), try to link them.
  try {
    const recovered = await convexMutation<
      { clerkId: string; email: string; name: string; bootstrapAdmin: boolean },
      {
        _id: string;
        clerkId: string;
        email: string;
        name: string;
        role: Role;
        orgId: string;
        onboardingComplete?: boolean;
      } | null
    >("users:ensureUser", {
      clerkId: userId,
      email,
      name,
      bootstrapAdmin: false,
    });
    if (recovered && recovered.orgId) {
      if (!isSuperAdminEmail(recovered.email)) {
        await assertActiveOrgAccess(userId);
      }
      return {
        clerkId: userId,
        email: recovered.email,
        name: recovered.name,
        role: recovered.role,
        orgId: recovered.orgId,
        userId: recovered._id,
        onboardingComplete: Boolean(recovered.onboardingComplete),
      };
    }
  } catch (error) {
    // If ensureUser fails (e.g. no orgId found for this email either),
    // we fall through to the final error.
  }

  if (invitationResult === "mismatch") {
    throw new Error("AUTH_NO_ACCESS: This invitation belongs to a different email address.");
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
