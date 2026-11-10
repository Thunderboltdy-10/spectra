// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EmbedFace } from "../components/artifact-embed-faces";
import type { SpectraArtifactEmbed } from "../data/api";

afterEach(cleanup);

describe.each(["compact", "expanded"] as const)("%s embedded flashcards", (mode) => {
  it("reveals the saved explanation with its answer and hides it on the next card", () => {
    const embed: SpectraArtifactEmbed = {
      embedId: "deck-embed", containerType: "thread", containerId: "thread",
      containerRegionId: "reply:run", sourceArtifactId: "deck", mode,
      interaction: "read", versionPolicy: "live", contextPolicy: "none", state: "ready",
      source: { artifactId: "deck", title: "French", blueprintKey: "flashcard_deck", snapshot: {
        content: { cards: [
          { front: "Correct the agreement", back: "Elles sont intéressantes.", explanation: "The adjective agrees with the feminine plural subject." },
          { front: "Too much homework", back: "Il y a trop de devoirs." },
        ] },
      } },
    };
    const original = structuredClone(embed);
    render(<EmbedFace embed={embed} />);
    expect(screen.queryByText(/The adjective agrees/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show the answer" }));
    expect(screen.getByText("Elles sont intéressantes.")).toBeTruthy();
    expect(screen.getByText("The adjective agrees with the feminine plural subject.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next card" }));
    expect(screen.queryByText(/The adjective agrees/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show the answer" }));
    expect(screen.getByText("Il y a trop de devoirs.")).toBeTruthy();
    expect(embed).toEqual(original);
  });
});
