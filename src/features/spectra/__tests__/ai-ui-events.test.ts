// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { handleSpectraAiUiEvent } from "../collaboration/ai-ui-events";
import {
  __resetFollowAi,
  getAiSurfaceLocation,
  setFollowingAi,
} from "../collaboration/follow-ai";

describe("AI UI events", () => {
  beforeEach(() => __resetFollowAi());

  it("remembers semantic navigation without moving a non-followed viewport", () => {
    const navigated: string[] = [];
    window.addEventListener("spectra:ai-navigate", (event) => {
      navigated.push((event as CustomEvent<{ route: string }>).detail.route);
    });

    handleSpectraAiUiEvent({
      key: "navigate",
      payload: { destination: "settings", targetId: "toolbar" },
    });

    expect(navigated).toEqual([]);
    expect(getAiSurfaceLocation()).toMatchObject({
      route: "settings",
      target: "toolbar",
    });

    setFollowingAi(true);
    expect(navigated).toEqual(["settings"]);
  });

  it("opens an artifact only after Follow AI is enabled", () => {
    const opened: string[] = [];
    window.addEventListener("spectra:open-artifact", (event) => {
      opened.push((event as CustomEvent<{ artifactId: string }>).detail.artifactId);
    });

    handleSpectraAiUiEvent({
      key: "navigate",
      payload: { destination: "artifact", targetId: "artifact-7" },
    });
    expect(opened).toEqual([]);

    setFollowingAi(true);
    expect(opened).toEqual(["artifact-7"]);
  });

  it("projects Library and settings mutations into semantic surfaces", () => {
    handleSpectraAiUiEvent({
      key: "organize_library",
      payload: { targetId: "folder-1", note: "Created Sources" },
    });
    expect(getAiSurfaceLocation()).toMatchObject({
      route: "library",
      target: "folder-1",
      note: "Created Sources",
    });
    handleSpectraAiUiEvent({
      key: "settings_changed",
      payload: { note: "Updated toolbar" },
    });
    expect(getAiSurfaceLocation()).toMatchObject({
      route: "settings",
      target: "preferences",
      note: "Updated toolbar",
    });
  });
});
