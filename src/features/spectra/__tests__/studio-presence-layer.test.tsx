// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { CollaborationPresence } from "../collaboration/types";
import { idleState } from "../collaboration/interaction-model";

const store = vi.hoisted(() => ({ presence: [] as CollaborationPresence[] }));
vi.mock("../collaboration/scoped-hooks", () => ({ usePresence: () => store.presence }));
vi.mock("../components/collaboration-presence", () => ({
  CollaborationCursorLayer: ({ presence }: { presence: CollaborationPresence[] }) =>
    <div data-testid="native-carets">{presence.map(person => person.name).join(",")}</div>,
  CollaborationPresenceIndicator: () => null,
}));
import { StudioLegacyCursorLayer } from "../components/studio-presence-layer";

afterEach(cleanup);
const actor = { clientId: "teacher", kind: "human" as const, name: "Teacher" };
const native: CollaborationPresence = {
  clientId: actor.clientId, name: actor.name, actorKind: "human",
  selection: { kind: "text", collapsed: true, ranges: [{ blockId: "practice", startOffset: 12, endOffset: 12 }] },
};

it("keeps a native editor's caret when its generic interaction becomes idle", () => {
  store.presence = [{ ...native, interactionState: idleState(actor) }];
  const view = render(<StudioLegacyCursorLayer transport={null} />);
  expect(screen.getByTestId("native-carets").textContent).toBe("Teacher");
  store.presence = [{ ...native, interactionState: {
    ...idleState(actor), lifecycle: "active", act: { kind: "caret", point: { offset: 12 } },
    target: { artifactId: "work", primitive: "richtext", path: "/blocks/id:practice/text" },
  } }];
  view.rerender(<StudioLegacyCursorLayer transport={null} />);
  expect(screen.getByTestId("native-carets").textContent).toBe("");
});
