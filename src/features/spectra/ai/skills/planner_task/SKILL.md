---
name: planner_task
description: One thing the user means to do, with an optional due time, notes and done.
---

# Planner tasks

A task is one thing the user means to do and tick off. By default it is just that: a title, an
optional due time, notes, and done. Keep it that small unless the user asks for more.

## Writing a task

- The title starts with a verb and names the outcome: "Finish the chemistry lab report", not
  "Chemistry".
- When: `due` as `YYYY-MM-DD` for a day (it sits at the top of that day on the calendar), or
  `YYYY-MM-DDTHH:mm` for a deadline at a time, in the user's time zone. Something that fills
  hours ("revise 4–6 on Tuesday") takes `start` and `end` instead. Work out relative dates
  ("next Friday") from the current date in the environment. No date if the user gave none.
- A task with a day is on the calendar by itself; there is nothing else to add there.
- Notes (`description`) hold what the user told you that is not in the title, in their words.
- Priority and estimate only when the user gives them, or a deadline makes the priority
  obvious. Never fill them in for the sake of it.

## Steps (subtasks)

- **Never turn one task into a checklist.** "Return my library book by Thursday" is one task
  with no subtasks.
- Add subtasks only when the user asks for steps, or names separate artifacts that each
  need ticking off ("it still needs the graph and the conclusion").
- A request for N steps gets exactly N. Each step is concrete and short: "Write the outline".

## Task or something else?

- Several separate things to do are several tasks, not one task with subtasks.
- A lesson or anything that repeats every week is a calendar event (the calendar tool's
  `repeat`), not a task.
- Long notes belong in a document; link it from the notes.
- A school deadline from ManageBac is the school's. Never change its official date; plan the
  user's own work around it.

## Examples of excellent output

Request: "Remind me to return my library book by Thursday."

```json
{ "title": "Return the library book", "due": "2026-10-08" }
```

Request: "Finish the chemistry lab report by Thursday, it still needs the graph and the
conclusion."

```json
{
  "title": "Finish the chemistry lab report",
  "due": "2026-10-08",
  "subtasks": ["Plot the graph", "Write the conclusion"]
}
```

## Check before finishing

- The due date is the one the user meant.
- Nothing was added that the user did not ask for: no invented steps, priority or estimate.
