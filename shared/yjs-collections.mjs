/** Empty identity lists must have their shared map before peers add an item. */
const IDENTITY_FIELDS = new Set([
  "tasks", "sections", "milestones", "views", "subtasks", "checklist",
  "attachments", "reminders", "cards", "questions", "slides", "objects",
  "pages", "layers", "files", "lessons", "events",
]);
export function isIdentityCollection(values, path, existingCollection = false) {
  return values.every(value => value && typeof value === "object" && !Array.isArray(value) && typeof value.id === "string") &&
    (values.length > 0 || existingCollection || IDENTITY_FIELDS.has(path.at(-1)));
}
