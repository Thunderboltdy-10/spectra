"use client";

import dynamic from "next/dynamic";

const FeedbackWidget = dynamic(
  () => import("@/components/feedback-widget").then((module) => module.FeedbackWidget),
  { ssr: false },
);

export function FeedbackWidgetHost() {
  return <FeedbackWidget />;
}
