"use client";

import { inkStyle, useClassBook } from "@/features/spectra/school/use-class-book";
import { DEADLINES } from "../world/school";
import { dayName } from "../world/story";
import { CLASSES, WORKS } from "../world/works";
import { StoryCards } from "./story-card";

/*
 * Henry's Library, as the page inside the one tab: his classes in their inks,
 * his works as Spectra's own cards, and what ManageBac says is due, side by
 * side, where the twelve tabs used to be.
 */

const SHELF = [WORKS.notes, WORKS.ia, WORKS.sheet, WORKS.essay];
const DUE = [DEADLINES.biologyTest, DEADLINES.problemSet, DEADLINES.essay];

export function LibraryView() {
  const book = useClassBook();
  return (
    <div className="lw-lib">
      <header className="lw-lib-head">
        <h3>Library</h3>
        <p>Your classes, your files and what you make, in one place.</p>
      </header>
      <ul className="lw-lib-classes" aria-label="Classes">
        {Object.values(CLASSES).map((entry) => (
          <li key={entry.workspaceId} style={inkStyle(book.of(entry.providerClassId, entry.title))}>
            <i aria-hidden />
            <span>{entry.title}</span>
            <small>{entry.teacher}</small>
          </li>
        ))}
      </ul>
      <div className="lw-lib-body">
        <StoryCards works={SHELF} className="lw-lib-cards" />
        <aside className="lw-lib-due" aria-label="Due, from ManageBac">
          <p>Due, from ManageBac</p>
          <ul>
            {DUE.map((task) => (
              <li key={task.id} style={inkStyle(book.of(task.classId ?? null, null))}>
                <i aria-hidden />
                <span>{task.title}</span>
                <time>{dayName(task.startAt!)}</time>
              </li>
            ))}
          </ul>
          <p className="lw-lib-laptop">
            <span className="piece-file-icon" data-kind="folder" aria-hidden />
            History, on Henry&rsquo;s laptop
          </p>
        </aside>
      </div>
    </div>
  );
}
