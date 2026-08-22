import { describe, expect, it } from "vitest";
import { APP_COMMANDS, appCommandById } from "../commands/app-registry";

describe("N8 app command registry", () => {
  it("contains one stable command record for navigation, organization, settings, calendar, and security", () => {
    expect(APP_COMMANDS.map((command) => command.id)).toEqual([
      "app.work.open",
      "app.library.organize",
      "app.settings.change",
      "app.calendar.open",
      "app.bridge.pair",
      "app.security.credentials",
    ]);
    expect(
      APP_COMMANDS.every((command) => Boolean(command.choreography?.target)),
    ).toBe(true);
  });

  it("records prohibited security actions instead of omitting them", () => {
    expect(appCommandById("app.bridge.pair")).toMatchObject({
      aiAuthority: "prohibited",
    });
    expect(
      appCommandById("app.security.credentials")?.availability({} as never),
    ).toEqual({
      state: "disabled",
      reason: "Credential changes are never AI-performable.",
    });
  });
});
