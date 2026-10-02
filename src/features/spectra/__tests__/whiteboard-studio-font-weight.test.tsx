// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WhiteboardStudio } from "../components/whiteboard-studio";
import {
  StudioContractProvider,
  type StudioContract,
} from "../components/artifact-studio-shell";
import { normalizeWhiteboardContent } from "../whiteboard/model";

vi.mock("convex/react", () => ({ useMutation: () => vi.fn(async () => ({})) }));
vi.mock("../data/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../data/api")>()),
  getArtifactAssets: vi.fn(async () => ({ assets: [] })),
}));
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
  artifactId: "board-1",
  type: "whiteboard",
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
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("whiteboard font weight rendering", () => {
  it.each([
    ["bold", undefined, "bold"],
    ["normal", undefined, "normal"],
    ["bolder", undefined, "bolder"],
    ["lighter", undefined, "lighter"],
    ["550", undefined, "550"],
    [400, "bold", "400"],
    [undefined, "bold", "bold"],
    [undefined, "normal", "normal"],
    ["invalid", undefined, "650"],
    [0, undefined, "650"],
    [1001, undefined, "650"],
    [undefined, undefined, "650"],
  ])("renders style %s / content %s as %s without invalid CSS", async (styleWeight, contentWeight, expected) => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const content = normalizeWhiteboardContent({ nodes: [{
      id: "concept", type: "text", content: { text: "A concept", fontWeight: contentWeight },
      style: { fontWeight: styleWeight },
    }] });
    await act(async () => {
      render(<StudioContractProvider value={contract}>
        <WhiteboardStudio artifactId="board-1" artifacts={[]} content={content} onChange={() => {}} readOnly={false} />
      </StudioContractProvider>);
    });
    const textbox = screen.getAllByRole("textbox").find(element => (element as HTMLTextAreaElement).value === "A concept")!;
    expect(textbox.style.fontWeight).toBe(expected);
    expect(errors.mock.calls.filter(call => call.some(value => String(value).includes("NaN") || String(value).includes("fontWeight")))).toEqual([]);
  });
});
