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
- Due: `YYYY-MM-DD` for a day, `YYYY-MM-DDTHH:mm` for a time, in the user's time zone. Work out
  relative dates ("next Friday") from the current date in the environment. No due date if the
  user gave none.
- Notes (`description`) hold what the user told you that is not in the title, in their words.
- Priority and estimate only when the user gives them, or a deadline makes the priority
  obvious. Never fill them in for the sake of it.

## Steps (subtasks)

- **Never turn one task into a checklist.** "Return my library book by Thursday" is one task
  with no subtasks.
- Add subtasks only when the user asks for steps, or names separate pieces of work that each
  need ticking off ("it still needs the graph and the conclusion").
- A request for N steps gets exactly N. Each step is concrete and short: "Write the outline".

## Task or something else?

- Several separate things to do are several tasks, not one task with subtasks.
- A time block without an outcome ("study maths 4–5") belongs on the calendar or in a timetable.
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
