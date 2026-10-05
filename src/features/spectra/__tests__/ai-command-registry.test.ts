import { describe, expect, it } from "vitest";
import { APP_COMMANDS, appCommandById } from "../commands/app-registry";

describe("N8 app command registry", () => {
  it("contains one stable command record for navigation, organization, settings, calendar, and security", () => {
    expect(APP_COMMANDS.map((command) => command.id)).toEqual(
      expect.arrayContaining([
        "app.navigate",
        "app.work.open",
        "app.library.organize",
        "app.settings.change",
        "app.settings.manage-account",
        "app.calendar.open",
        "app.sync.policy.change",
        "app.memory.write",
        "app.sharing.change",
        "app.managebac.sync",
        "app.managebac.select-classes",
        "app.managebac.mapping",
        "app.reference.insert",
        "app.devices.pair",
        "app.security.credentials",
      ]),
    );
    expect(
      APP_COMMANDS.every((command) => Boolean(command.choreography?.target)),
    ).toBe(true);
  });

  it("records prohibited security actions instead of omitting them", () => {
    expect(appCommandById("app.devices.pair")).toMatchObject({
      aiAuthority: "allowed",
      risk: "confirm",
    });
    expect(
      appCommandById("app.security.credentials")?.availability({} as never),
    ).toEqual({
      state: "disabled",
      reason: "Credential changes are never AI-performable.",
    });
  });

  it("routes every allowed app command through the shared dispatcher", async () => {
    const dispatched: Array<[string, unknown]> = [];
    const context = {
      permissions: { editable: true },
      executeApplicationCommand: async (id: string, params: unknown) => {
        dispatched.push([id, params]);
      },
    } as never;
    const command = appCommandById("app.settings.change")!;
    await command.execute(context, { patch: { appearance: { density: "compact" } } });
    expect(dispatched).toEqual([
      ["app.settings.change", { patch: { appearance: { density: "compact" } } }],
    ]);
  });

  it("keeps navigation available in read-only contexts", () => {
    const readOnly = { permissions: { editable: false } } as never;
    expect(appCommandById("app.work.open")?.availability(readOnly)).toEqual({ state: "enabled" });
    expect(appCommandById("app.calendar.open")?.availability(readOnly)).toEqual({ state: "enabled" });
    expect(appCommandById("app.settings.manage-account")?.availability(readOnly)).toEqual({
      state: "enabled",
    });
  });
});
