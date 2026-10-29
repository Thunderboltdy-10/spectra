/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import { bridgeKey, calendarFixture } from "../scripts/test-fixtures/managebac-calendar";

const modules = import.meta.glob("./**/*.ts");
const OPERATOR = { subject: "platform-operator", email: "operator@spectra.test", emailVerified: true };
const PUPIL = { subject: "school-pupil", email: "pupil@example.test", emailVerified: true };

beforeEach(() => {
  vi.stubEnv("SPECTRA_CONNECTOR_BRIDGE_KEY", bridgeKey);
  vi.stubEnv("SUPER_ADMIN_EMAILS", OPERATOR.email);
});
afterEach(() => vi.unstubAllEnvs());

/** The fixture's school, its admin, one pupil, and the platform operator (in no school). */
async function school() {
  const f = await calendarFixture(modules, "school_admin");
  const pupilId = await f.t.run(async (ctx) => {
    const now = Date.now();
    const accountId = await ctx.db.insert("accounts", {
      clerkId: PUPIL.subject, email: PUPIL.email, emailVerified: true, name: "Pupil", status: "active", createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("schoolMemberships", {
      schoolId: f.seed.schoolId, accountId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("accounts", {
      clerkId: OPERATOR.subject, email: OPERATOR.email, emailVerified: true, name: "Operator", status: "active", createdAt: now, updatedAt: now,
    });
    return accountId;
  });
  return { ...f, pupilId, pupil: f.t.withIdentity(PUPIL), operator: f.t.withIdentity(OPERATOR) };
}

describe("school and platform messages", () => {
  it("reaches only the people an admin names, and is read from their notifications", async () => {
    const f = await school();
    await f.user.mutation(api.administration.createAnnouncement, {
      title: "Your project", body: "Come and see me about it.", targetKind: "people", targetIds: [f.pupilId], sendNow: true,
    });
    const center = await f.pupil.query(api.notificationCenter.listMine, { unreadOnly: false, limit: 30 });
    expect(center.messages).toHaveLength(1);
    expect(center.messages[0]).toMatchObject({ title: "Your project", body: "Come and see me about it.", origin: "school", personal: true });
    // The admin who wrote it is not one of the people it went to.
    expect((await f.user.query(api.notificationCenter.listMine, { unreadOnly: false, limit: 30 })).messages).toHaveLength(0);

    await f.pupil.mutation(api.administration.markAnnouncementsRead, { deliveryIds: [center.messages[0].deliveryId] });
    const after = await f.pupil.query(api.notificationCenter.listMine, { unreadOnly: true, limit: 30 });
    expect(after.messages).toHaveLength(0);
    const sent = await f.user.query(api.administration.announcements, {});
    expect(sent[0]).toMatchObject({ targetKind: "people", read: 1, recipientNames: ["Pupil"] });
  });

  it("lets only the platform operator write to schools, and shows each school what Spectra sent", async () => {
    const f = await school();
    await expect(
      f.user.mutation(api.administration.sendPlatformMessage, { title: "Hello", body: "From Spectra", audience: "everyone" }),
    ).rejects.toThrow();

    const result = await f.operator.mutation(api.administration.sendPlatformMessage, {
      title: "Maintenance tonight", body: "Spectra pauses for ten minutes at 22:00.", audience: "admins",
    });
    expect(result).toMatchObject({ schools: 1, recipients: 1 });
    const admin = await f.user.query(api.notificationCenter.listMine, { unreadOnly: false, limit: 30 });
    expect(admin.messages[0]).toMatchObject({ title: "Maintenance tonight", origin: "platform", from: "Spectra" });
    // Admins only: the pupil hears nothing.
    expect((await f.pupil.query(api.notificationCenter.listMine, { unreadOnly: false, limit: 30 })).messages).toHaveLength(0);
    expect((await f.user.query(api.administration.announcements, {}))[0]).toMatchObject({ origin: "platform" });

    const history = await f.operator.query(api.administration.platformMessages, {});
    expect(history[0]).toMatchObject({ title: "Maintenance tonight", audience: "admins", schools: 1, recipients: 1, read: 0 });

    await f.operator.mutation(api.administration.sendPlatformMessage, {
      title: "Just you", body: "A word about your account.", audience: "person", email: PUPIL.email,
    });
    expect((await f.pupil.query(api.notificationCenter.listMine, { unreadOnly: false, limit: 30 })).messages[0]).toMatchObject({ title: "Just you", personal: true });
  });

  it("shows the operator one school whole: its admins, its people and what they changed", async () => {
    const f = await school();
    await f.user.mutation(api.administration.createAnnouncement, {
      title: "Welcome", body: "Welcome to Spectra.", targetKind: "school", targetIds: [], sendNow: true,
    });
    const detail = await f.operator.query(api.administration.schoolDetail, { schoolId: f.seed.schoolId });
    expect(detail).toMatchObject({
      people: { student: 1, school_admin: 1 },
      admins: [{ email: "student@example.test", status: "active" }],
      messagesThisMonth: 1,
    });
    expect(detail.recentActions.map((event) => event.action)).toContain("announcement.sent");
    await expect(f.user.query(api.administration.schoolDetail, { schoolId: f.seed.schoolId })).rejects.toThrow();
  });
});
