import { describe, expect, it } from "vitest";
import { claimsUnsavedWork } from "@/app/api/spectra/run/loop/completion";

describe("claimsUnsavedWork", () => {
  it.each([
    "I've updated your notes.",
    "Done! I created a flashcard deck on cell biology.",
    "I have added three events to your calendar.",
    "Your quiz has been saved.",
    "We've now renamed the workspace to Biology.",
  ])("flags a claim of saved work: %s", (text) => {
    expect(claimsUnsavedWork(text)).toBe(true);
  });

  it.each([
    "I've written a summary below.",
    "Photosynthesis was discovered over centuries. Chlorophyll is created in chloroplasts.",
    "I can create a flashcard deck for this if you want.",
    "Here are five practice questions.",
    "The notes are saved automatically when you edit them.",
  ])("leaves answers that claim no save alone: %s", (text) => {
    expect(claimsUnsavedWork(text)).toBe(false);
  });
});
