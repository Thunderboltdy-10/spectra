import { describe, expect, it } from "vitest";
import { createUserFacingSanitizer } from "@/app/api/spectra/run/loop/plan";

const convexId = "k17abcdefghijklmnopqrstuvwxyz012";

describe("user-facing id scrubber", () => {
  const clean = createUserFacingSanitizer({
    focusedArtifact: { id: convexId, content: { steps: [{ id: "step-1" }, { id: "summary" }] } },
  });

  it("returns AI-written code, lists and long words byte for byte", () => {
    const code = "def handleSubmitButtonClickEvent():\n    if ready:\n        return print()\n";
    const prose = "- item\n  - nested item\n\nPneumonoultramicroscopicsilicovolcanoconiosis is a long word.  Two spaces stay.";
    const digest = "sha1 = 2fd4e1c67a2d28fced849ee1bb76e7391b93eb12";
    expect(clean({ files: [{ path: "main.py", content: code }], text: prose, digest })).toEqual({
      files: [{ path: "main.py", content: code }], text: prose, digest,
    });
  });

  it("removes an internal id together with the wrapper that introduced it", () => {
    expect(clean(`Updated your notes (id: ${convexId}) and the deck.`)).toBe("Updated your notes and the deck.");
    expect(clean(`Opened ${convexId}, then saved.`)).toBe("Opened, then saved.");
    expect(clean("Next (step-1): verify recovery.")).toBe("Next: verify recovery.");
    // A plain-word id never deletes that word from prose.
    expect(clean("Read the summary first.")).toBe("Read the summary first.");
  });

  it("keeps id fields themselves", () => {
    expect(clean({ artifactId: convexId, title: `Deck ${convexId}` })).toEqual({ artifactId: convexId, title: "Deck" });
  });
});
