import type { StudyMode } from "@/types";

export const PROMPT_TIPS: Record<StudyMode, string[]> = {
  auto: [
    "Just type naturally — the AI picks the best mode",
    "Try: 'Quiz me on photosynthesis' or 'Explain quantum mechanics'",
    "Attach files and images — the AI adapts automatically",
    "Be specific for better results",
  ],
  tutor: [
    "Show your attempt first for better guidance",
    "Ask about a specific concept you're struggling with",
    "Mention your grade level for tailored explanations",
    "Try: 'Help me understand why [X] happens'",
  ],
  marker: [
    "Paste your full answer for accurate grading",
    "Include the question prompt for rubric alignment",
    "Ask for specific feedback: structure, evidence, or analysis",
    "Try: 'Grade this essay and suggest improvements'",
  ],
  exam: [
    "Specify the topic and difficulty level",
    "Ask for timed practice sets with mark schemes",
    "Request specific question types: short answer, essay, MCQ",
    "Try: 'Give me 5 exam questions on [topic]'",
  ],
  draft_coach: [
    "Paste your draft for structural feedback",
    "Mention your target word count and format",
    "Ask about thesis strength or evidence quality",
    "Try: 'Improve the flow of this paragraph'",
  ],
  quiz: [
    "Specify the topic and number of questions",
    "Choose difficulty: basic, intermediate, or advanced",
    "Request specific formats: multiple choice or true/false",
    "Try: 'Quiz me on Newton's laws, 5 questions'",
  ],
  flashcard: [
    "Name the topic for targeted flashcards",
    "Specify how many cards you want (5-15 works best)",
    "Ask for bilingual cards if studying languages",
    "Try: 'Create 10 flashcards for photosynthesis'",
  ],
  research: [
    "Be specific about what you're researching",
    "Mention if you need citations or evidence",
    "Ask for multiple perspectives on a topic",
    "Try: 'Analyze the causes of [event] with evidence'",
  ],
  explain: [
    "Name the concept you want explained simply",
    "Mention what you already know for better context",
    "Ask for analogies or real-world examples",
    "Try: 'Explain quantum tunneling like I'm 10'",
  ],
  image: [
    "Describe the scene, style, and mood in one sentence",
    "Specify composition details like angle, lighting, and aspect ratio",
    "Mention what to avoid for cleaner outputs",
    "Try: 'Generate a cinematic lab scene with warm rim lighting'",
  ],
  document: [
    "Ask for the exact output: slides, study guide, report, or comparison table",
    "Specify audience, length, and tone so the export is usable immediately",
    "Mention whether you want bullets, speaker notes, or printable formatting",
    "Try: 'Make a presentation on plate tectonics for Year 9 students'",
  ],
  general: [
    "Ask anything - I'll find the best approach",
    "Be specific for better responses",
    "You can switch modes anytime for specialized help",
    "Try: 'Help me organize my study schedule'",
  ],
};

export function getRandomTip(mode: StudyMode): string {
  const tips = PROMPT_TIPS[mode];
  return tips[Math.floor(Math.random() * tips.length)];
}
