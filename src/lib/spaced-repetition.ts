export type SRSResult = {
  easeFactor: number;
  interval: number;
  repetitions: number;
  nextReviewAt: number;
};

export function calculateNextReview(
  quality: number,
  easeFactor: number,
  interval: number,
  repetitions: number,
  now = Date.now(),
): SRSResult {
  const q = Math.max(0, Math.min(5, Math.round(quality)));
  let ef = Math.max(1.3, easeFactor);
  let reps = Math.max(0, repetitions);
  let ivl = Math.max(0, interval);

  if (q < 3) {
    reps = 0;
    ivl = q <= 1 ? 0 : 1;
  } else {
    if (reps === 0) ivl = 1;
    else if (reps === 1) ivl = 6;
    else ivl = Math.round(ivl * ef);
    reps += 1;
  }

  ef = ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  ef = Math.max(1.3, Number(ef.toFixed(2)));

  return {
    easeFactor: ef,
    interval: ivl,
    repetitions: reps,
    nextReviewAt: now + ivl * 24 * 60 * 60 * 1000,
  };
}
