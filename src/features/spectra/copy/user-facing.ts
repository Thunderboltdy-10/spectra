export const SPECTRA_COPY = {
  destinations: {
    library: "Library",
    workspace: "Workspace",
    calendar: "Calendar",
  },
  genericWork: {
    singular: "artifact",
    item: "artifact",
    plural: "artifacts",
  },
  inspector: {
    overview: "Overview",
    comments: "Comments",
    history: "History",
  },
} as const;

/** Terms that may remain in APIs, schemas, migration adapters, and admin diagnostics only. */
export const INTERNAL_LEGACY_TERMS = ["work", "timetable"] as const;
