import { spectraBus } from "@/features/spectra/events";
import type {
  SpectraArtifactCommentNotification,
  SpectraPlannerReminderNotification,
  SpectraSchoolMessage,
  SpectraShareInvitation,
  SpectraTimetableReminderNotification,
} from "@/features/spectra/data/api";

export const SHARE_INVITATIONS_HREF = "/library?collection=invitations";

export type ShellNotification = {
  id: string;
  kind: "comment" | "planner" | "timetable" | "share" | "message";
  artifactId: string;
  href?: string;
  title: string;
  detail: string;
  createdAt: number;
  readAt?: number;
  /** A message's own words, read in full when it is opened. */
  message?: SpectraSchoolMessage;
};

/**
 * When a reminder is due, in the reader's own date and clock conventions.
 * `locale` is only for tests; the browser's language decides in the product.
 */
export function formatNotificationTime(timestamp: number, locale?: string) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

/** Every notification source as one list, newest first. */
export function buildShellNotifications(
  sources: {
    comments: SpectraArtifactCommentNotification[];
    planner: SpectraPlannerReminderNotification[];
    timetable: SpectraTimetableReminderNotification[];
    invitations: SpectraShareInvitation[];
    messages?: SpectraSchoolMessage[];
  },
  locale?: string,
): ShellNotification[] {
  return [
    ...sources.comments.map((item) => ({
      id: item._id,
      kind: "comment" as const,
      artifactId: item.artifactId,
      title:
        item.kind === "mention"
          ? `${item.author?.name ?? "Someone"} mentioned you`
          : item.kind === "reply"
            ? `${item.author?.name ?? "Someone"} replied`
            : `New comment from ${item.author?.name ?? "a collaborator"}`,
      detail: `${item.artifact.title} · ${item.comment.body}`,
      createdAt: item.createdAt,
      readAt: item.readAt,
    })),
    ...sources.planner.map((item) => ({
      id: item._id,
      kind: "planner" as const,
      artifactId: item.artifactId,
      title: item.taskTitle,
      detail: `Due ${formatNotificationTime(item.dueAt, locale)}`,
      createdAt: item.createdAt,
      readAt: item.readAt,
    })),
    ...sources.timetable.map((item) => ({
      id: item._id,
      kind: "timetable" as const,
      artifactId: item.artifactId,
      title: item.eventTitle,
      detail: `${item.artifactTitle} · ${formatNotificationTime(item.occurrenceStart, locale)}`,
      createdAt: item.createdAt,
      readAt: item.readAt,
    })),
    ...sources.invitations.map((item) => ({
      id: item.invitationId,
      kind: "share" as const,
      artifactId: item.resourceId,
      href: SHARE_INVITATIONS_HREF,
      title: `${item.inviter?.name ?? "A collaborator"} shared ${item.resource.title}`,
      detail: `${item.level === "modify" ? "Can modify" : "Read-only"} access · Review invitation`,
      createdAt: item.createdAt,
      readAt: undefined,
    })),
    ...(sources.messages ?? []).map((item) => ({
      id: item.deliveryId,
      kind: "message" as const,
      artifactId: item.announcementId,
      title: item.title,
      detail: item.author ? `From ${item.author}, ${item.from}` : `From ${item.from}`,
      createdAt: item.createdAt,
      readAt: item.readAt,
      message: item,
    })),
  ].sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Open the pending share invitations. The Library listens for the event, so
 * Review works even when the invitations page is already the current URL and
 * navigating to it again would change nothing.
 */
export function reviewShareInvitations(router?: { push: (href: string) => void }) {
  spectraBus.emit("invitations.review", {});
  router?.push(SHARE_INVITATIONS_HREF);
}
