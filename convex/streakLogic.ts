export function dayKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

export function parseIsoDate(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

type StreakProgressInput = {
  currentStreak: number;
  longestStreak: number;
  lastActiveDate: string;
  activityDate: string;
};

type StreakProgressOutput =
  | {
      changed: false;
      reason: "invalid_activity_date" | "future_activity_date" | "already_recorded";
      currentStreak: number;
      longestStreak: number;
      lastActiveDate: string;
    }
  | {
      changed: true;
      reason: "first_activity_day" | "continued" | "reset_after_gap";
      currentStreak: number;
      longestStreak: number;
      lastActiveDate: string;
    };

export function computeStreakProgress(input: StreakProgressInput): StreakProgressOutput {
  const todayTs = parseIsoDate(input.activityDate);
  if (!todayTs) {
    return {
      changed: false,
      reason: "invalid_activity_date",
      currentStreak: input.currentStreak,
      longestStreak: input.longestStreak,
      lastActiveDate: input.lastActiveDate,
    };
  }

  const lastTs = parseIsoDate(input.lastActiveDate);
  const dayDiff = lastTs ? Math.round((todayTs - lastTs) / 86_400_000) : 0;

  if (dayDiff < 0) {
    return {
      changed: false,
      reason: "future_activity_date",
      currentStreak: input.currentStreak,
      longestStreak: input.longestStreak,
      lastActiveDate: input.lastActiveDate,
    };
  }

  if (dayDiff === 0) {
    if (input.currentStreak <= 0) {
      const currentStreak = 1;
      const longestStreak = Math.max(input.longestStreak, currentStreak);
      return {
        changed: true,
        reason: "first_activity_day",
        currentStreak,
        longestStreak,
        lastActiveDate: input.activityDate,
      };
    }

    return {
      changed: false,
      reason: "already_recorded",
      currentStreak: input.currentStreak,
      longestStreak: input.longestStreak,
      lastActiveDate: input.lastActiveDate,
    };
  }

  if (dayDiff === 1) {
    const currentStreak = input.currentStreak + 1;
    const longestStreak = Math.max(input.longestStreak, currentStreak);
    return {
      changed: true,
      reason: "continued",
      currentStreak,
      longestStreak,
      lastActiveDate: input.activityDate,
    };
  }

  const currentStreak = 1;
  const longestStreak = Math.max(input.longestStreak, currentStreak);
  return {
    changed: true,
    reason: "reset_after_gap",
    currentStreak,
    longestStreak,
    lastActiveDate: input.activityDate,
  };
}
