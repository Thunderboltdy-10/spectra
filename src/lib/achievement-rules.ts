export function shouldCheckImageAchievements(params: { activityType: string; modeUsed?: string }) {
  return params.modeUsed === "image" || params.activityType === "image";
}
