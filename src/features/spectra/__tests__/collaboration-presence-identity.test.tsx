// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  CollaborationPresenceIndicator,
  presenceColor,
} from "../components/collaboration-presence";
import {
  PRESENCE_PALETTE,
  presenceColor as actorPresenceColor,
} from "../collaboration/interaction-model";
import type { CollaborationPresence } from "../collaboration/types";

afterEach(cleanup);

const nadia: CollaborationPresence = {
  clientId: "client-nadia",
  accountId: "account-nadia",
  name: "Nadia Park",
  actorKind: "human",
};

describe("collaborator identity", () => {
  it("paints an idle person in their palette colour, the same one their interaction frames use", () => {
    const expected = actorPresenceColor({
      clientId: nadia.clientId,
      kind: "human",
      name: "Nadia Park",
      accountId: "account-nadia",
    });
    expect(PRESENCE_PALETTE).toContain(expected);
    // Before: no client publishes `color`, so an idle person fell back to grey
    // while the interaction layer drew them in their palette colour.
    expect(presenceColor(nadia)).toBe(expected);
    expect(presenceColor({ ...nadia, clientId: "another-tab" })).toBe(expected);
  });

  it("lists people in a dismissible popover rather than a hand-rolled panel", () => {
    render(
      <CollaborationPresenceIndicator
        presence={[nadia]}
        currentClientId="me"
        regions={[]}
      />,
    );
    const trigger = screen.getByRole("button", {
      name: "1 collaborator present",
    });
    fireEvent.click(trigger);
    expect(screen.getByText("People here")).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    expect(screen.queryByText("People here")).toBeNull();
  });
});
