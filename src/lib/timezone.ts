export function resolveSafeTimeZone(value: string | undefined, onWarning?: (warning: string) => void) {
  const fallback = "UTC";
  if (!value?.trim()) return fallback;

  try {
    Intl.DateTimeFormat("en-US", {
      timeZone: value,
    }).format(new Date());
    return value;
  } catch {
    onWarning?.(`Invalid IANA timezone "${value}" detected; falling back to UTC.`);
    return fallback;
  }
}

export function formatSchoolNow(timeZone: string | undefined, onWarning?: (warning: string) => void) {
  const safeTimeZone = resolveSafeTimeZone(timeZone, onWarning);
  return {
    timeZone: safeTimeZone,
    label: new Date().toLocaleString("en-US", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: safeTimeZone,
    }),
  };
}
