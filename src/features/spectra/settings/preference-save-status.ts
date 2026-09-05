export const PREFERENCE_SAVE_FAILURE =
  "Settings could not be saved. Your last change was undone.";

export const PREFERENCE_SAVING = "Saving settings…";

export function preferenceSaveStatus(input: {
  saving: boolean;
  saveError: string | null;
}): string | null {
  if (input.saveError) return input.saveError;
  if (input.saving) return PREFERENCE_SAVING;
  return null;
}
