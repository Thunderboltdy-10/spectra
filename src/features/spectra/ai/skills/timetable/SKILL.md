---
name: timetable
description: Timetables and study schedules as dated events in the user's time zone.
---

# Timetables

A timetable lays out time: lessons, study blocks, rehearsals, a revision plan. Each item has a
real start and end in the user's time zone.

## Planning a schedule

- Work out the dates from the current date and the user's time zone in the environment. "This
  week" is the week that contains today.
- Respect fixed commitments first: classes, deadlines the user mentions, sleep and meals.
- Study blocks of 25–50 minutes with breaks work better than three-hour marathons.
- Spread revision of one subject across days (spaced practice) rather than one long block.
- Put the hardest work where the user says they focus best; otherwise earlier in the day.
- Leave slack: a plan with no free time breaks on the first surprise.

## Writing events

- Titles say what happens: "Chemistry: past paper 2", not "Study".
- Every event has `start` and `end` with the user's UTC offset, for example
  `2026-10-05T16:00:00+02:00`.
- Put the place in `location` and anything to bring or prepare in `notes`.

## Timetable or calendar?

A timetable is a piece of work the user can share and edit. If the user wants something on
their own calendar ("remind me", "block out Thursday"), use the calendar tools instead.

## Check before finishing

- No events overlap unless the user asked for that.
- Every end is after its start, and the dates fall in the range the user meant.
- Tell the user the plan in a sentence or two: when the blocks are and why.
