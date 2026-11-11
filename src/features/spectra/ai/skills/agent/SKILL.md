---
name: agent
description: Custom agents: purpose, instructions, scope, tone and when Spectra should route to them.
---

# Agents

An agent is a reusable specialist: Spectra hands it a conversation when its purpose fits. Its
definition is a purpose, instructions and boundaries, written so another model can follow them
without guessing.

## Defining an agent

- **Purpose:** one sentence on the job and who it serves. "Coaches Year 12 students through
  IB Chemistry internal assessments."
- **Instructions:** prose in the second person, organised as: how to start, how to work, what
  good output looks like, what to avoid. Concrete beats abstract: give an example exchange
  when the style matters.
- **Scope:** `inScope` lists the requests it handles; `outOfScope` lists nearby requests it
  should hand back, so routing stays honest.
- **Tone and length:** pick `tone` and `responseLength` to fit the audience. A Socratic tutor
  asks before telling; a planner is direct.
- **Boundaries:** what it must never do, such as writing graded coursework for a student or giving
  medical advice.
- **Routing:** `routingDescription` says when Spectra should pick this agent;
  `routingExamples` are real-sounding requests that should route to it.
- **Skills:** add named skills only for distinct procedures the agent repeats.

## Writing good instructions

- Say what to do, not only what to avoid.
- Keep every rule actionable: "Ask which criterion the student is working on before giving
  feedback" rather than "Be helpful about criteria".
- Do not paste private documents into the instructions; reference the artifact the agent should
  use instead.
- Keep it short enough to read in two minutes.

## Example of excellent output

```json
{
  "purpose": "Helps students plan and draft history essays without writing them for them.",
  "instructions": "Start by asking for the essay question and the student's current thesis. Help them sharpen the thesis into an arguable claim. For each paragraph, ask for the evidence they plan to use and check it supports the claim. Point out gaps and counter-arguments; suggest sources to look for, never invent them. Give feedback as questions and short examples, and never write full paragraphs they could submit.",
  "audience": "Secondary school history students",
  "inScope": ["essay planning", "thesis feedback", "structuring arguments"],
  "outOfScope": ["writing full essays", "grading"],
  "tone": "socratic",
  "responseLength": "concise",
  "boundaries": ["Never write submittable essay text."],
  "routingDescription": "The user is planning, structuring or getting feedback on a history essay.",
  "routingExamples": ["Can you help me plan my essay on the causes of WW1?", "Is my thesis about the Cold War strong enough?"]
}
```

## Check before finishing

- The purpose, scope and routing agree with each other.
- Nothing in the instructions contradicts a boundary.
