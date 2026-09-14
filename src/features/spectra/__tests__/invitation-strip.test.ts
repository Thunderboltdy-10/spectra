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
    const chrome = readFileSync(
      path.join(process.cwd(), "src/components/layout/app-shell.tsx"),
      "utf8",
    );
    expect(chrome).toContain('router.push("/library?collection=invitations")');
    expect(shell).toContain(
      'searchParams.get("collection") === "invitations"',
    );
    expect(shell).toContain("getSpectraShareInvitations({ force })");
    expect(shell).toContain('spectraBus.on("notifications.changed"');
    expect(shell).toContain("refreshInvitations(true)");
    expect(strip).toContain("Nothing appears in your Library until you accept.");
    expect(strip).toContain("Accept");
    expect(strip).toContain("Decline");
  });

  it("excludes pending share invitations from Alerts unread Mark-read math", () => {
    const chrome = readFileSync(
      path.join(process.cwd(), "src/components/layout/app-shell.tsx"),
      "utf8",
    );
    expect(chrome).toMatch(
      /unreadCount = notifications\.filter\(\s*\(item\) => !item\.readAt && item\.kind !== "share"/,
    );
    expect(chrome).toContain('!item.readAt && item.kind !== "share"');
    // Accept path stays: share rows keep the invitations collection deep-link.
    expect(chrome).toContain('href: "/library?collection=invitations"');
    // Mark-read still no-ops shares (no schema readAt on shareInvitations).
    expect(chrome).toContain('if (item.kind === "share") return;');
    expect(chrome).not.toContain("markSpectraShareInvitationsRead");
  });
});
