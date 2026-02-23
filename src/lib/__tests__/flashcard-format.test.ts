import { describe, expect, it } from "vitest";
import {
  countFlashcardPairs,
  extractFlashcardPairs,
  isFlashcardDeckStructured,
  normalizeFlashcardDeck,
} from "@/lib/flashcard-format";

describe("flashcard format parsing", () => {
  it("parses strict FRONT/BACK blocks", () => {
    const content = `FRONT: Newton's second law
BACK: Force equals mass times acceleration.

FRONT: Momentum
BACK: Product of mass and velocity.`;

    expect(countFlashcardPairs(content)).toBe(2);
    expect(isFlashcardDeckStructured(content)).toBe(true);
  });

  it("parses inline FRONT/BACK pairs", () => {
    const content =
      "FRONT: Bonjour BACK: Hello FRONT: Merci BACK: Thank you FRONT: Poubelle BACK: Bin FRONT: Manger sain BACK: Eat healthy";

    expect(countFlashcardPairs(content)).toBe(4);
  });

  it("parses multiline BACK entries", () => {
    const content = `FRONT: Mitochondria
BACK: The cell organelle where ATP is produced.
Also called the powerhouse in many school texts.

FRONT: Ribosome
BACK: Site of protein synthesis.`;

    const cards = extractFlashcardPairs(content);
    expect(cards).toHaveLength(2);
    expect(cards[0]?.back).toContain("ATP");
    expect(cards[0]?.back).toContain("powerhouse");
  });

  it("parses markdown tables with front/back columns", () => {
    const content = `| Front | Back |
| --- | --- |
| Photosynthesis | Process plants use to convert light into chemical energy |
| Chlorophyll | Green pigment that absorbs light |`;

    expect(countFlashcardPairs(content)).toBe(2);
  });

  it("parses numbered definition-style fallback lines", () => {
    const content = `1) Osmosis - Movement of water across a semipermeable membrane.
2) Diffusion - Movement of particles from high to low concentration.
3) Isotonic - Equal solute concentration across a membrane.`;

    expect(countFlashcardPairs(content)).toBe(3);
  });

  it("deduplicates repeated cards", () => {
    const content = `FRONT: Gravity
BACK: Attractive force between masses.

FRONT: Gravity
BACK: Attractive force between masses.`;

    expect(countFlashcardPairs(content)).toBe(1);
  });

  it("normalizes mixed-format decks into canonical FRONT/BACK output", () => {
    const content = `Here are your cards:
Card 1: FRONT: Atom BACK: Smallest unit of an element.

2) Molecule - Two or more atoms bonded together.
3) Ion - Atom with net electric charge.`;

    const normalized = normalizeFlashcardDeck(content);
    expect(normalized).toContain("FRONT: Atom");
    expect(normalized).toContain("BACK: Smallest unit of an element.");
    expect(normalized).toContain("FRONT: Molecule");
  });

  it("supports stricter minimum threshold checks", () => {
    const content = `FRONT: Derivative
BACK: Instantaneous rate of change.

FRONT: Integral
BACK: Accumulated area under a curve.

FRONT: Limit
BACK: Value a function approaches.`;

    expect(isFlashcardDeckStructured(content, 3)).toBe(true);
    expect(isFlashcardDeckStructured(content, 4)).toBe(false);
  });

  it("returns zero for content without parsable pairs", () => {
    const content = "This is an explanation paragraph without any card format.";
    expect(countFlashcardPairs(content)).toBe(0);
    expect(isFlashcardDeckStructured(content)).toBe(false);
  });

  it("extracts cards even when prose surrounds them", () => {
    const content = `Study these key facts first.

FRONT: Treaty of Versailles
BACK: 1919 peace treaty ending World War I.

Remember to review daily.
FRONT: League of Nations
BACK: International organization founded after WWI.`;

    const cards = extractFlashcardPairs(content);
    expect(cards).toHaveLength(2);
    expect(cards.map((card) => card.front)).toEqual(["Treaty of Versailles", "League of Nations"]);
  });
});
