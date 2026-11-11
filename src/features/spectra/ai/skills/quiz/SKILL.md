---
name: quiz
description: Practice quizzes with checked answers, plausible distractors and teaching explanations.
---

# Quizzes

A Spectra quiz is practice: it shows learners what they know and teaches through feedback. It
is never a graded or high-stakes test.

## Choosing question types

| Type | Use it for |
| --- | --- |
| `multiple_choice` | One right answer among plausible options |
| `select_all` | Several correct options; say "Select all that apply" |
| `true_false` | Quick checks of a single claim; use sparingly |
| `short_answer` / `fill_blank` | Recall of a term without options to lean on. `correctAnswer` is the shortest right answer ("36 cm"); the reasoning goes in `explanation` |
| `numeric` | Calculations; state the unit in the prompt |
| `ordering` | Sequences: stages, events, steps |
| `matching` | Pairs: terms and definitions, causes and effects |
| `long_response` | Explanation or argument, with guidance on a good answer |

## Writing questions

- The prompt has one clear question and everything needed to answer it.
- For `multiple_choice`, `answer` is exactly the text of one option.
- Distractors are wrong for a reason a learner might believe: a common misconception, a
  related term, a calculation slip. Avoid joke options and "all of the above".
- Keep options similar in length and form, so the right one does not stand out.
- No two options may be the same answer in another form: 0.5 and 1/2, 50% and 0.5, 3 m and 3.0 m.
- The explanation teaches: why the right answer is right and why the tempting wrong answer is
  wrong.
- Mix recall with application and reasoning. Order questions from easier to harder.
- Honour the requested number of questions and difficulty.

## Example of excellent output

Request: "3 practice questions on Newton's second law."

```json
{
  "settings": { "instructions": "Use g = 9.8 m/s² where needed." },
  "items": [
    { "type": "multiple_choice", "prompt": "A 2 kg trolley accelerates at 3 m/s². What resultant force acts on it?",
      "options": ["1.5 N", "5 N", "6 N", "0.67 N"], "answer": "6 N",
      "explanation": "F = ma = 2 × 3 = 6 N. 1.5 N comes from dividing instead of multiplying." },
    { "type": "numeric", "prompt": "A 1,200 kg car's engine gives a resultant force of 3,000 N. What is its acceleration in m/s²?",
      "answer": 2.5, "explanation": "a = F / m = 3,000 / 1,200 = 2.5 m/s²." },
    { "type": "true_false", "prompt": "If the resultant force on a moving object is zero, the object stops.",
      "answer": "False", "explanation": "With no resultant force it keeps moving at a constant velocity (Newton's first law)." }
  ]
}
```

## Check before finishing

- Each answer is correct and is one of the options where options exist.
- No question has two defensible answers.
- Every question has an explanation.
