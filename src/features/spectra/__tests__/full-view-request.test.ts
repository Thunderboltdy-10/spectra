import { describe, expect, it } from "vitest";
import { requestFullView, takeFullViewRequest } from "../components/full-view-origin";

/* F05: Open full from a conversation floating over Settings first landed on
   Library with the work still in its side panel. The press is now carried to
   the Library link once, so the work opens full on the first press. */
describe("Open full from another surface (F05)", () => {
  it("opens full once, and a plain Library link afterwards opens beside it", () => {
    requestFullView("work-1");
    expect(takeFullViewRequest("work-1")).toBe(true);
    expect(takeFullViewRequest("work-1")).toBe(false);
    expect(takeFullViewRequest("work-2")).toBe(false);
  });
});
