import { useCallback, useState } from "react";

/**
 * A key hint shown until it has done its job once on this device: after
 * that the hint is noise on every card. `markSeen` is cheap to call often.
 */
export function useOnceHint(key: string) {
  const [seen, setSeen] = useState(() => {
    try {
      return window.localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  });
  const markSeen = useCallback(() => {
    setSeen((current) => {
      if (current) return current;
      try {
        window.localStorage.setItem(key, "1");
      } catch {
        // Storage can be unavailable; the hint then shows again next visit.
      }
      return true;
    });
  }, [key]);
  return [seen, markSeen] as const;
}
