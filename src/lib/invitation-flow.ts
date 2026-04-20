import { cookies } from "next/headers";

export const INVITATION_TOKEN_COOKIE = "ai-school-invitation-token";
export const INVITATION_HANDOFF_COOKIE = "ai-school-invitation-handoff";
export const INVITATION_TOKEN_MAX_AGE = 60 * 60 * 24;
export const INVITATION_HANDOFF_MAX_AGE = 60 * 15;

export type InvitationSnapshot = {
  token: string;
  status: string;
  email: string;
  role: string;
  orgId: string;
  expiresAt: number;
  orgName?: string;
  orgWelcomeMessage?: string;
  orgLogoUrl?: string;
};

export type InvitationAuthState =
  | "token_missing"
  | "token_invalid"
  | "token_expired"
  | "token_valid_signed_out"
  | "token_valid_signed_in_wrong_identity"
  | "token_valid_signed_in_match_pending_redeem"
  | "token_redeemed"
  | "token_already_redeemed_same_user"
  | "token_already_redeemed_other_user";

export type InvitationAuthStatePayload = {
  state: InvitationAuthState;
  invitation: InvitationSnapshot | null;
  invitedEmail: string | null;
  viewer: {
    userId: string | null;
    primaryEmail: string | null;
    emails: string[];
  };
  handoffToken: string | null;
  shouldAutoRedirectToAuth: boolean;
  canRedeemNow: boolean;
};

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeInvitation(input: Omit<InvitationSnapshot, "token"> | InvitationSnapshot | null, token: string): InvitationSnapshot | null {
  if (!input) return null;
  return {
    token,
    status: input.status,
    email: normalizeEmail(input.email),
    role: input.role,
    orgId: input.orgId,
    expiresAt: input.expiresAt,
    orgName: input.orgName,
    orgWelcomeMessage: input.orgWelcomeMessage,
    orgLogoUrl: input.orgLogoUrl,
  };
}

export function deriveInvitationAuthState(params: {
  invitation: InvitationSnapshot | null;
  userId: string | null;
  emails: string[];
  handoffToken?: string | null;
  tokenProvided?: boolean;
}): InvitationAuthStatePayload {
  const invitation = params.invitation;
  const emails = params.emails.map(normalizeEmail);
  const handoffToken = params.handoffToken ?? null;
  const viewer = {
    userId: params.userId,
    primaryEmail: emails[0] ?? null,
    emails,
  };

  if (!invitation) {
    return {
      state: params.tokenProvided === false ? "token_missing" : "token_invalid",
      invitation: null,
      invitedEmail: null,
      viewer,
      handoffToken,
      shouldAutoRedirectToAuth: false,
      canRedeemNow: false,
    };
  }

  if (Date.now() > invitation.expiresAt || invitation.status === "expired") {
    return {
      state: "token_expired",
      invitation,
      invitedEmail: invitation.email,
      viewer,
      handoffToken,
      shouldAutoRedirectToAuth: false,
      canRedeemNow: false,
    };
  }

  const hasMatchingEmail = emails.includes(invitation.email);

  if (invitation.status === "accepted") {
    return {
      state: hasMatchingEmail ? "token_already_redeemed_same_user" : "token_already_redeemed_other_user",
      invitation,
      invitedEmail: invitation.email,
      viewer,
      handoffToken,
      shouldAutoRedirectToAuth: Boolean(params.userId) ? false : true,
      canRedeemNow: false,
    };
  }

  if (!params.userId) {
    return {
      state: "token_valid_signed_out",
      invitation,
      invitedEmail: invitation.email,
      viewer,
      handoffToken,
      shouldAutoRedirectToAuth: true,
      canRedeemNow: false,
    };
  }

  if (!hasMatchingEmail) {
    return {
      state: "token_valid_signed_in_wrong_identity",
      invitation,
      invitedEmail: invitation.email,
      viewer,
      handoffToken,
      shouldAutoRedirectToAuth: true,
      canRedeemNow: false,
    };
  }

  return {
    state: "token_valid_signed_in_match_pending_redeem",
    invitation,
    invitedEmail: invitation.email,
    viewer,
    handoffToken,
    shouldAutoRedirectToAuth: false,
    canRedeemNow: true,
  };
}

export async function getInvitationCookies() {
  const cookieStore = await cookies();
  return {
    token: cookieStore.get(INVITATION_TOKEN_COOKIE)?.value ?? null,
    handoffToken: cookieStore.get(INVITATION_HANDOFF_COOKIE)?.value ?? null,
  };
}

export async function persistInvitationHandoff(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(INVITATION_HANDOFF_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: INVITATION_HANDOFF_MAX_AGE,
    path: "/",
  });
}

export async function clearInvitationTracking() {
  const cookieStore = await cookies();
  cookieStore.delete(INVITATION_TOKEN_COOKIE);
  cookieStore.delete(INVITATION_HANDOFF_COOKIE);
}
