# Home

Home is the student's day. It has no search box or composer of its own: everything new starts from the island, and a
thread started or opened here takes the page in its place.

From the top:

1. **The greeting,** with one plain sentence about the day: what Spectra is working on, classes left today, and what
   is due next (`today-model.ts`).
2. **The morning brief** (below).
3. **The week,** a desk calendar laid open: today wide, the days after it narrower. Late and unplanned tasks are
   counted beside it.
4. **Pick up where you left off:** the latest works as index cards, beside **Threads** still going.

## The morning brief

The brief is waiting when the student wakes: a sun rising over the time they wake, yesterday in a few lines, and the
day's few moves, each one press away. It is written once a day. It cannot be written again; tomorrow brings the next.

- **What it says:**
  - **Yesterday:** two or three sentences about the threads and works the student touched.
  - **For today:** four or five moves, most useful first. The brief does the work where it can rather than only
    pointing at it. Each move is one of five kinds:
    - **Make it:** Spectra makes a work for what is coming, such as a quiz to revise for a test. The request goes to
      the island and is sent at once.
    - **Add task:** a task the student does not have yet, with every detail filled in: title, notes, a dated and timed
      slot, an estimate and the steps. One press adds it as a planner task and opens it in the Side.
    - **Open task:** a late task or one due soon, which opens the task.
    - **Open:** an unfinished work to pick up, which opens it in the Side.
    - **Ask:** a question worth asking Spectra, put into the dock ready to send.
  - A move that was made or added shows as done for the rest of the day, and an added task opens from it.
- **Wake-up time:** set in Settings → Your day (07:00 by default), where the brief can also be turned off. Home keeps
  it as a schedule (`briefSchedules`) in the student's time zone.
- **When it is written:** a Convex cron (`dispatch-morning-briefs`, every ten minutes) hands each schedule that is due
  to `/api/spectra/brief` half an hour before the student wakes, signed like the other scheduled callbacks. The route
  writes as the student, so it reads only what they may read: threads, works, the calendar and school tasks. If the
  scheduled write could not run (the student had no active session, or the scheduler is not set up), Home asks for
  the brief the first time it opens after the wake-up time.
- **Model:** the route asks the model once, at `medium` reasoning. It uses `SPECTRA_DAILY_MODEL_ID` when that is set,
  and the primary model otherwise. Moves that name an id not in the context, or a draft without a title, are dropped.
- **Storage:** `dailyBriefs` holds one row per account, for the current day only. The next day's claim replaces it,
  so yesterday's brief is never kept. The claim lets one writer through. A failed brief is tried again after fifteen
  minutes.
