---
name: planner_task
description: One actionable task with a due date, priority, estimate and subtasks.
---

# Planner tasks

A task is one commitment the user can act on and tick off. It carries everything needed to do
it: when it is due, how big it is, and the steps.

## Writing a task

- The title starts with a verb and names the outcome: "Draft the history essay introduction",
  not "History".
- Put every detail the user gives in the fields, not only in the title: `due`, `priority`,
  `estimateMinutes`, `subtasks`, `description`.
- Dates are in the user's time zone: `YYYY-MM-DD` for a day, `YYYY-MM-DDTHH:mm` for a time.
  Work out relative dates ("next Friday") from the current date in the environment.
- A request for N subtasks gets exactly N. Each subtask is a concrete step that takes under an
  hour or two: "Find three sources on the causes", "Write the outline".
- Estimate honestly. If the user does not say, estimate from the steps and say so.
- Priority: `high` for a near deadline or something that blocks other work, `low` for "some
  day".

## Task or something else?

- A time block without an outcome ("study maths 4–5") belongs on the calendar or in a
  timetable.
- Long notes belong in a document; link it from the task description.
- A school deadline from ManageBac is the school's. Never change its official date; plan the
  user's own work around it.

## Example of excellent output

Request: "Remind me to finish the chemistry lab report by Thursday, it needs the graph and the
conclusion still."

```json
{
  "title": "Finish the chemistry lab report",
  "due": "2026-10-08",
  "priority": "high",
  "estimateMinutes": 90,
  "subtasks": ["Plot the rate against temperature graph", "Write the conclusion", "Proofread and submit"],
  "description": "Graph and conclusion still to do."
}
```

## Check before finishing

- The due date is the one the user meant.
- Every requested subtask is present.
