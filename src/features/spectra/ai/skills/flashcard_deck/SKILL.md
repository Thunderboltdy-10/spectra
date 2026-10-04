---
name: flashcard_deck
description: Active-recall flashcards, including cloze cards, that test one thing each.
---

# Flashcard decks

A flashcard asks the learner to retrieve one thing from memory. Good cards are small, specific
and unambiguous; a deck covers a topic without padding.

## Writing a card

- **One target per card.** "What are the four stages of mitosis?" is four targets; split it,
  or ask for the order: "Which stage of mitosis comes after metaphase?"
- **The front stands alone.** It gives enough context to have exactly one right answer:
  "In photosynthesis, which gas is released?", not "What is released?"
- **The back is short.** The answer first, then at most one sentence of explanation when it
  helps correct a mistake.
- **Hints** are optional cues that make retrieval easier without giving the answer away.
- **Mix kinds of question** where the topic allows: definition, application ("A cell is placed
  in salt water. What happens?"), comparison and common misconceptions.
- **Cloze cards** hide a key term in a sentence: `{{c1::Mitochondria}} release energy by
  aerobic respiration.` Hide the word that matters, not a filler word, and never leak the
  answer elsewhere on the card.
- Make a card reversible only when both directions are useful (a word and its translation).

## Building a deck

- Honour the requested number of cards exactly.
- List what the deck must cover before writing, so nothing important is missing and nothing
  is repeated.
- Group cards into sections when a deck covers several subtopics.
- Order from foundational to harder, so early cards support later ones.
- Load the `teaching` skill when building a deck from a whole unit or a source document.

## Example of excellent output

Request: "6 flashcards on the French Revolution causes."

```json
{
  "items": [
    { "front": "What were the three estates of pre-revolutionary France?", "back": "Clergy, nobility, and everyone else (the Third Estate)." },
    { "front": "Which estate paid most of the taxes before 1789?", "back": "The Third Estate.", "explanation": "The clergy and nobility were largely exempt." },
    { "front": "Why did Louis XVI call the Estates-General in 1789?", "back": "The crown was nearly bankrupt and needed new taxes." },
    { "front": "Name one way the American Revolution contributed to the French Revolution.", "back": "French support for it deepened the debt; it also spread ideas of rights and representation." },
    { "front": "{{c1::Enlightenment}} thinkers such as Rousseau questioned the divine right of kings.", "back": "Enlightenment" },
    { "front": "Misconception check: was the Revolution caused only by poverty?", "back": "No. Debt, unfair taxation, new ideas and a political crisis combined.", "hint": "Think of at least three causes." }
  ]
}
```

## Check before finishing

- Each card has one right answer and tests one thing.
- No two cards test the same fact in the same way.
- The count matches the request.
