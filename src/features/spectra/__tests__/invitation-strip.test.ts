import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("share invitation inbox", () => {
  it("reopens and force-refreshes when Library collection=invitations is opened", () => {
    const shell = readFileSync(
      path.join(process.cwd(), "src/features/spectra/pages/spectra-shell.tsx"),
      "utf8",
    );
    const strip = readFileSync(
      path.join(
        process.cwd(),
        "src/features/spectra/components/invitation-strip.tsx",
      ),
      "utf8",
    );
    const notifications = readFileSync(
      path.join(process.cwd(), "src/components/layout/shell-notifications.ts"),
      "utf8",
    );
    const invitations = readFileSync(
      path.join(
        process.cwd(),
        "src/features/spectra/pages/use-share-invitations.ts",
      ),
      "utf8",
    );
    expect(notifications).toContain(
      'SHARE_INVITATIONS_HREF = "/library?collection=invitations"',
    );
    expect(notifications).toContain("router?.push(SHARE_INVITATIONS_HREF)");
    expect(shell).toContain(
      'searchParams.get("collection") === "invitations"',
    );
    expect(shell).toContain("useShareInvitations(invitationCollection)");
    expect(invitations).toContain("getSpectraShareInvitations({ force })");
    expect(invitations).toContain('spectraBus.on("notifications.changed"');
    expect(invitations).toContain('spectraBus.on("invitations.review"');
    expect(invitations).toContain("refreshInvitations(true)");
    expect(strip).toContain("Nothing appears in your Library until you accept.");
    expect(strip).toContain("Accept");
    expect(strip).toContain("Decline");
  });

  it("excludes pending share invitations from Alerts unread Mark-read math", () => {
    const chrome = readFileSync(
      path.join(process.cwd(), "src/components/layout/use-shell-notifications.ts"),
      "utf8",
    );
    expect(chrome).toMatch(
      /unreadCount = items\.filter\(\(item\) => !item\.readAt && item\.kind !== "share"/,
    );
    expect(chrome).toContain('!item.readAt && item.kind !== "share"');
    // Accept path stays: share rows keep the invitations collection deep-link.
    const notifications = readFileSync(
      path.join(process.cwd(), "src/components/layout/shell-notifications.ts"),
      "utf8",
    );
    expect(notifications).toContain("href: SHARE_INVITATIONS_HREF");
    // Mark-read still no-ops shares (no schema readAt on shareInvitations).
    expect(chrome).toContain('if (item.readAt || item.kind === "share") return;');
    expect(chrome).not.toContain("markSpectraShareInvitationsRead");
  });
});
