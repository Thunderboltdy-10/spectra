/*
 * The school's people as the admin People tab reads them: members, the
 * invitations sent to bring more in, and the words each is shown with.
 */

export type SchoolRole = "student" | "teacher" | "school_admin";

export type Person = {
  membershipId: string;
  accountId: string;
  name: string;
  email: string;
  avatarUrl?: string;
  role: SchoolRole;
  status: "active" | "invited" | "suspended" | "ended";
  joinedAt?: number;
  lastSeenAt?: number;
};

export type Invitation = {
  invitationId: string;
  email: string;
  role: string;
  status: string;
  expiresAt: number;
  createdAt: number;
};

export const ROLE_OPTIONS = [
  { value: "student", label: "Student" },
  { value: "teacher", label: "Teacher" },
  { value: "school_admin", label: "School admin" },
] as const;

export const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  // `invited` is set by sending an invitation, never by an administrator
  // picking it, but it has to be visible or a pending member's row would show
  // no status at all.
  { value: "invited", label: "Invited", disabled: true },
  { value: "suspended", label: "Suspended" },
  { value: "ended", label: "Left the school" },
] as const;

export function roleName(role: string) {
  return ROLE_OPTIONS.find((option) => option.value === role)?.label ?? "Member";
}

const EMAIL = /[^\s@,;<>"'()]+@[^\s@,;<>"'()]+\.[^\s@,;<>"'()]+/g;

/**
 * The addresses in what someone typed or pasted: a list separated by commas,
 * semicolons, spaces or lines, or copied from a mail app as
 * "Name <name@school.org>". Repeats count once, in the order they came.
 */
export function readEmails(text: string) {
  return [...new Set((text.match(EMAIL) ?? []).map((email) => email.toLowerCase()))];
}
