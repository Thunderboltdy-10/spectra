// @vitest-environment jsdom

import { StrictMode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArtifactCollaborationTransport } from "../collaboration/types";
import { useArtifactLiveModel } from "../collaboration/use-artifact-live-model";
import {
  NATIVE_WORK_LIVE_META_MAP,
} from "../work/models/yjs/native-artifact-model";
import { workYjsAdapter } from "../work/models/yjs/registry";

let collaboration: Record<string, unknown>;

vi.mock("../collaboration/use-artifact-collaboration", () => ({
  useArtifactCollaboration: () => collaboration,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("artifact live-model lifecycle", () => {
  it("keeps exactly one update listener alive through Strict Mode and disposes it on unmount", async () => {
    const content = {
      workbook: { calculationMode: "automatic" as const, locale: "en-US" },
      activeSheetId: "sheet-1",
      sheets: [
        {
          id: "sheet-1",
          name: "Sheet 1",
          cells: { A1: { value: "Original" } },
          tables: [],
          charts: [],
          rowCount: 1,
          columnCount: 1,
        },
      ],
    };
    const document = workYjsAdapter("sheets").createDocument(content);
    const liveMeta = document.getMap<unknown>(NATIVE_WORK_LIVE_META_MAP);
    liveMeta.set("title", "Original title");
    liveMeta.set("summary", "");
    liveMeta.set("tags", []);
    const on = vi.spyOn(document, "on");
    const off = vi.spyOn(document, "off");
    const transport = {
      clientId: "strict-mode-client",
      document,
      getSnapshot: () => ({
        state: "synchronized" as const,
        level: "modify" as const,
        accountId: "account-1",
        displayName: "Pablo",
        unsynchronizedChanges: 0,
        presence: [],
      }),
    } as unknown as ArtifactCollaborationTransport;
    collaboration = {
      transport,
      state: "synchronized",
      level: "modify",
      accountId: "account-1",
      displayName: "Pablo",
      unsynchronizedChanges: 0,
      canEdit: true,
      // The real hook always reports local durability; a closed store has no draft branch.
      localDurability: { state: "closed", bytes: 0, pendingRemoteSync: false, restored: false },
      localPersistence: null,
    };

    function Probe() {
      const live = useArtifactLiveModel(
        "work-1",
        "sheets",
        { title: "Original title", tags: [], content },
        true,
      );
      return <output>{live.modelSnapshot.value?.title ?? "uninitialized"}</output>;
    }

    const mounted = render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    try {
      expect(screen.getByText("Original title")).toBeTruthy();
      document.transact(() => liveMeta.set("title", "Updated title"));
      await waitFor(
        () => expect(screen.getByText("Updated title")).toBeTruthy(),
        { timeout: 1_000 },
      );
      expect(on.mock.calls.filter(([event]) => event === "update")).toHaveLength(
        2,
      );
      expect(
        off.mock.calls.filter(([event]) => event === "update"),
      ).toHaveLength(1);
    } finally {
      mounted.unmount();
      expect(
        off.mock.calls.filter(([event]) => event === "update"),
      ).toHaveLength(2);
      document.destroy();
    }
  });
});
