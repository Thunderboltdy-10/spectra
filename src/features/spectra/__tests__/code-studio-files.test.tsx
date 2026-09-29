// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodeStudio } from "../components/code-studio";
import {
  StudioContractProvider,
  type StudioContract,
} from "../components/artifact-studio-shell";
import { normalizeCodeContent } from "../code/model";

vi.mock("../settings/preference-store", () => ({
  useSpectraPreferences: () => ({
    preferences: { workbar: {}, writing: { smartCompletion: false } },
    hydrated: true,
    update: () => {},
    replace: () => {},
    reset: () => {},
  }),
}));

const contract: StudioContract = {
  artifactId: "code-1",
  type: "code",
  role: "edit",
  can: () => true,
  modes: [],
  readOnly: false,
  surface: "full",
  sync: { state: "saved", label: "Saved" },
  responsive: {
    minInlineSize: 320,
    preferredInlineSize: 960,
    supportsPanel: true,
    supportsTile: true,
    supportsCompact: true,
    toolbarPriorities: [],
    canvasExtent: "infinite",
  },
  density: "comfortable",
  compatibilityProfile: "spectra-native",
  fidelity: { artifact: "NATIVE" },
  inspector: { open: null, show: () => {}, hide: () => {} },
};

beforeEach(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CodeStudio file operations", () => {
  it("adds a file from the Files rail", async () => {
    let latest: unknown = null;
    function Host() {
      const [content, setContent] = useState<unknown>(
        normalizeCodeContent({
          runtime: "none",
          files: [{ id: "file-1", path: "index.js", source: "console.log(1);" }],
          entryFileId: "file-1",
        }),
      );
      return (
        <StudioContractProvider value={contract}>
          <CodeStudio
            artifactId="code-1"
            artifacts={[]}
            title="Code"
            content={content}
            onChange={(next) => {
              latest = next;
              setContent(next);
            }}
            readOnly={false}
            synchronizationReady
          />
        </StudioContractProvider>
      );
    }
    render(<Host />);

    fireEvent.click(screen.getAllByRole("button", { name: /Add file/ })[0]!);
    const path = await screen.findByPlaceholderText("src/chart.tsx");
    fireEvent.change(path, { target: { value: "src/util.js" } });
    fireEvent.keyDown(path, { key: "Enter" });

    await waitFor(() =>
      expect(
        normalizeCodeContent(latest).files.map((file) => file.path),
      ).toEqual(["index.js", "src/util.js"]),
    );
    expect(screen.queryByPlaceholderText("src/chart.tsx")).toBeNull();
  });

  // In a side panel there is no Files rail. New file and Rename still work:
  // the workbar offers them and the path form opens above the editor.
  function PanelHost({ onContent }: { onContent: (next: unknown) => void }) {
    const [content, setContent] = useState<unknown>(
      normalizeCodeContent({
        runtime: "none",
        files: [{ id: "file-1", path: "index.js", source: "console.log(1);" }],
        entryFileId: "file-1",
      }),
    );
    return (
      <StudioContractProvider value={{ ...contract, surface: "panel" }}>
        <CodeStudio
          artifactId="code-1"
          artifacts={[]}
          title="Code"
          content={content}
          onChange={(next) => {
            onContent(next);
            setContent(next);
          }}
          readOnly={false}
          synchronizationReady
        />
      </StudioContractProvider>
    );
  }

  async function chooseWorkbarAction(name: string, tab?: string) {
    if (tab) {
      await act(async () => {
        fireEvent.click(screen.getByRole("tab", { name: tab }));
      });
    }
    const direct = screen.queryByRole("button", { name });
    if (direct) {
      fireEvent.click(direct);
      return;
    }
    const more = screen.getAllByRole("button", { name: /More/ })[0]!;
    await act(async () => {
      fireEvent.keyDown(more, { key: "Enter" });
    });
      await act(async () => {
      fireEvent.click(await screen.findByRole("menuitem", { name: new RegExp(name) }));
    });
  }

  it("adds a file in a side panel, without the Files rail", async () => {
    let latest: unknown = null;
    render(<PanelHost onContent={(next) => (latest = next)} />);
    expect(screen.queryByRole("button", { name: /Add file/ })).toBeNull();

    await chooseWorkbarAction("New file");
    const path = await screen.findByPlaceholderText("src/chart.tsx");
    fireEvent.change(path, { target: { value: "src/util.js" } });
    fireEvent.keyDown(path, { key: "Enter" });

    await waitFor(() =>
      expect(normalizeCodeContent(latest).files.map((file) => file.path)).toEqual(["index.js", "src/util.js"]),
    );
    expect(screen.queryByPlaceholderText("src/chart.tsx")).toBeNull();
  });

  it("renames the open file in a side panel", async () => {
    let latest: unknown = null;
    render(<PanelHost onContent={(next) => (latest = next)} />);

    await chooseWorkbarAction("Rename file");
    const path = await screen.findByDisplayValue("index.js");
    fireEvent.change(path, { target: { value: "main.js" } });
    fireEvent.keyDown(path, { key: "Enter" });

    await waitFor(() => expect(normalizeCodeContent(latest).files.map((file) => file.path)).toEqual(["main.js"]));
  });
});
