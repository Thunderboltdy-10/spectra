"use client";

import { Icon, type IconName } from "@/components/icons";

/*
 * One attached file as a small picture of itself: images and the first frame
 * of a video show as they are, other files as their kind. The form and the
 * superadmin inbox draw attachments the same way.
 */

function kindIcon(name: string, mediaType: string): IconName {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  if (mediaType === "application/pdf" || extension === "pdf") return "pdf";
  if (/sheet|excel|csv/.test(mediaType) || ["xls", "xlsx", "csv"].includes(extension)) return "sheet";
  if (/presentation|powerpoint/.test(mediaType) || ["ppt", "pptx"].includes(extension)) return "slides";
  if (mediaType.startsWith("image/")) return "image";
  return "document";
}

export function FeedbackFilePreview({ name, mediaType, url }: { name: string; mediaType: string; url: string }) {
  const extension = name.includes(".") ? name.split(".").pop()!.slice(0, 5) : "";
  return (
    <span className="feedback-file-preview" data-kind={mediaType.split("/")[0]}>
      {mediaType.startsWith("image/") ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" loading="lazy" />
      ) : mediaType.startsWith("video/") ? (
        <>
          {/* The first frame stands in for the recording. */}
          <video src={`${url}#t=0.1`} muted playsInline preload="metadata" aria-hidden="true" />
          <span className="feedback-file-play" aria-hidden="true">
            <Icon name="play" size={12} />
          </span>
        </>
      ) : (
        <span className="feedback-file-kind" aria-hidden="true">
          <Icon name={kindIcon(name, mediaType)} size={18} />
          {extension ? <span>{extension}</span> : null}
        </span>
      )}
    </span>
  );
}
